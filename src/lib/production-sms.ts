// Scheduling texts. These exist for one reason: get the client to pick a
// production slot. Request-received, confirmed, crew renotify, and the
// missed-window booking page do not text.
//
// Client sends stay off unless PRODUCTION_SMS_ENABLED=1. A missing phone or
// a missing sending location never throws and never blocks the email.

import { scheduleUrl } from "./auth";
import { getDb, nowIso, type RevClient } from "./db";
import { emailConfigured, sendEmail } from "./email";
import { clearFailure, recordFailure } from "./failures";
import {
  sendLocationSms,
  upsertContactByPhone,
  listLocations,
  listLocationPhoneNumbers,
  getGhlContact,
  getConversationMessage,
  getLocationA2p,
  getLocationName,
  type GhlPhoneNumber,
} from "./ghl";
import { normalizePhoneE164 } from "./phone";

export const PRODUCTION_SMS_EVENTS = {
  first_invite: true,
  extra_invite: true,
  cadence_reminder: true,
  request_received: false,
  confirmed: false,
  renotify: false,
  missed_window: false,
} as const;

export type ProductionNotice = keyof typeof PRODUCTION_SMS_EVENTS;
export type ScheduleSmsKind = "first_invite" | "extra_invite" | "cadence_reminder";

export function productionNoticeSendsSms(notice: ProductionNotice): boolean {
  return PRODUCTION_SMS_EVENTS[notice];
}

/** One GSM-7 segment. Longer links still go out whole; the opt-out is never cut. */
const SMS_SEGMENT = 160;

const SMS_BRAND = "Marketing Empire Group: ";
const SMS_STOP = " Reply STOP to opt out.";

export function scheduleSmsEnabled(): boolean {
  return process.env.PRODUCTION_SMS_ENABLED === "1";
}

export function productionSmsLocationId(): string {
  return (process.env.PRODUCTION_SMS_LOCATION_ID || "").trim();
}

export function scheduleSmsReady(): boolean {
  return scheduleSmsEnabled() && Boolean(productionSmsLocationId());
}

export function contactFirstName(name: string): string {
  const first = (name || "").trim().split(/\s+/)[0] || "";
  if (!first || first.includes("@") || !/[a-z]/i.test(first)) return "";
  return first;
}

function productionPhrase(kind: ScheduleSmsKind | "sample"): string {
  if (kind === "first_invite") return "your first production";
  if (kind === "extra_invite") return "a production";
  if (kind === "cadence_reminder") return "your next production";
  return "your production";
}

/**
 * Every scheduling text starts with the brand and ends with STOP.
 * The full https link is kept. Shorter wording is used only when that is
 * what fits in one 160-character segment.
 */
export function scheduleSmsCopy(args: {
  kind: ScheduleSmsKind | "sample";
  contactName: string;
  url?: string;
  includeLink?: boolean;
}): string {
  const first = contactFirstName(args.contactName);
  const hello = first ? `Hi ${first}` : "Hi";
  const what = productionPhrase(args.kind);
  const link = args.includeLink === false ? "" : (args.url || "").trim();
  const withLink = link
    ? [
        `${SMS_BRAND}${hello}, it's time to schedule ${what}. Pick a time here: ${link}${SMS_STOP}`,
        `${SMS_BRAND}${hello}, it's time to schedule ${what}. ${link}${SMS_STOP}`,
        `${SMS_BRAND}${hello}, schedule ${what}: ${link}${SMS_STOP}`,
        `${SMS_BRAND}Hi, it's time to schedule ${what}. ${link}${SMS_STOP}`,
        `${SMS_BRAND}Schedule ${what}: ${link}${SMS_STOP}`,
      ]
    : [
        `${SMS_BRAND}${hello}, it's time to schedule ${what}.${SMS_STOP}`,
        `${SMS_BRAND}Hi, it's time to schedule ${what}.${SMS_STOP}`,
      ];
  const chosen = withLink.find((body) => body.length <= SMS_SEGMENT) || withLink[withLink.length - 1];
  return guardProductionSms(chosen);
}

/**
 * The only door a production text can leave through. Brand and opt-out are
 * added here even if a caller forgot them, and adding them twice is a no-op.
 */
export function guardProductionSms(body: string): string {
  const trimmed = (body || "").trim();
  const branded = trimmed.startsWith(SMS_BRAND) ? trimmed : `${SMS_BRAND}${trimmed}`;
  if (branded.endsWith("Reply STOP to opt out.")) return branded;
  return `${branded}${SMS_STOP}`;
}

/**
 * Short plain text that mirrors the scheduling email.
 * First production uses the first-shoot wording. A regular reminder uses
 * "your next". An extra, out-of-cadence ask is just "a" production.
 */
export function scheduleNudgeSmsBody(args: {
  kind: ScheduleSmsKind;
  contactName: string;
  url: string;
}): string {
  return scheduleSmsCopy(args);
}

/** Sample text only. A real scheduling page, labeled as a test, not a client nudge. */
function sampleScheduleSmsBody(
  contactName: string,
  url: string,
  includeLink = true
): string {
  return scheduleSmsCopy({
    kind: "sample",
    contactName,
    url,
    includeLink,
  });
}

