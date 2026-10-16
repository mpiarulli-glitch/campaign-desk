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
 * source looks like campaign / workflow / bulk mail. A form fill counts only
 * when that marketing email was received and opened in the 5 days before it.
 */

import { ghlRequest } from "./ghl";
import type { ConversionEvent, EmailTouchRef } from "./email-conversion-attribution";

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

/** Any outbound email on the contact, whatever the source label. */
export function isOutboundEmailMessage(msg: Record<string, unknown>): boolean {
  return isEmailMessage(msg) && isOutbound(msg.direction);
}

const OPENED_STATUS = /^(opened|read|clicked)$/;
const UNOPENED_DEAD_STATUS =
  /^(failed|undelivered|bounced|rejected|permanent_fail|temporary_fail)$/;

function statusTexts(msg: Record<string, unknown>): string[] {
  const meta = asRecord(msg.meta);
  const email = asRecord(msg.email);
  const emailMeta = asRecord(meta?.email);
  return [
    msg.status,
    msg.emailStatus,
    meta?.status,
    meta?.emailStatus,
    email?.status,
    emailMeta?.status,
  ]
    .map((value) => String(value || "").toLowerCase().trim())
    .filter(Boolean);
}

function openEventCount(msg: Record<string, unknown>): number {
  const meta = asRecord(msg.meta);
  const events = asRecord(msg.events) || asRecord(meta?.events);
  const n = Number(events?.opened ?? events?.open ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * GHL marks a received email as opened, read, or clicked.
 * Delivered or sent is not an open. Opened implies it was received.
 */
export function marketingEmailWasOpened(msg: Record<string, unknown>): boolean {
  if (statusTexts(msg).some((status) => OPENED_STATUS.test(status))) return true;
  if (openEventCount(msg) > 0) return true;
  const meta = asRecord(msg.meta);
  return Boolean(pickString(msg.openedAt, meta?.openedAt));
}

/** Sent or delivered mail can still be opened. Bounces cannot. */
function emailOpenNeedsLookup(msg: Record<string, unknown>): boolean {
  if (marketingEmailWasOpened(msg)) return false;
  const statuses = statusTexts(msg);
  if (statuses.length === 0) return true;
  return !statuses.every((status) => UNOPENED_DEAD_STATUS.test(status));
}

/**
 * Label for an opened marketing email. A real subject is kept.
 * HTML, tracking URLs, and message bodies are not.
 */
export function openedMarketingEmailLabel(subject: string): string {
  const text = subject.replace(/\s+/g, " ").trim();
  if (!text || text.length > 120) return "Opened marketing email";
  if (/[<>]/.test(text)) return "Opened marketing email";
  if (/https?:\/\//i.test(text)) return "Opened marketing email";
  if (/msgsndr|googleapis/i.test(text)) return "Opened marketing email";
  return text;
}

/**
 * True when this outbound marketing email was opened, and it landed in the
 * `attributionDays` before the form. Mail after the fill does not count.
 */
export function countsAsOpenedMarketingEmail(
  msg: Record<string, unknown>,
  formAt: string,
  attributionDays = 5
): boolean {
  if (!isOutboundMarketingTouchMessage(msg, { strict: true })) return false;
  if (!marketingEmailWasOpened(msg)) return false;
  const rawAt = String(msg.dateAdded || msg.createdAt || "");
  if (!outboundEmailIsBefore(rawAt, formAt)) return false;
  const before = ymd(formAt);
  const day = ymd(rawAt);
  if (!before || !day) return false;
  const lag = dayDiff(before, day);
  return lag >= 0 && lag <= attributionDays;
}

/**
 * The email has to land before the form. A full timestamp beats a same-day
 * confirmation that went out after the fill. Date-only forms keep same-day mail.
 */
export function outboundEmailIsBefore(messageAt: string, conversionAt: string): boolean {
  const conversionHasTime = /T\d/.test(conversionAt);
  const msgMs = Date.parse(messageAt);
  const convMs = Date.parse(conversionAt);
  if (conversionHasTime && Number.isFinite(msgMs) && Number.isFinite(convMs)) {
    return msgMs < convMs;
  }
  const msgDay = ymd(messageAt);
  const convDay = ymd(conversionAt);
  if (!msgDay || !convDay) return false;
  return msgDay <= convDay;
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
 * Pass `subject` in strict mode. Workflow/automation with an empty subject is
 * only eligible when `bodyHint` has substantial text (≥40 chars) — GHL often
 * omits subject on both confirmations and nurture; transactional filtering
 * happens separately on the full message.
 * Campaign / bulk / broadcast still count without a subject.
 */
export function isMarketingEmailSource(
  source: unknown,
  options: { strict?: boolean; subject?: unknown; bodyHint?: unknown } = {}
): boolean {
  const strict = Boolean(options.strict);
  const s = String(source || "").toLowerCase().trim();
  if (!s) return !strict;

  if (isCampaignLikeSource(s)) return true;

  if (isWorkflowLikeSource(s)) {
    if (!strict) return true;
    // Strict: non-empty subject → eligible (transactional body filtered later).
    // Empty subject alone is not enough to reject here — GHL Conversations often
    // omits subject on real nurture workflows too. Callers must still run
    // transactional + post-form checks on the full message.
    const subject = String(options.subject ?? "").trim();
    if (subject) return true;
    // Empty subject: only keep when the caller passes a non-empty body snippet
    // via options (see isOutboundMarketingTouchMessage). Default deny.
    const bodyHint = String(options.bodyHint ?? "").trim();
    return bodyHint.length >= 40;
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
  // "Thanks for booking your appointment" — not "Thanks for these booking tips".
  if (
    /\bthanks?(?:\s+you)?\s+for\s+schedul(?:ing|ed)\b/.test(s) ||
    /\bthanks?(?:\s+you)?\s+for\s+book(?:ing|ed)\s+(?:your\s+)?(?:appointment|consultation|estimate|meeting|demo|visit|booking)\b/.test(
      s
    )
  ) {
    return true;
  }
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

function plainMessageBody(msg: Record<string, unknown>): string {
  return messageBodyText(msg)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

function messageCampaignId(msg: Record<string, unknown>): string {
  const meta = asRecord(msg.meta);
  return pickString(
    msg.campaignId,
    msg.bulkRequestId,
    msg.emailCampaignId,
    meta?.campaignId,
    meta?.bulkRequestId,
    meta?.emailCampaignId
  );
}

function messageContactId(msg: Record<string, unknown>): string {
  return String(msg.contactId || msg.contact_id || "").trim();
}

/**
 * Form → workflow email → booked: the post-form automation is not a marketing
 * touch that drove the booking (Eric Smith path). Campaign/bulk after a form
 * still counts (nurture).
 */
export function isPostFormWorkflowAutomation(
  source: unknown,
  messageDay: string | null | undefined,
  formFilledAt: string | null | undefined
): boolean {
  const formDay = ymd(formFilledAt);
  const day = ymd(messageDay);
  if (!formDay || !day) return false;
  if (!isWorkflowLikeSource(String(source || "").toLowerCase().trim())) {
    return false;
  }
  return day >= formDay;
}

/**
 * Whether an outbound conversation message counts as a real marketing email touch.
 * Used by attribution and unit tests (Eric Smith empty-subject / form→confirm case).
 */
export function isOutboundMarketingTouchMessage(
  msg: Record<string, unknown>,
  options: { strict?: boolean; formFilledAt?: string | null } = {}
): boolean {
  if (!isEmailMessage(msg) || !isOutbound(msg.direction)) return false;
  const subject = messageSubject(msg);
  const bodyText = messageBodyText(msg);
  const content = messageContentText(msg);
  // Strip tags for the empty-subject body-length gate (same as transactional).
  const bodyHint = bodyText
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (
    !isMarketingEmailSource(msg.source, {
      strict: options.strict,
      subject,
      bodyHint,
    })
  ) {
    return false;
  }
  // Workflow confirmations look like marketing by source but did not drive the booking.
  if (isTransactionalEmailContent(content)) return false;
  const day = ymd(String(msg.dateAdded || msg.createdAt || ""));
  if (isPostFormWorkflowAutomation(msg.source, day, options.formFilledAt)) {
    return false;
  }
  return true;
}

export async function findConversationId(
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
    const exact = rows.find((c) => String(c.contactId || "") === contactId);
    if (exact?.id) return String(exact.id);
    // Trust the contactId query only when the payload does not name someone else.
    const unlabeled = rows.filter((c) => !String(c.contactId || "").trim());
    if (unlabeled.length === 1 && unlabeled[0]?.id) return String(unlabeled[0].id);
    return null;
  } catch {
    return null;
  }
}

export async function listConversationMessages(
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

type EmailDetailCache = Map<string, Promise<Record<string, unknown> | null>>;

async function loadEmailMessage(
  locationId: string,
  messageId: string,
  cache: EmailDetailCache
): Promise<Record<string, unknown> | null> {
  const key = `${locationId}:${messageId}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        const result = await ghlRequest<Record<string, unknown>>(
          "GET",
          `/conversations/messages/email/${encodeURIComponent(messageId)}`,
          { locationId, version: "v3" }
        );
        return asRecord(result.email) || asRecord(result.message) || result;
      } catch {
        return null;
      }
    })();
    cache.set(key, pending);
  }
  return pending;
}

/**
 * Opened on the conversation row, or on the email record when the row only
 * says sent or delivered.
 */
async function confirmMarketingEmailOpened(
  locationId: string,
  msg: Record<string, unknown>,
  cache: EmailDetailCache
): Promise<boolean> {
  if (marketingEmailWasOpened(msg)) return true;
  if (!emailOpenNeedsLookup(msg)) return false;
  const ids = [
    pickString(msg.id),
    pickString(msg.emailMessageId),
    pickString(msg.altId),
  ].filter((id, index, all) => id && all.indexOf(id) === index);
  for (const id of ids) {
    const detail = await loadEmailMessage(locationId, id, cache);
    if (!detail) continue;
    if (
      marketingEmailWasOpened({
        status: detail.status,
        emailStatus: detail.emailStatus,
        events: detail.events,
        openedAt: detail.openedAt,
        meta: detail.meta,
        email: detail.email,
      })
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Messages on this contact's conversation. Empty when GHL has no thread.
 * Callers must still ignore rows whose contactId names someone else.
 */
export async function listContactThreadMessages(
  locationId: string,
  contactId: string
): Promise<Array<Record<string, unknown>>> {
  if (!contactId.trim()) return [];
  const conversationId = await findConversationId(locationId, contactId);
  if (!conversationId) return [];
  try {
    return await listConversationMessages(locationId, conversationId);
  } catch {
    return [];
  }
}

/**
 * Fill opened/read onto email rows that only say sent or delivered.
 * Form-fill inference needs this — a thread email that was not opened does not count.
 */
export async function annotateMarketingEmailOpens(
  locationId: string,
  messages: Array<Record<string, unknown>>
): Promise<Array<Record<string, unknown>>> {
  const cache: EmailDetailCache = new Map();
  const out: Array<Record<string, unknown>> = [];
  for (const msg of messages) {
    if (!isEmailMessage(msg) || marketingEmailWasOpened(msg)) {
      out.push(msg);
      continue;
    }
    if (!emailOpenNeedsLookup(msg)) {
      out.push(msg);
      continue;
    }
    const opened = await confirmMarketingEmailOpened(locationId, msg, cache);
    if (!opened) {
      out.push(msg);
      continue;
    }
    out.push({
      ...msg,
      status: "opened",
      openedAt:
        pickString(msg.openedAt) ||
        pickString(msg.dateAdded, msg.createdAt) ||
        new Date(0).toISOString(),
    });
  }
  return out;
}

function messageTouch(msg: Record<string, unknown>, day: string): EmailTouchRef {
  return {
    day,
    subject: messageSubject(msg),
    text: plainMessageBody(msg),
    campaignId: messageCampaignId(msg),
  };
}

/**
 * Latest outbound marketing email for a contact on/before `onOrBefore`,
 * within `attributionDays`. Null when none found.
 *
 * The result includes the subject (and body, when the subject is missing) so
 * callers can avoid crediting a different blast that merely went out the same day.
 *
 * Pass `formFilledAt` for appointment checks so post-form workflow mail
 * (confirmations) does not count as the marketing touch.
 *
 * Pass `openedMarketing` for form fills: the email has to be a marketing send
 * that GHL marked opened, inside the window before the form.
 */
export async function latestOutboundMarketingEmailTouch(
  locationId: string,
  contactId: string,
  onOrBefore: string,
  attributionDays: number,
  options: {
    strictSource?: boolean;
    formFilledAt?: string | null;
    /** Any outbound email, not only campaign / workflow mail. */
    anyOutbound?: boolean;
    /** Marketing email that was received and opened before the form. */
    openedMarketing?: boolean;
    emailDetailCache?: EmailDetailCache;
  } = {}
): Promise<EmailTouchRef | null> {
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

  const strictSource = Boolean(options.strictSource) || Boolean(options.openedMarketing);
  const formFilledAt = ymd(options.formFilledAt);
  const emailDetailCache = options.emailDetailCache || new Map();
  let best: { at: number; touch: EmailTouchRef } | null = null;
  const openedCandidates: Array<{
    msg: Record<string, unknown>;
    at: number;
    day: string;
  }> = [];
  for (const msg of messages) {
    const owner = messageContactId(msg);
    if (owner && owner !== contactId) continue;
    const qualifies = options.openedMarketing
      ? isOutboundMarketingTouchMessage(msg, {
          strict: true,
          formFilledAt,
        })
      : options.anyOutbound
        ? isOutboundEmailMessage(msg)
        : isOutboundMarketingTouchMessage(msg, {
            strict: strictSource,
            formFilledAt,
          });
    if (!qualifies) continue;
    const rawAt = String(msg.dateAdded || msg.createdAt || "");
    const day = ymd(rawAt);
    if (!day || !outboundEmailIsBefore(rawAt, onOrBefore)) continue;
    const lag = dayDiff(before, day);
    if (lag < 0 || lag > attributionDays) continue;
    const at = Date.parse(rawAt);
    const when = Number.isFinite(at) ? at : Date.parse(`${day}T12:00:00.000Z`);
    if (options.openedMarketing) {
      openedCandidates.push({ msg, at: when, day });
      continue;
    }
    if (best && when <= best.at) continue;
    best = { at: when, touch: messageTouch(msg, day) };
  }
  if (!options.openedMarketing) return best?.touch || null;

  openedCandidates.sort((a, b) => b.at - a.at);
  for (const candidate of openedCandidates) {
    const opened = await confirmMarketingEmailOpened(
      locationId,
      candidate.msg,
      emailDetailCache
    );
    if (!opened) continue;
    return messageTouch(candidate.msg, candidate.day);
  }
  return null;
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
  options: {
    strictSource?: boolean;
    formFilledAt?: string | null;
    anyOutbound?: boolean;
    openedMarketing?: boolean;
    emailDetailCache?: EmailDetailCache;
  } = {}
): Promise<string | null> {
  const touch = await latestOutboundMarketingEmailTouch(
    locationId,
    contactId,
    onOrBefore,
    attributionDays,
    options
  );
  return touch?.day || null;
}

export type EmailTouchFilterResult = {
  kept: ConversionEvent[];
  /** eventId → YYYY-MM-DD of the outbound marketing email used. */
  touchDayByEventId: Record<string, string>;
  /** eventId → the email actually on that contact's thread. */
  touchByEventId: Record<string, EmailTouchRef>;
  checked: number;
  touched: number;
  skippedNoContact: number;
};

/**
 * Keep only conversions where that contact received an outbound marketing email
 * in the prior attribution window. Events without a contactId are dropped.
 *
 * For appointments, pass `formFilledAtByContactId` so form → confirmation
 * workflow → booked does not count as an email-driven journey.
 *
 * For form fills, pass `openedMarketing` so a fill counts only when that
 * contact opened a marketing email in the window before the form.
 */
export async function filterConversionsWithEmailTouch(
  locationId: string,
  events: ConversionEvent[],
  attributionDays: number,
  options: {
    strictSource?: boolean;
    /** Latest in-window form day per contact — used for appointment honesty. */
    formFilledAtByContactId?: Record<string, string>;
    /** Any outbound email before the conversion. */
    anyOutbound?: boolean;
    /** Marketing email received and opened before the conversion. */
    openedMarketing?: boolean;
  } = {}
): Promise<EmailTouchFilterResult> {
  const withContact = events.filter((e) => Boolean(e.contactId));
  const skippedNoContact = events.length - withContact.length;
  const dayTouch = new Map<string, EmailTouchRef | null>();
  const touchDayByEventId: Record<string, string> = {};
  const touchByEventId: Record<string, EmailTouchRef> = {};
  const formByContact = options.formFilledAtByContactId || {};
  const emailDetailCache: EmailDetailCache = new Map();

  const uniqueDays: Array<{
    contactId: string;
    at: string;
    formFilledAt: string | null;
  }> = [];
  const seenDay = new Map<string, string | null>();
  for (const event of withContact) {
    const contactId = event.contactId as string;
    const at = event.at.trim();
    if (!ymd(at)) continue;
    const formFilledAt =
      event.kind === "appointment"
        ? ymd(formByContact[contactId])
        : null;
    const key = `${contactId}:${at}:${formFilledAt || ""}`;
    if (seenDay.has(key)) continue;
    seenDay.set(key, formFilledAt);
    uniqueDays.push({ contactId, at, formFilledAt });
  }

  await pooled(uniqueDays, async ({ contactId, at, formFilledAt }) => {
    const touch = await latestOutboundMarketingEmailTouch(
      locationId,
      contactId,
      at,
      attributionDays,
      {
        strictSource: options.strictSource,
        formFilledAt,
        anyOutbound: options.anyOutbound,
        openedMarketing: options.openedMarketing,
        emailDetailCache,
      }
    );
    dayTouch.set(`${contactId}:${at}:${formFilledAt || ""}`, touch);
  });

  const kept: ConversionEvent[] = [];
  for (const event of withContact) {
    const at = event.at.trim();
    if (!ymd(at) || !event.contactId) continue;
    const formFilledAt =
      event.kind === "appointment"
        ? ymd(formByContact[event.contactId])
        : null;
    const touch =
      dayTouch.get(`${event.contactId}:${at}:${formFilledAt || ""}`) || null;
    if (!touch) continue;
    touchDayByEventId[event.id] = touch.day;
    touchByEventId[event.id] = touch;
    kept.push(event);
  }

  return {
    kept,
    touchDayByEventId,
    touchByEventId,
    checked: withContact.length,
    touched: kept.length,
    skippedNoContact,
  };
}

/** Latest form-fill day per contact (YYYY-MM-DD) from conversion events. */
export function formFilledAtByContactId(
  formEvents: ConversionEvent[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const event of formEvents) {
    if (!event.contactId || event.kind !== "form_fill") continue;
    const day = ymd(event.at);
    if (!day) continue;
    const prev = out[event.contactId];
    if (!prev || day > prev) out[event.contactId] = day;
  }
  return out;
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
