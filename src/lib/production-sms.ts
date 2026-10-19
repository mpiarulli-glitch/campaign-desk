// Scheduling texts. These exist for one reason: get the client to pick a
// production slot. Request-received, confirmed, crew renotify, and the
// missed-window booking page do not text.
//
// Client sends stay off unless PRODUCTION_SMS_ENABLED=1. A missing phone or
// a missing sending location never throws and never blocks the email.

import { scheduleUrl } from "./auth";
import { getDb, nowIso, type RevClient } from "./db";
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

const SMS_MAX = 300;

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
  const first = contactFirstName(args.contactName);
  const hello = first ? `Hi ${first}` : "Hi";
  const what =
    args.kind === "first_invite"
      ? "your first MEG production"
      : args.kind === "extra_invite"
        ? "a MEG production"
        : "your next MEG production";
  const link = (args.url || "").trim();
  let body = `${hello}, it's time to book ${what}. Pick a time here: ${link}`;
  if (body.length <= SMS_MAX) return body;
  body = `Hi, it's time to book ${what}. Pick a time here: ${link}`;
  if (body.length <= SMS_MAX) return body;
  const tight = `Hi, book ${what}: ${link}`;
  return tight.length <= SMS_MAX ? tight : tight.slice(0, SMS_MAX);
}