export const SAMPLE_SCHEDULE_TOKEN = "sample";

export type SmsDeliveryStatus = "queued" | "sent" | "delivered" | "failed" | "undelivered";

export type SmsOutcome = {
  phone?: string;
  message?: string;
  messageId?: string;
  delivery?: SmsDeliveryStatus;
  fromNumber?: string;
  locationId?: string;
  locationName?: string;
  dnd?: string;
  httpStatus?: number;
};

export type ScheduleSmsResult =
  | ({ status: "sent" } & SmsOutcome & { phone: string })
  | ({
      status: "skipped";
      reason: "disabled" | "no_phone" | "no_location" | "no_link" | "duplicate" | "invalid_phone";
    } & SmsOutcome)
  | ({ status: "failed"; error: string } & SmsOutcome);

export function sampleHttpStatus(result: ScheduleSmsResult): number {
  if (result.status === "sent") return 200;
  if (result.status === "failed") return result.httpStatus ?? 502;
  return 400;
}

/**
 * One sentence for a non-technical reader, plus what to do next.
 * Null when the text was accepted.
 */
export function plainSmsFailure(result: {
  status: string;
  reason?: string;
  error?: string;
  delivery?: string;
  locationName?: string;
}): string | null {
  if (result.status === "sent") return null;
  const place = result.locationName?.trim() || "MEG's GHL account";
  const raw = `${result.error || ""} ${result.reason || ""}`.toLowerCase();

  if (result.reason === "invalid_phone" || /area code|usable number/.test(raw)) {
    return "That phone number isn't complete. Enter it with an area code, like (951) 383-9888.";
  }
  if (
    result.reason === "no_location" ||
    /not set/.test(raw) ||
    /did not resolve/.test(raw) ||
    /railway reference/.test(raw)
  ) {
    return "Texting isn't connected to a GHL account yet. Set PRODUCTION_SMS_LOCATION_ID to MEG's own sub-account, then try again.";
  }
  if (/do not disturb|\bdnd\b|30004/.test(raw)) {
    return "This phone is marked Do Not Disturb in GHL, so texts to it are blocked. Turn off SMS Do Not Disturb on that contact, then try again.";
  }
  if (/opt_out|opted out|21610/.test(raw)) {
    return "This phone has opted out of texts. Text START to the MEG number from that phone, or use a different number.";
  }
  if (/no phone number|no sms-capable|sms off|sms not marked|21606|21661/.test(raw)) {
    return `${place} has no texting number, so GHL can't send texts yet. Add an SMS number (LC Phone or Twilio) on that account, then try again.`;
  }
  if (/30007|carrier filter/.test(raw)) {
    return "The carrier blocked this text as possible spam. Try the version without the link, or adjust the wording.";
  }
  if (/30003/.test(raw)) {
    return "The carrier couldn't reach this phone. Check the number, then try again.";
  }
  if (/30005/.test(raw)) {
    return "The carrier doesn't recognize this number. Check it, then try again.";
  }
  if (/a2p|30034|30032|30033|toll-free|toll free/.test(raw)) {
    return "The texting number isn't approved for US business texts yet. Finish A2P or toll-free registration in GHL, then try again.";
  }
  if (/invalid token|unauthorized|401/.test(raw)) {
    return "Campaign Desk can't sign in to GHL right now. Reconnect the GHL account, then try again.";
  }
  if (/did not return a message id/.test(raw)) {
    return "GHL didn't actually create a text. Add a texting number on MEG's account, then try again.";
  }
  if (result.delivery === "undelivered" || result.delivery === "failed" || result.status === "failed") {
    return "The text didn't arrive. Check that MEG's GHL account has a texting number and that US texting registration is approved.";
  }
  return "The text wasn't sent. The details are in the section below.";
}

/** One Railway log line. No tokens, no message body. */
export function formatSampleLog(result: {
  status: string;
  reason?: string;
  error?: string;
  delivery?: string;
  fromNumber?: string;
  locationName?: string;
}): string {
  const status =
    result.status === "sent"
      ? result.delivery || "sent"
      : result.status === "failed"
        ? result.delivery || "failed"
        : result.reason || result.status;
  const plain = plainSmsFailure(result);
  const detail = scrubLogValue(result.status === "failed" ? result.error || "" : "");
  const shown = scrubLogValue(plain || "");
  const extra = detail && detail !== shown ? ` detail=${quoteLog(detail)}` : "";
  return (
    `[production-sms] sample status=${status || "-"}` +
    ` from=${result.fromNumber || "-"}` +
    ` location=${quoteLog(result.locationName || "-")}` +
    ` error=${quoteLog(shown || "-")}` +
    extra
  );
}

function scrubLogValue(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(refresh_token|access_token|client_secret)\b[=:]\s*\S+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim();
}

function quoteLog(value: string): string {
  return `"${value.replace(/"/g, "'")}"`;
}

/** Twilio-style code, or dnd. Empty when the failure has no code. */
export function smsErrorCode(error: string | undefined): string {
  const text = error || "";
  const match = text.match(/\b(300\d{2}|216\d{2})\b/);
  if (match) return match[1];
  if (/do not disturb|\bdnd\b/i.test(text)) return "dnd";
  return "";
}

