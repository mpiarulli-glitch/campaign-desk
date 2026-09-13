/**
 * Contact-level email touch checks for attribution.
 *
 * Matching a booking to a nearby campaign/flow *send date* is not proof — busy
 * accounts send often enough that most bookings fall near some blast. Real
 * credit needs evidence that *this contact* got an outbound marketing email
 * before they booked.
 *
 * GHL does not expose campaign recipient lists on the APIs we use, so we
 * approximate via Conversations: outbound email on the contact's thread whose
 * source looks like campaign / workflow / bulk mail.
 */

import { ghlRequest } from "./ghl";
import type { ConversionEvent } from "./email-conversion-attribution";

const DAY_MS = 86_400_000;
const TOUCH_CONCURRENCY = 4;

function ymd(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function dayDiff(later: string, earlier: string): number {
  const a = Date.parse(`${later}T12:00:00.000Z`);
  const b = Date.parse(`${earlier}T12:00:00.000Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  return Math.round((a - b) / DAY_MS);
}

async function pooled<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  concurrency = TOUCH_CONCURRENCY
): Promise<void> {
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  }
  const n = Math.min(concurrency, Math.max(items.length, 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isOutbound(direction: unknown): boolean {
  const d = String(direction || "").toLowerCase();
  return d === "outbound" || d === "outgoing" || d === "out";
}

function isEmailMessage(msg: Record<string, unknown>): boolean {
  const messageType = String(msg.messageType || msg.type || "").toLowerCase();
  if (messageType.includes("email")) return true;
  if (msg.type === 3 || msg.type === "3") return true;
  return false;
}

/** Campaign / workflow / bulk — not one-off manual sales emails when labeled. */
export function isMarketingEmailSource(source: unknown): boolean {
  const s = String(source || "").toLowerCase().trim();
  if (!s) return true;
  if (/(campaign|workflow|bulk|broadcast|mass|automation|email.?market)/.test(s)) {
    return true;
  }
  if (/(manual|one.?off|user|staff|agent)/.test(s) && !/(campaign|workflow)/.test(s)) {
    return false;
  }
  return true;
}

async function findConversationId(
  locationId: string,
  contactId: string
): Promise<string | null> {
  try {
    const result = await ghlRequest<{
      conversations?: Array<{ id?: string; contactId?: string }>;
      data?: Array<{ id?: string; contactId?: string }>;
    }>("GET", "/conversations/search", {
      locationId,
      params: { locationId, contactId, limit: 5 },
    });
    const rows = result.conversations || result.data || [];
    const hit =
      rows.find((c) => String(c.contactId || "") === contactId) || rows[0];
    return hit?.id ? String(hit.id) : null;
  } catch {
    return null;
  }
}

async function listConversationMessages(
  locationId: string,
  conversationId: string
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  let lastMessageId: string | undefined;
  for (let page = 0; page < 8; page++) {
    const params: Record<string, string | number> = { limit: 100 };
    if (lastMessageId) params.lastMessageId = lastMessageId;
    const result = await ghlRequest<{
      messages?:
        | Array<Record<string, unknown>>
        | {
            messages?: Array<Record<string, unknown>>;
            lastMessageId?: string;
            nextPage?: boolean;
          };
    }>("GET", `/conversations/${conversationId}/messages`, {
      locationId,
      params,
    });

    const wrapped = asRecord(result.messages);
    const batch = Array.isArray(result.messages)
      ? result.messages
      : Array.isArray(wrapped?.messages)
        ? (wrapped!.messages as Array<Record<string, unknown>>)
        : [];
    if (batch.length === 0) break;
    out.push(...batch);

    const nextId = wrapped
      ? String(wrapped.lastMessageId || batch[batch.length - 1]?.id || "")
      : String(batch[batch.length - 1]?.id || "");
    const hasNext = wrapped ? Boolean(wrapped.nextPage) : batch.length >= 100;
    if (!hasNext || !nextId || nextId === lastMessageId) break;
    lastMessageId = nextId;
  }
  return out;
}

/**
 * Latest outbound marketing-email day for a contact on/before `onOrBefore`,
 * within `attributionDays`. Null when none found.
 */
export async function latestOutboundMarketingEmailDay(
  locationId: string,
  contactId: string,
  onOrBefore: string,
  attributionDays: number
): Promise<string | null> {
  const before = ymd(onOrBefore);
  if (!before || !contactId) return null;
  const conversationId = await findConversationId(locationId, contactId);
  if (!conversationId) return null;

  let messages: Array<Record<string, unknown>> = [];
  try {
    messages = await listConversationMessages(locationId, conversationId);
  } catch {
    return null;
  }

  let best: string | null = null;
  for (const msg of messages) {
    if (!isEmailMessage(msg) || !isOutbound(msg.direction)) continue;
    if (!isMarketingEmailSource(msg.source)) continue;
    const day = ymd(String(msg.dateAdded || msg.createdAt || ""));
    if (!day || day > before) continue;
    const lag = dayDiff(before, day);
    if (lag < 0 || lag > attributionDays) continue;
    if (!best || day > best) best = day;
  }
  return best;
}

export type EmailTouchFilterResult = {
  kept: ConversionEvent[];
  checked: number;
  touched: number;
  skippedNoContact: number;
};

/**
 * Keep only conversions where that contact received an outbound marketing email
 * in the prior attribution window. Events without a contactId are dropped.
 */
export async function filterConversionsWithEmailTouch(
  locationId: string,
  events: ConversionEvent[],
  attributionDays: number
): Promise<EmailTouchFilterResult> {
  const withContact = events.filter((e) => Boolean(e.contactId));
  const skippedNoContact = events.length - withContact.length;
  const dayTouch = new Map<string, boolean>();
  const eventTouch = new Map<string, boolean>();

  const uniqueDays: Array<{ contactId: string; at: string }> = [];
  const seenDay = new Set<string>();
  for (const event of withContact) {
    const contactId = event.contactId as string;
    const at = ymd(event.at);
    if (!at) continue;
    const key = `${contactId}:${at}`;
    if (seenDay.has(key)) continue;
    seenDay.add(key);
    uniqueDays.push({ contactId, at });
  }

  await pooled(uniqueDays, async ({ contactId, at }) => {
    const day = await latestOutboundMarketingEmailDay(
      locationId,
      contactId,
      at,
      attributionDays
    );
    dayTouch.set(`${contactId}:${at}`, Boolean(day));
  });

  for (const event of withContact) {
    const at = ymd(event.at);
    if (!at || !event.contactId) {
      eventTouch.set(event.id, false);
      continue;
    }
    eventTouch.set(event.id, Boolean(dayTouch.get(`${event.contactId}:${at}`)));
  }

  const kept = withContact.filter((e) => eventTouch.get(e.id));
  return {
    kept,
    checked: withContact.length,
    touched: kept.length,
    skippedNoContact,
  };
}