/** Sample text only. A real scheduling page, labeled as a test, not a client nudge. */
function sampleScheduleSmsBody(contactName: string, url: string): string {
  const first = contactFirstName(contactName);
  const hello = first ? `Hi ${first}` : "Hi";
  const link = (url || "").trim();
  let body = `${hello}, it's time to schedule your production. Pick a time here: ${link}`;
  if (body.length <= SMS_MAX) return body;
  body = `Hi, it's time to schedule your production. Pick a time here: ${link}`;
  if (body.length <= SMS_MAX) return body;
  const tight = `Hi, schedule your production: ${link}`;
  return tight.length <= SMS_MAX ? tight : tight.slice(0, SMS_MAX);
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
  const list = [record.campaigns, record.data, record.a2pCampaigns].find(Array.isArray) as
    | unknown[]
    | undefined;
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

const A2P_BLOCKED = /pending|fail|suspend|reject|unregistered|none|incomplete|not registered/i;

export function smsPreflightError(args: {
  numbers: GhlPhoneNumber[];
  numbersError?: string;
  a2p: { state: "approved" | "blocked" | "unknown"; detail: string };
}): string | null {
  if (args.numbersError && args.numbers.length === 0) {
    return `Could not read phone numbers for this sub-account. ${args.numbersError}`;
  }
  const smsNumbers = args.numbers.filter((number) => number.sms && number.smsKnown);
  if (smsNumbers.length === 0) {
    const found = args.numbers
      .map((number) => {
        const provider = number.provider ? ` ${number.provider}` : "";
        const flag = number.smsKnown ? "SMS off" : "SMS not marked";
        return `${number.phoneNumber}${provider} (${flag})`;
      })
      .join(", ");
    return found
      ? `This sub-account has no SMS-capable LC Phone or Twilio number. Found: ${found}.`
      : "This sub-account has no phone number, so a text cannot be sent.";
  }
  const blockedNumber = smsNumbers.find((number) => A2P_BLOCKED.test(number.a2pStatus));
  if (blockedNumber) {
    return `The sending number ${blockedNumber.phoneNumber} is not A2P-registered (${blockedNumber.a2pStatus}). US texts will not be delivered until that registration is approved in GoHighLevel.`;
  }
  if (args.a2p.state === "blocked") {
    return `${args.a2p.detail} US texts from a local number will not be delivered until A2P registration is approved in GoHighLevel.`;
  }
  return null;
}

export function pickFromNumber(numbers: GhlPhoneNumber[]): string {
  const smsNumbers = numbers.filter((number) => number.sms && number.smsKnown);
  return (smsNumbers.find((number) => number.isDefault) || smsNumbers[0])?.phoneNumber || "";
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
) => Promise<{ messageId?: string }>;

async function liveDeliver(input: SmsTransportInput & { message: string }): Promise<ScheduleSmsResult> {
  const locationName = await getLocationName(input.locationId);
  let numbers: GhlPhoneNumber[] = [];
  let numbersError = "";
  try {
    numbers = await listLocationPhoneNumbers(input.locationId);
  } catch (err) {
    numbersError = err instanceof Error ? err.message : "Could not read phone numbers";
  }
  let a2p = interpretA2p(null);
  try {
    a2p = interpretA2p(await getLocationA2p(input.locationId));
  } catch (err) {
    a2p = {
      state: "unknown",
      detail: err instanceof Error ? err.message : "Could not read A2P registration",
    };
  }
  const fromNumber = pickFromNumber(numbers);
  const problem = smsPreflightError({ numbers, numbersError, a2p });
  smsLog({
    step: "preflight",
    locationId: input.locationId,
    locationName,
    fromNumber,
    a2p: `${a2p.state}: ${a2p.detail}`,
    error: problem || "",
  });
  if (problem) {
    return {
      status: "failed",
      error: problem,
      httpStatus: 400,
      phone: input.phone,
      message: input.message,
      locationId: input.locationId,
      locationName,
      fromNumber,
    };
  }

  const contactId = await upsertContactByPhone(input.locationId, {
    phone: input.phone,
    name: input.name,
    email: input.email,
  });
  const dnd = smsDndState(await getGhlContact(input.locationId, contactId));
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
      message: input.message,
      locationId: input.locationId,
      locationName,
      fromNumber,
      dnd: dnd.state,
    };
  }

  const sent = await sendLocationSms(input.locationId, {
    contactId,
    phone: input.phone,
    message: input.message,
  });
  const snapshot = await pollMessageDelivery({
    read: () => getConversationMessage(input.locationId, sent.messageId || ""),
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
    message: input.message,
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

function markSent(args: {
  dedupeKey: string;
  clientId: string;
  phone: string;
  kind: string;
  body: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO production_sms_sends
        (dedupe_key, client_id, phone, kind, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(args.dedupeKey, args.clientId, args.phone, args.kind, args.body, nowIso());
}

function logSkip(clientName: string, detail: string, hint: string): void {
  console.log(`[production-sms] ${clientName}: ${detail}`);
  recordFailure({
    kind: "production_sms",
    subject: clientName || "Scheduling text",
    detail,
    hint,
  });
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
    logSkip(name, unresolved, "Set PRODUCTION_SMS_LOCATION_ID to the location id itself, not a Railway reference.");
    return { status: "failed", error: unresolved, httpStatus: 400, locationId };
  }
  if (!locationId) {
    logSkip(
      name,
      "Scheduling text skipped because PRODUCTION_SMS_LOCATION_ID is not set. The email still goes out.",
      "Set PRODUCTION_SMS_LOCATION_ID to the agency's own GoHighLevel sub-account."
    );
    return { status: "skipped", reason: "no_location" };
  }

  const url = (args.url || "").trim();
  if (!url) {
    logSkip(
      name,
      "Scheduling text skipped because there is no scheduling link.",
      "Open the client's schedule link from the production desk and resend."
    );
    return { status: "skipped", reason: "no_link" };
  }

  const phone = normalizePhoneE164(args.client.contact_phone || "");
  if (!args.client.contact_phone?.trim()) {
    logSkip(
      name,
      "No contact phone on this client, so no scheduling text was sent. The email still goes out.",
      "Add a mobile number next to the contact email on the client."
    );
    return { status: "skipped", reason: "no_phone" };
  }
  if (!phone) {
    logSkip(
      name,
      `The contact phone "${args.client.contact_phone}" is not a usable number, so no scheduling text was sent.`,
      "Enter the mobile number with an area code. It is stored as E.164."
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
    if (result.status !== "sent") {
      if (result.status === "failed") {
        logSkip(
          name,
          `Scheduling text failed and the email was not affected. ${result.error}`,
          "Check the GoHighLevel sub-account has an SMS-capable number, then resend."
        );
      }
      return result;
    }
    try {
      markSent({
        dedupeKey: args.dedupeKey,
        clientId: args.client.id,
        phone,
        kind: args.kind,
        body: message,
      });
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "";
      if (/UNIQUE/i.test(messageText)) return { status: "skipped", reason: "duplicate" };
      throw err;
    }
    clearFailure("production_sms", name);
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : "Text failed";
    logSkip(
      name,
      `Scheduling text failed and the email was not affected. ${error}`,
      "Check the GoHighLevel sub-account has an SMS-capable number, then resend."
    );
    return { status: "failed", error };
  }
}

async function stubDeliver(args: SmsTransportInput & { transport: SmsTransport; message: string }): Promise<ScheduleSmsResult> {
  const sent = await args.transport(args);
  if (!sent.messageId) {
    return {
      status: "failed",
      error: "GoHighLevel did not return a message id, so the text was not accepted.",
      httpStatus: 502,
      phone: args.phone,
      message: args.message,
      locationId: args.locationId,
    };
  }
  return {
    status: "sent",
    phone: args.phone,
    message: args.message,
    messageId: sent.messageId,
    locationId: args.locationId,
  };
}

/** One text to a number typed by hand. Does not look up or text a client. */
export async function sendSampleScheduleSms(args: {
  phone: string;
  contactName?: string;
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
    scheduleUrl(SAMPLE_SCHEDULE_TOKEN)
  );
  try {
    if (args.transport) {
      return stubDeliver({
        transport: args.transport,
        locationId,
        phone,
        name: args.contactName?.trim() || "Sample",
        message,
      });
    }
    return liveDeliver({
      locationId,
      phone,
      name: args.contactName?.trim() || "Sample",
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