/** One Railway line per send. No message body and no secrets. */
export function formatSendLog(args: {
  client?: string;
  status: string;
  code?: string;
  messageId?: string;
}): string {
  const code = scrubLogValue(args.code || "") || "-";
  const client = scrubLogValue(args.client || "") || "-";
  const messageId = scrubLogValue(args.messageId || "") || "-";
  return (
    `${SMS_LOG} send client=${quoteLog(client)}` +
    ` status=${args.status || "-"}` +
    ` code=${code}` +
    ` messageId=${messageId}`
  );
}

export function smsDeliveryLabel(args: {
  status?: string;
  error?: string;
  code?: string;
}): string {
  const code = args.code || smsErrorCode(args.error);
  const error = args.error || "";
  if (code === "30007" || /carrier filter/i.test(error)) return "Blocked by carrier";
  if (code === "30003") return "Unreachable";
  if (code === "30005") return "Unknown number";
  if (code === "dnd" || /do not disturb/i.test(error)) return "Do Not Disturb";
  const status = (args.status || "").toLowerCase();
  if (status === "delivered") return "Delivered";
  if (status === "failed" || status === "undelivered") return "Didn't arrive";
  if (status === "queued" || status === "sent" || status === "pending") {
    return "Sent, waiting on the carrier";
  }
  return "Not sent";
}

/** The small line on a production card, plus the plain sentence when it failed. */
export function lastTextView(args: {
  phone?: string | null;
  status?: string | null;
  errorCode?: string | null;
  errorText?: string | null;
}): { line: string; detail: string } {
  const phone = (args.phone || "").trim();
  const status = (args.status || "").trim();
  if (!status) {
    if (!phone) return { line: "Last text: Not sent (no phone)", detail: "" };
    if (!normalizePhoneE164(phone)) return { line: "Last text: Not sent (bad number)", detail: "" };
    return { line: "Last text: Not sent yet", detail: "" };
  }
  const label = smsDeliveryLabel({
    status,
    error: args.errorText || "",
    code: args.errorCode || "",
  });
  const failed = status === "failed" || status === "undelivered";
  const detail = failed
    ? plainSmsFailure({
        status: "failed",
        delivery: status,
        error: args.errorText || args.errorCode || "",
      }) || ""
    : "";
  return { line: `Last text: ${label}`, detail };
}

export type SmsFailureNotice = {
  client: string;
  reason: string;
  dedupeKey?: string;
};

/** One alert for a whole run. Empty when nothing failed. */
export function groupSmsFailureAlert(
  items: SmsFailureNotice[]
): { subject: string; text: string } | null {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const item of items) {
    const client = item.client.trim() || "A client";
    const reason = item.reason.trim();
    if (!reason) continue;
    const key = `${client}\n${reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`${client}: ${reason}`);
  }
  if (!lines.length) return null;
  const subject =
    lines.length === 1
      ? `Scheduling text didn't reach ${lines[0].split(":")[0]}`
      : `${lines.length} scheduling texts didn't go through`;
  return { subject, text: lines.join("\n") };
}

export function smsAlertReason(result: ScheduleSmsResult): string | null {
  if (result.status === "skipped") return null;
  if (result.status === "sent" && result.delivery !== "failed" && result.delivery !== "undelivered") {
    return null;
  }
  const error = result.status === "failed" ? result.error : "";
  return (
    plainSmsFailure({
      status: "failed",
      delivery: result.delivery,
      error,
    }) ||
    error ||
    "The text didn't arrive."
  );
}

