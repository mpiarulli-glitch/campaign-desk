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

function isCampaignLikeSource(source: string): boolean {
  return /(campaign|bulk|broadcast|mass|email.?market)/.test(source);
}

function isWorkflowLikeSource(source: string): boolean {
  return /(workflow|automation)/.test(source);
}

/**
 * Campaign / workflow / bulk — not one-off manual sales emails when labeled.
 * When `strict`, unlabeled sources do NOT count (GHL often leaves manual mail blank).
 *
 * Pass `subject` in strict mode: workflow/automation with an empty subject is
 * NOT marketing (GHL often omits subject on appointment confirmations).
 * Campaign / bulk / broadcast still count without a subject.
 */
export function isMarketingEmailSource(
  source: unknown,
  options: { strict?: boolean; subject?: unknown } = {}
): boolean {
  const strict = Boolean(options.strict);
  const s = String(source || "").toLowerCase().trim();
  if (!s) return !strict;

  if (isCampaignLikeSource(s)) return true;

  if (isWorkflowLikeSource(s)) {
    if (!strict) return true;
    // Strict: require a non-empty subject. Empty-subject workflow mail is almost
    // always a confirmation/automation notice, not a blast that drove a booking.
    const subject = String(options.subject ?? "").trim();
    return Boolean(subject);
  }

  if (/(manual|one.?off|user|staff|agent)/.test(s) && !/(campaign|workflow)/.test(s)) {
    return false;
  }
  // Ambiguous labels: keep only in non-strict mode.
  return !strict;
}

/**
 * Appointment / form confirmations that go out AFTER someone converts.
 * These often come from workflows, so source alone would look like marketing.
 * Works on subject, body, snippet, or any combined email text.
 * Example: "Your Onsite Consultation Has Been Scheduled."
 */
export function isTransactionalEmailContent(text: unknown): boolean {
  const s = String(text || "")
    .replace(/<[^>]+>/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return false;
  if (/\b(has been|is|was)\s+scheduled\b/.test(s)) return true;
  if (/\b(appointment|consultation|estimate|meeting|booking|demo)\b.*\b(schedul|confirm|booked)\b/.test(s)) {
    return true;
  }
  if (/\b(schedul|confirm|booked)\b.*\b(appointment|consultation|estimate|meeting|booking|demo)\b/.test(s)) {
    return true;
  }
  if (/\b(booking|appointment|meeting)\s+confirm/.test(s)) return true;
  if (/\bconfirm(ation)?\s+(of\s+)?(your\s+)?(booking|appointment|meeting|estimate)\b/.test(s)) {
    return true;
  }
  if (/\bthanks?(?:\s+you)?\s+for\s+(schedul|book)/.test(s)) return true;
  if (/\b(reminder|reschedul)/.test(s) && /\b(appointment|consultation|estimate|meeting|booking)\b/.test(s)) {
    return true;
  }
  return false;
}

/** Subject-only wrapper; prefers isTransactionalEmailContent for body/snippet too. */
export function isTransactionalEmailSubject(subject: unknown): boolean {
  return isTransactionalEmailContent(subject);
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function messageSubject(msg: Record<string, unknown>): string {
  const meta = asRecord(msg.meta);
  return pickString(
    msg.subject,
    msg.emailSubject,
    msg.title,
    msg.name,
    meta?.subject,
    meta?.emailSubject
  );
}

/** Body / snippet / preview text GHL Conversations may return (often instead of subject). */
function messageBodyText(msg: Record<string, unknown>): string {
  const meta = asRecord(msg.meta);
  const parts = [
    msg.body,
    msg.text,
    msg.html,
    msg.snippet,
    msg.preview,
    msg.bodyPreview,
    msg.emailBody,
    msg.messageBody,
    msg.content,
    msg.message,
    meta?.body,
    meta?.text,
    meta?.html,
    meta?.snippet,
    meta?.preview,
    meta?.bodyPreview,
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
  return parts.join("\n");
}

function messageContentText(msg: Record<string, unknown>): string {
  return [messageSubject(msg), messageBodyText(msg)].filter(Boolean).join("\n");
}

/**
 * Whether an outbound conversation message counts as a real marketing email touch.
 * Used by attribution and unit tests (Eric Smith empty-subject workflow case).
 */
export function isOutboundMarketingTouchMessage(
  msg: Record<string, unknown>,
  options: { strict?: boolean } = {}
): boolean {
  if (!isEmailMessage(msg) || !isOutbound(msg.direction)) return false;
  const subject = messageSubject(msg);
  if (!isMarketingEmailSource(msg.source, { strict: options.strict, subject })) {
    return false;
  }
  // Workflow confirmations look like marketing by source but did not drive the booking.
  if (isTransactionalEmailContent(messageContentText(msg))) return false;
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
  attributionDays: number,
  options: { strictSource?: boolean } = {}
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

  const strictSource = Boolean(options.strictSource);
  let best: string | null = null;
  for (const msg of messages) {
    if (!isOutboundMarketingTouchMessage(msg, { strict: strictSource })) continue;
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
  /** eventId → YYYY-MM-DD of the outbound marketing email used. */
  touchDayByEventId: Record<string, string>;
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
  attributionDays: number,
  options: { strictSource?: boolean } = {}
): Promise<EmailTouchFilterResult> {
  const withContact = events.filter((e) => Boolean(e.contactId));
  const skippedNoContact = events.length - withContact.length;
  const dayTouch = new Map<string, string | null>();
  const touchDayByEventId: Record<string, string> = {};

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
      attributionDays,
      { strictSource: options.strictSource }
    );
    dayTouch.set(`${contactId}:${at}`, day);
  });

  const kept: ConversionEvent[] = [];
  for (const event of withContact) {
    const at = ymd(event.at);
    if (!at || !event.contactId) continue;
    const day = dayTouch.get(`${event.contactId}:${at}`) || null;
    if (!day) continue;
    touchDayByEventId[event.id] = day;
    kept.push(event);
  }

  return {
    kept,
    touchDayByEventId,
    checked: withContact.length,
    touched: kept.length,
    skippedNoContact,
  };
}

/** Keep events whose email touch day is within `maxLagDays` of the conversion. */
export function filterEventsByTouchLag(
  events: ConversionEvent[],
  touchDayByEventId: Record<string, string>,
  maxLagDays: number
): ConversionEvent[] {
  return events.filter((event) => {
    const at = ymd(event.at);
    const touch = touchDayByEventId[event.id];
    if (!at || !touch) return false;
    const lag = dayDiff(at, touch);
    return lag >= 0 && lag <= maxLagDays;
  });
}
