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

export type ScheduleSmsResult =
  | { status: "sent"; phone: string; message?: string; messageId?: string }
  | {
      status: "skipped";
      reason: "disabled" | "no_phone" | "no_location" | "no_link" | "duplicate" | "invalid_phone";
    }
  | { status: "failed"; error: string };

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

async function defaultTransport(input: SmsTransportInput): Promise<{ messageId?: string }> {
  const contactId = await upsertContactByPhone(input.locationId, {
    phone: input.phone,
    name: input.name,
    email: input.email,
  });
  return sendLocationSms(input.locationId, {
    contactId,
    phone: input.phone,
    message: input.message,
  });
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
  const transport = args.transport || defaultTransport;
  try {
    await transport({
      locationId,
      phone,
      name: args.client.contact_name?.trim() || name,
      email: args.client.contact_email?.trim() || undefined,
      message,
    });
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
    return { status: "sent", phone };
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

/** One text to a number typed by hand. Does not look up or text a client. */
export async function sendSampleScheduleSms(args: {
  phone: string;
  contactName?: string;
  transport?: SmsTransport;
}): Promise<ScheduleSmsResult> {
  const locationId = productionSmsLocationId();
  if (!locationId) return { status: "skipped", reason: "no_location" };
  const phone = normalizePhoneE164(args.phone);
  if (!phone) return { status: "skipped", reason: "invalid_phone" };
  const message = sampleScheduleSmsBody(
    args.contactName || "",
    scheduleUrl(SAMPLE_SCHEDULE_TOKEN)
  );
  const transport = args.transport || defaultTransport;
  try {
    const sent = await transport({
      locationId,
      phone,
      name: args.contactName?.trim() || "Sample",
      message,
    });
    return { status: "sent", phone, message, messageId: sent.messageId };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Text failed";
    return { status: "failed", error };
  }
}

function looksLikeAgencyLocation(name: string): string | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  if (n.includes("marketing empire")) return "Name matches Marketing Empire";
  if (n === "meg" || n.startsWith("meg ") || n.endsWith(" meg")) return "Name is MEG";
  return null;
}

export type SmsLocationReport = {
  enabled: boolean;
  configuredLocationId: string;
  candidates: Array<{
    id: string;
    name: string;
    reason: string;
    numbers: GhlPhoneNumber[];
    error?: string;
  }>;
  error?: string;
};

/**
 * Read-only. Names the GHL locations that look like the agency's own
 * sub-account and whether each has an SMS-capable number. Does not send.
 */
export async function describeProductionSmsLocations(): Promise<SmsLocationReport> {
  const report: SmsLocationReport = {
    enabled: scheduleSmsEnabled(),
    configuredLocationId: productionSmsLocationId(),
    candidates: [],
  };
  try {
    const locations = await listLocations();
    const hits = locations.filter((location) => looksLikeAgencyLocation(location.name));
    for (const location of hits) {
      const reason = looksLikeAgencyLocation(location.name) || "Name match";
      try {
        const numbers = await listLocationPhoneNumbers(location.id);
        report.candidates.push({
          id: location.id,
          name: location.name,
          reason,
          numbers,
        });
      } catch (err) {
        report.candidates.push({
          id: location.id,
          name: location.name,
          reason,
          numbers: [],
          error: err instanceof Error ? err.message : "Could not read phone numbers",
        });
      }
    }
  } catch (err) {
    report.error = err instanceof Error ? err.message : "Could not list GoHighLevel locations";
  }
  return report;
}