function escapeAlert(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const SMS_ALERT_SUBJECT = "Scheduling texts";

/**
 * One in-app failure and one email for the whole run. Does not send a text.
 */
export async function alertSmsFailures(
  items: SmsFailureNotice[],
  send?: (input: { to: string; subject: string; text: string; html: string }) => Promise<boolean>
): Promise<{ subject: string; text: string } | null> {
  const grouped = groupSmsFailureAlert(items);
  if (!grouped) return null;
  recordFailure({
    kind: "production_sms",
    subject: SMS_ALERT_SUBJECT,
    detail: grouped.text,
    hint: "The client's production card shows the same reason. The scheduling email still went out.",
  });
  const to = (process.env.PRODUCTION_SMS_ALERT_EMAIL || "mpiarulli@marketingempiregroup.com").trim();
  const html = grouped.text
    .split("\n")
    .map((line) => `<p>${escapeAlert(line)}</p>`)
    .join("");
  if (send) {
    await send({ to, subject: grouped.subject, text: grouped.text, html });
  } else if (emailConfigured()) {
    await sendEmail({ to, subject: grouped.subject, text: grouped.text, html });
  } else {
    console.log(
      `${SMS_LOG} alert email skipped (email not configured) subject=${quoteLog(grouped.subject)}`
    );
  }
  const ts = nowIso();
  const db = getDb();
  for (const item of items) {
    if (!item.dedupeKey) continue;
    db.prepare(
      `UPDATE production_sms_sends SET alerted_at = ? WHERE dedupe_key = ? AND alerted_at = ''`
    ).run(ts, item.dedupeKey);
  }
  return grouped;
}

export type StoredSms = {
  client_id: string;
  status: string;
  error_code: string;
  error_text: string;
  created_at: string;
};

export function latestSmsByClient(): Map<string, StoredSms> {
  const rows = getDb()
    .prepare(
      `SELECT client_id, status, error_code, error_text, created_at
       FROM production_sms_sends
       WHERE client_id != ''
       ORDER BY created_at DESC`
    )
    .all() as StoredSms[];
  const map = new Map<string, StoredSms>();
  for (const row of rows) {
    if (!map.has(row.client_id)) map.set(row.client_id, row);
  }
  return map;
}

const SMS_FOLLOW_UP_MS = 2 * 60 * 1000;
const SMS_GIVE_UP_MS = 48 * 60 * 60 * 1000;

type OpenSmsRow = {
  dedupe_key: string;
  client_name: string;
  message_id: string;
  status: string;
  error_text: string;
  error_code: string;
  created_at: string;
  alerted_at: string;
};

/**
 * Re-read GHL for texts that are not final yet. Returns failures that have
 * not been alerted, so the caller can group them into one notice.
 */
export async function refreshSmsDeliveries(args?: {
  read?: (messageId: string) => Promise<unknown>;
  minAgeMs?: number;
  nowMs?: number;
}): Promise<SmsFailureNotice[]> {
  const nowMs = args?.nowMs ?? Date.now();
  const minAge = args?.minAgeMs ?? SMS_FOLLOW_UP_MS;
  const locationId = productionSmsLocationId();
  const read =
    args?.read ||
    (async (messageId: string) => {
      if (!locationId) throw new Error("PRODUCTION_SMS_LOCATION_ID is not set.");
      return getConversationMessage(locationId, messageId);
    });
  const rows = getDb()
    .prepare(
      `SELECT dedupe_key, client_name, message_id, status, error_text, error_code, created_at, alerted_at
       FROM production_sms_sends
       WHERE message_id != ''
         AND (
           status IN ('queued', 'sent', 'pending', '')
           OR (status IN ('failed', 'undelivered') AND alerted_at = '')
         )`
    )
    .all() as OpenSmsRow[];
  const notices: SmsFailureNotice[] = [];
  for (const row of rows) {
    const created = Date.parse(row.created_at);
    const age = Number.isFinite(created) ? nowMs - created : minAge;
    let status = row.status;
    let error = row.error_text || "";
    let code = row.error_code || "";
    const alreadyFinal = status === "failed" || status === "undelivered";
    if (!alreadyFinal) {
      if (age < minAge) continue;
      if (!locationId && !args?.read) continue;
      if (age >= SMS_GIVE_UP_MS) {
        status = "undelivered";
        error = "The carrier never confirmed this text.";
        code = "unconfirmed";
      } else {
        try {
          const snap = snapshotFromMessage(await read(row.message_id));
          status = snap.status;
          error = snap.error;
          code = smsErrorCode(snap.error);
        } catch (err) {
          const detail = err instanceof Error ? err.message : "Could not read the message.";
          logSend({
            client: row.client_name,
            status: "check_failed",
            code: smsErrorCode(detail),
            messageId: row.message_id,
          });
          continue;
        }
        if (!terminalDelivery(status as SmsDeliveryStatus)) {
          getDb()
            .prepare(
              `UPDATE production_sms_sends
               SET status = ?, error_text = ?, error_code = ?, checked_at = ?, updated_at = ?
               WHERE dedupe_key = ?`
            )
            .run(status, error, code, nowIso(), nowIso(), row.dedupe_key);
          logSend({
            client: row.client_name,
            status,
            code,
            messageId: row.message_id,
          });
          continue;
        }
      }
    }
    const finalStatus = status === "failed" || status === "undelivered" ? status : "undelivered";
    getDb()
      .prepare(
        `UPDATE production_sms_sends
         SET status = ?, error_text = ?, error_code = ?, checked_at = ?, updated_at = ?, final_at = ?
         WHERE dedupe_key = ?`
      )
      .run(finalStatus, error, code, nowIso(), nowIso(), nowIso(), row.dedupe_key);
    logSend({
      client: row.client_name,
      status: finalStatus,
      code,
      messageId: row.message_id,
    });
    if (row.alerted_at) continue;
    const reason =
      code === "unconfirmed"
        ? "The carrier never confirmed this text. Check it in GoHighLevel."
        : plainSmsFailure({ status: "failed", delivery: finalStatus, error: error || code }) ||
          "The text didn't arrive.";
    notices.push({
      client: row.client_name || "A client",
      reason,
      dedupeKey: row.dedupe_key,
    });
  }
  return notices;
}

const SMS_LOG = "[production-sms]";

export function smsLog(fields: Record<string, string | undefined>): void {
  const line = Object.entries(fields)
    .map(([key, value]) => `${key}=${value || "-"}`)
    .join(" ");
  console.log(`${SMS_LOG} ${line}`);
}

export function unresolvedLocationMessage(raw: string): string | null {
  const id = raw.trim();
  if (!id) return "PRODUCTION_SMS_LOCATION_ID is not set.";
  if (id.includes("${{") || id.includes("}}")) {
    return "PRODUCTION_SMS_LOCATION_ID is still a Railway reference and did not resolve to a GoHighLevel location id. No text was sent.";
  }
  return null;
}

export function classifyDeliveryStatus(raw: string | undefined): SmsDeliveryStatus {
  const status = (raw || "").trim().toLowerCase();
  if (status === "delivered" || status === "opened" || status === "read" || status === "clicked" || status === "connected") {
    return "delivered";
  }
  if (status === "sent") return "sent";
  if (status === "failed") return "failed";
  if (status === "undelivered" || status === "opt_out") return "undelivered";
  return "queued";
}

export function terminalDelivery(status: SmsDeliveryStatus): boolean {
  return status === "delivered" || status === "failed" || status === "undelivered";
}

export function smsDndState(payload: unknown): { blocked: boolean; state: string } {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const contact =
    root.contact && typeof root.contact === "object"
      ? (root.contact as Record<string, unknown>)
      : root;
  if (contact.dnd === true) return { blocked: true, state: "all channels" };
  const settings =
    contact.dndSettings && typeof contact.dndSettings === "object"
      ? (contact.dndSettings as Record<string, unknown>)
      : {};
  const smsRaw = settings.SMS ?? settings.sms;
  const sms = smsRaw && typeof smsRaw === "object" ? (smsRaw as Record<string, unknown>) : {};
  const status = String(sms.status || "").toLowerCase();
  if (status === "active" || status === "permanent") {
    return { blocked: true, state: status };
  }
  return { blocked: false, state: status || "off" };
}

export function interpretA2p(payload: unknown | null): {
  state: "approved" | "blocked" | "unknown";
  detail: string;
} {
  if (payload == null) {
    return { state: "unknown", detail: "GoHighLevel did not return an A2P campaign list." };
  }
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const nested =
    record.data && typeof record.data === "object" && !Array.isArray(record.data)
      ? (record.data as Record<string, unknown>)
      : null;
  const list = [
    record.campaigns,
    record.data,
    record.a2pCampaigns,
    nested?.campaigns,
    nested?.a2pCampaigns,
  ].find(Array.isArray) as unknown[] | undefined;
  if (!list) {
    return { state: "unknown", detail: "GoHighLevel did not include an A2P campaign list." };
  }
  if (list.length === 0) {
    return { state: "blocked", detail: "No A2P campaign is registered on this sub-account." };
  }
  const statuses = list.map((item) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return String(row.status || row.campaignStatus || row.state || "").trim();
  });
  const approved = statuses.some((status) => /approved|verified|active|registered/i.test(status));
  if (approved) return { state: "approved", detail: statuses.filter(Boolean).join(", ") || "approved" };
  return {
    state: "blocked",
    detail: `A2P is not approved (${statuses.filter(Boolean).join(", ") || "no status"}).`,
  };
}

/**
 * A note for the log when the number or A2P read is empty or failed.
 * This never stops a send. GoHighLevel uses the location's default number.
 */
export function smsLookupWarning(args: {
  numbers: GhlPhoneNumber[];
  numbersError?: string;
}): string {
  if (args.numbersError && args.numbers.length === 0) {
    return `Phone number lookup failed (${args.numbersError}). Sending anyway.`;
  }
  if (args.numbers.length === 0) {
    return "Phone number lookup returned nothing. Sending anyway so GoHighLevel can use the location default.";
  }
  return "";
}

/** Kept so a lookup can never be turned back into a reason to refuse the text. */
export function smsPreflightError(args: {
  numbers: GhlPhoneNumber[];
  numbersError?: string;
  a2p: { state: "approved" | "blocked" | "unknown"; detail: string };
}): string | null {
  smsLookupWarning(args);
  return null;
}

export function pickFromNumber(numbers: GhlPhoneNumber[]): string {
  const smsNumbers = numbers.filter((number) => number.sms && number.smsKnown);
  const pool = smsNumbers.length ? smsNumbers : numbers;
  return (pool.find((number) => number.isDefault) || pool[0])?.phoneNumber || "";
}

export type MessageSnapshot = {
  status: SmsDeliveryStatus;
  error: string;
  fromNumber: string;
};

export function snapshotFromMessage(payload: unknown): MessageSnapshot {
  const root = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const message =
    root.message && typeof root.message === "object"
      ? (root.message as Record<string, unknown>)
      : root;
  return {
    status: classifyDeliveryStatus(String(message.status || "")),
    error: String(message.error || root.error || "").trim(),
    fromNumber: String(message.from || root.from || "").trim(),
  };
}

const POLL_WAITS_MS = [0, 2000, 2500, 2500, 3000];

export async function pollMessageDelivery(args: {
  read: () => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
}): Promise<MessageSnapshot> {
  const sleep = args.sleep || ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let latest: MessageSnapshot = { status: "queued", error: "", fromNumber: "" };
  for (let i = 0; i < POLL_WAITS_MS.length; i++) {
    if (POLL_WAITS_MS[i] > 0) await sleep(POLL_WAITS_MS[i]);
    try {
      latest = snapshotFromMessage(await args.read());
    } catch (err) {
      latest = {
        ...latest,
        error: err instanceof Error ? err.message : "Could not read the message.",
      };
    }
    if (terminalDelivery(latest.status)) return latest;
  }
  return latest;
}

export type SmsTransportInput = {
  locationId: string;
  phone: string;
  name: string;
  email?: string;
  message: string;
};

export type SmsTransport = (
  input: SmsTransportInput
) => Promise<{ messageId?: string; delivery?: SmsDeliveryStatus }>;

type LiveSmsDeps = {
  listNumbers: (locationId: string) => Promise<GhlPhoneNumber[]>;
  readA2p: (locationId: string) => Promise<unknown | null>;
  locationName: (locationId: string) => Promise<string>;
  upsert: (
    locationId: string,
    input: { phone: string; name?: string; email?: string }
  ) => Promise<string>;
  getContact: (locationId: string, contactId: string) => Promise<unknown>;
  send: (
    locationId: string,
    input: { contactId: string; phone: string; message: string }
  ) => Promise<{ messageId?: string }>;
  readMessage: (locationId: string, messageId: string) => Promise<unknown>;
};

const realSmsDeps: LiveSmsDeps = {
  listNumbers: listLocationPhoneNumbers,
  readA2p: getLocationA2p,
  locationName: getLocationName,
  upsert: upsertContactByPhone,
  getContact: getGhlContact,
  send: sendLocationSms,
  readMessage: getConversationMessage,
};

async function liveDeliver(
  input: SmsTransportInput & { message: string },
  deps: LiveSmsDeps = realSmsDeps
): Promise<ScheduleSmsResult> {
  const message = guardProductionSms(input.message);
  const locationName = await deps.locationName(input.locationId);
  let numbers: GhlPhoneNumber[] = [];
  let numbersError = "";
  try {
    numbers = await deps.listNumbers(input.locationId);
  } catch (err) {
    numbersError = err instanceof Error ? err.message : "Could not read phone numbers";
  }
  let a2p = interpretA2p(null);
  try {
    a2p = interpretA2p(await deps.readA2p(input.locationId));
  } catch (err) {
    a2p = {
      state: "unknown",
      detail: err instanceof Error ? err.message : "Could not read A2P registration",
    };
  }
  const fromNumber = pickFromNumber(numbers);
  const warning = smsLookupWarning({ numbers, numbersError });
  smsLog({
    step: "preflight",
    locationId: input.locationId,
    locationName,
    fromNumber,
    a2p: `${a2p.state}: ${a2p.detail}`,
    warning,
  });

  const contactId = await deps.upsert(input.locationId, {
    phone: input.phone,
    name: input.name,
    email: input.email,
  });
  const dnd = smsDndState(await deps.getContact(input.locationId, contactId));
  smsLog({
    step: "dnd",
    locationId: input.locationId,
    locationName,
    contactId,
    dnd: dnd.state,
  });
  if (dnd.blocked) {
    return {
      status: "failed",
      error: `This contact is Do Not Disturb for SMS (${dnd.state}). Nothing was sent.`,
      httpStatus: 400,
      phone: input.phone,
      message: message,
      locationId: input.locationId,
      locationName,
      fromNumber,
      dnd: dnd.state,
    };
  }

  const sent = await deps.send(input.locationId, {
    contactId,
    phone: input.phone,
    message: message,
  });
  const snapshot = await pollMessageDelivery({
    read: () => deps.readMessage(input.locationId, sent.messageId || ""),
  });
  const reportedFrom = snapshot.fromNumber || fromNumber;
  smsLog({
    step: "delivery",
    locationId: input.locationId,
    locationName,
    fromNumber: reportedFrom,
    messageId: sent.messageId,
    delivery: snapshot.status,
    dnd: dnd.state,
    error: snapshot.error,
  });
  const outcome: SmsOutcome & { phone: string } = {
    phone: input.phone,
    message: message,
    messageId: sent.messageId,
    delivery: snapshot.status,
    fromNumber: reportedFrom,
    locationId: input.locationId,
    locationName,
    dnd: dnd.state,
  };
  if (snapshot.status === "failed" || snapshot.status === "undelivered") {
    return {
      status: "failed",
      error: snapshot.error || `GoHighLevel marked this text ${snapshot.status}.`,
      httpStatus: 502,
      ...outcome,
    };
  }
  return { status: "sent", ...outcome };
}

/** Same send path as production, with the lookup and the GHL write supplied by the caller. */
export async function deliverProductionSms(
  input: SmsTransportInput & { message: string },
  deps: LiveSmsDeps
): Promise<ScheduleSmsResult> {
  return liveDeliver(input, deps);
}

type SmsClient = Pick<
  RevClient,
  "id" | "name" | "contact_name" | "contact_phone" | "contact_email"
>;

function alreadySent(dedupeKey: string): boolean {
  const row = getDb()
    .prepare(`SELECT dedupe_key FROM production_sms_sends WHERE dedupe_key = ?`)
    .get(dedupeKey);
  return Boolean(row);
}

function recordSmsSend(args: {
  dedupeKey: string;
  clientId: string;
  clientName: string;
  phone: string;
  kind: string;
  body: string;
  messageId: string;
  status: string;
  errorCode: string;
  errorText: string;
  final: boolean;
}): void {
  const ts = nowIso();
  getDb()
    .prepare(
      `INSERT INTO production_sms_sends
        (dedupe_key, client_id, client_name, phone, kind, body, created_at,
         message_id, status, error_code, error_text, updated_at, checked_at, final_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      args.dedupeKey,
      args.clientId,
      args.clientName,
      args.phone,
      args.kind,
      args.body,
      ts,
      args.messageId,
      args.status,
      args.errorCode,
      args.errorText,
      ts,
      ts,
      args.final ? ts : ""
    );
}

function logSend(args: {
  client: string;
  status: string;
  code?: string;
  messageId?: string;
}): void {
  console.log(formatSendLog(args));
}

function logSkip(clientName: string, detail: string, code: string): void {
  console.log(`[production-sms] ${clientName}: ${detail}`);
  logSend({ client: clientName, status: "skipped", code });
}

export async function sendScheduleNudgeSms(args: {
  kind: ScheduleSmsKind;
  client: SmsClient;
  url: string;
  dedupeKey: string;
  transport?: SmsTransport;
}): Promise<ScheduleSmsResult> {
  const name = args.client.name || "Client";
  if (!scheduleSmsEnabled()) return { status: "skipped", reason: "disabled" };

  const locationId = productionSmsLocationId();
  const unresolved = unresolvedLocationMessage(process.env.PRODUCTION_SMS_LOCATION_ID || "");
  if (locationId && unresolved) {
    logSkip(name, unresolved, "no_location");
    return { status: "failed", error: unresolved, httpStatus: 400, locationId };
  }
  if (!locationId) {
    logSkip(
      name,
      "Scheduling text skipped because PRODUCTION_SMS_LOCATION_ID is not set. The email still goes out.",
      "no_location"
    );
    return { status: "skipped", reason: "no_location" };
  }

  const url = (args.url || "").trim();
  if (!url) {
    logSkip(
      name,
      "Scheduling text skipped because there is no scheduling link.",
      "no_link"
    );
    return { status: "skipped", reason: "no_link" };
  }

  const phone = normalizePhoneE164(args.client.contact_phone || "");
  if (!args.client.contact_phone?.trim()) {
    logSkip(
      name,
      "No contact phone on this client, so no scheduling text was sent. The email still goes out.",
      "no_phone"
    );
    return { status: "skipped", reason: "no_phone" };
  }
  if (!phone) {
    logSkip(
      name,
      `The contact phone "${args.client.contact_phone}" is not a usable number, so no scheduling text was sent.`,
      "invalid_phone"
    );
    return { status: "skipped", reason: "invalid_phone" };
  }

  if (alreadySent(args.dedupeKey)) {
    return { status: "skipped", reason: "duplicate" };
  }

  const message = scheduleNudgeSmsBody({
    kind: args.kind,
    contactName: args.client.contact_name,
    url,
  });
  try {
    const result = args.transport
      ? await stubDeliver({
          transport: args.transport,
          locationId,
          phone,
          name: args.client.contact_name?.trim() || name,
          email: args.client.contact_email?.trim() || undefined,
          message,
        })
      : await liveDeliver({
          locationId,
          phone,
          name: args.client.contact_name?.trim() || name,
          email: args.client.contact_email?.trim() || undefined,
          message,
        });
    return rememberSmsSend({
      dedupeKey: args.dedupeKey,
      clientId: args.client.id,
      clientName: name,
      phone,
      kind: args.kind,
      message,
      result,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Text failed";
    console.log(`[production-sms] ${name}: Scheduling text failed and the email was not affected. ${error}`);
    const failed = { status: "failed" as const, error };
    rememberSmsSend({
      dedupeKey: args.dedupeKey,
      clientId: args.client.id,
      clientName: name,
      phone,
      kind: args.kind,
      message,
      result: failed,
    });
    return failed;
  }
}

function rememberSmsSend(args: {
  dedupeKey: string;
  clientId: string;
  clientName: string;
  phone: string;
  kind: string;
  message: string;
  result: ScheduleSmsResult;
}): ScheduleSmsResult {
  const errorText = args.result.status === "failed" ? args.result.error : "";
  const delivery = args.result.delivery;
  const status =
    args.result.status === "sent"
      ? delivery || "queued"
      : args.result.status === "failed"
        ? delivery || "failed"
        : args.result.reason || args.result.status;
  const code = smsErrorCode(errorText);
  logSend({
    client: args.clientName,
    status,
    code,
    messageId: args.result.messageId,
  });
  const messageId = args.result.messageId || "";
  const failed = args.result.status === "failed" || delivery === "failed" || delivery === "undelivered";
  if (!messageId && args.result.status !== "failed") return args.result;
  const key = messageId ? args.dedupeKey : `attempt:${args.dedupeKey}:${nowIso()}`;
  try {
    recordSmsSend({
      dedupeKey: key,
      clientId: args.clientId,
      clientName: args.clientName,
      phone: args.phone,
      kind: args.kind,
      body: args.message,
      messageId,
      status,
      errorCode: code,
      errorText,
      final: failed || delivery === "delivered",
    });
  } catch (err) {
    const messageText = err instanceof Error ? err.message : "";
    if (messageId && /UNIQUE/i.test(messageText)) {
      return { status: "skipped", reason: "duplicate" };
    }
    throw err;
  }
  if (!failed) clearFailure("production_sms", args.clientName);
  return args.result;
}

async function stubDeliver(args: SmsTransportInput & { transport: SmsTransport; message: string }): Promise<ScheduleSmsResult> {
  const message = guardProductionSms(args.message);
  const sent = await args.transport({ ...args, message });
  if (!sent.messageId) {
    return {
      status: "failed",
      error: "GoHighLevel did not return a message id, so the text was not accepted.",
      httpStatus: 502,
      phone: args.phone,
      message,
      locationId: args.locationId,
    };
  }
  return {
    status: "sent",
    phone: args.phone,
    message,
    messageId: sent.messageId,
    locationId: args.locationId,
    delivery: sent.delivery,
  };
}

/** One text to a number typed by hand. Does not look up or text a client. */
export async function sendSampleScheduleSms(args: {
  phone: string;
  contactName?: string;
  email?: string;
  /** False sends the same text with no link, to see if the link is filtered. */
  includeLink?: boolean;
  transport?: SmsTransport;
}): Promise<ScheduleSmsResult> {
  const rawLocation = process.env.PRODUCTION_SMS_LOCATION_ID || "";
  const unresolved = unresolvedLocationMessage(rawLocation);
  const locationId = productionSmsLocationId();
  if (locationId && unresolved) {
    smsLog({ step: "location", locationId, error: unresolved });
    return { status: "failed", error: unresolved, httpStatus: 400, locationId };
  }
  if (!locationId) return { status: "skipped", reason: "no_location" };
  const phone = normalizePhoneE164(args.phone);
  if (!phone) return { status: "skipped", reason: "invalid_phone" };
  const message = sampleScheduleSmsBody(
    args.contactName || "",
    scheduleUrl(SAMPLE_SCHEDULE_TOKEN),
    args.includeLink !== false
  );
  const name = args.contactName?.trim() || "Sample";
  const email = args.email?.trim() || undefined;
  try {
    if (args.transport) {
      return stubDeliver({
        transport: args.transport,
        locationId,
        phone,
        name,
        email,
        message,
      });
    }
    return liveDeliver({
      locationId,
      phone,
      name,
      email,
      message,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Text failed";
    smsLog({ step: "delivery", locationId, phone, error });
    return { status: "failed", error, httpStatus: 502, phone, message, locationId };
  }
}

function looksLikeAgencyLocation(name: string): string | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  if (n.includes("marketing empire")) return "Name matches Marketing Empire";
  if (n === "meg" || n.startsWith("meg ") || n.endsWith(" meg")) return "Name is MEG";
  return null;
}

export type SmsLocationDetail = {
  id: string;
  name: string;
  reason: string;
  numbers: GhlPhoneNumber[];
  a2p: string;
  error?: string;
};

export type SmsLocationReport = {
  enabled: boolean;
  configuredLocationId: string;
  configured: SmsLocationDetail | null;
  candidates: SmsLocationDetail[];
  error?: string;
};

/**
 * Read-only. Names the GHL locations that look like the agency's own
 * sub-account and whether each has an SMS-capable number. Does not send.
 */
async function locationDetail(
  id: string,
  name: string,
  reason: string
): Promise<SmsLocationDetail> {
  let numbers: GhlPhoneNumber[] = [];
  let error = "";
  try {
    numbers = await listLocationPhoneNumbers(id);
  } catch (err) {
    error = err instanceof Error ? err.message : "Could not read phone numbers";
  }
  let a2p = "";
  try {
    a2p = interpretA2p(await getLocationA2p(id)).detail;
  } catch (err) {
    a2p = err instanceof Error ? err.message : "Could not read A2P registration";
  }
  return { id, name, reason, numbers, a2p, ...(error ? { error } : {}) };
}

export async function describeProductionSmsLocations(): Promise<SmsLocationReport> {
  const configuredLocationId = productionSmsLocationId();
  const report: SmsLocationReport = {
    enabled: scheduleSmsEnabled(),
    configuredLocationId,
    configured: null,
    candidates: [],
  };
  try {
    const locations = await listLocations();
    const hits = locations.filter((location) => looksLikeAgencyLocation(location.name));
    for (const location of hits) {
      report.candidates.push(
        await locationDetail(
          location.id,
          location.name,
          looksLikeAgencyLocation(location.name) || "Name match"
        )
      );
    }
    if (configuredLocationId) {
      const known = locations.find((location) => location.id === configuredLocationId);
      report.configured = await locationDetail(
        configuredLocationId,
        known?.name || "",
        known ? "PRODUCTION_SMS_LOCATION_ID" : "PRODUCTION_SMS_LOCATION_ID is not in the agency location list"
      );
    }
  } catch (err) {
    report.error = err instanceof Error ? err.message : "Could not list GoHighLevel locations";
  }
  return report;
}
