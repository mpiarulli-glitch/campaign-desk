/**
 * Which email or SMS drove a form fill or booking.
 *
 * Confirmed credit (in order):
 *   1. Contact custom fields Converted Campaign / Content / Source / Date,
 *      resolved by name per sub-account — GHL field ids are not stable.
 *   2. Latest attribution UTMs (lastAttributionSource).
 *   3. First attribution UTMs (attributionSource).
 * Only utm source email or sms counts. A paid-ad or direct visit is not an
 * email/SMS win.
 *
 * Inferred credit is the fallback, and it is contact-specific. The message
 * has to be on that contact's conversation: received, and matched by campaign
 * id or subject/name when a known send exists. An account blast from the same
 * week is not credit. Form fills still need the email opened within the
 * attribution window. SMS credit requires the outbound SMS on the thread.
 */

import {
  DEFAULT_ATTRIBUTION_DAYS,
  FORM_FILL_TAGS,
  MEETING_BOOKED_TAGS,
  contactHasTag,
  emailLabelsMatch,
  pickSendForEmailTouch,
  type AttributionSend,
  type ConversionEvent,
} from "./email-conversion-attribution";
import {
  isOutboundMarketingTouchMessage,
  isTransactionalEmailContent,
  marketingEmailWasOpened,
  outboundEmailIsBefore,
} from "./ghl-contact-email-touch";

export type MessageSource = "email" | "sms";
export type AttributionConfidence = "confirmed" | "inferred";
export type AttributionBasis =
  | "converted_fields"
  | "latest_utm"
  | "first_utm"
  | "inferred";
export type InferredMatch = "campaign_id" | "subject" | "thread";

export type ResolvedConvertedFields = {
  campaignId: string | null;
  contentId: string | null;
  sourceId: string | null;
  dateId: string | null;
};

export type UtmCredit = {
  confidence: "confirmed";
  basis: Exclude<AttributionBasis, "inferred">;
  source: MessageSource;
  campaign: string;
  content: string;
  convertedOn: string | null;
};

export type InferredCredit = {
  confidence: "inferred";
  basis: "inferred";
  source: MessageSource;
  campaign: string | null;
  content: string;
  sendId: string | null;
  sendOn: string | null;
  subject: string | null;
  matchedBy: InferredMatch;
};

export type AttributionRow = {
  id: string;
  contactId: string;
  contactName: string | null;
  contactEmail: string | null;
  kind: "form_fill" | "appointment";
  /** YYYY-MM-DD */
  at: string;
  confidence: AttributionConfidence;
  basis: AttributionBasis;
  source: MessageSource;
  campaign: string | null;
  content: string;
  sendId: string | null;
  sendOn: string | null;
  subject: string | null;
  matchedBy: InferredMatch | null;
};

export type ContentGroup = {
  clientId: string;
  clientName: string;
  content: string;
  source: MessageSource;
  campaign: string | null;
  confidence: AttributionConfidence;
  formFills: number;
  appointments: number;
};

export type AttributionSummary = {
  confirmedAppointments: number;
  confirmedFormFills: number;
  inferredAppointments: number;
  inferredFormFills: number;
  emailAppointments: number;
  emailFormFills: number;
  smsAppointments: number;
  smsFormFills: number;
  attributedAppointments: number;
  attributedFormFills: number;
};

const FIELD_NAMES = {
  campaign: "convertedcampaign",
  content: "convertedcontent",
  source: "convertedsource",
  date: "converteddate",
} as const;

const DAY_MS = 86_400_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

/** Lowercase, drop punctuation, so "Converted Content" and field keys compare. */
export function normalizeFieldLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function ymd(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) {
    const month = us[1].padStart(2, "0");
    const day = us[2].padStart(2, "0");
    return `${us[3]}-${month}-${day}`;
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function dayDiff(later: string, earlier: string): number {
  const a = Date.parse(`${later}T12:00:00.000Z`);
  const b = Date.parse(`${earlier}T12:00:00.000Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  return Math.round((a - b) / DAY_MS);
}

export function inWindow(value: string | null | undefined, start: string, end: string): boolean {
  const day = ymd(value);
  if (!day) return false;
  return day >= start && day <= end;
}

/**
 * Trailhead Family Chiropractic is a HIPAA sub-account. Attribution scans
 * must not call it. Match the practice name, not a bare "Trailhead".
 */
export function isHipaaBlockedAccount(name: string | null | undefined): boolean {
  const n = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!n) return false;
  return n.includes("trailhead") && n.includes("chiro");
}

/** email | sms. "email marketing" counts as email. Ads and direct do not. */
export function normalizeMessageSource(value: unknown): MessageSource | null {
  const s = String(value ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  if (s === "sms" || s === "text" || s === "text message" || s.startsWith("sms ")) {
    return "sms";
  }
  if (
    s === "email" ||
    s === "e mail" ||
    s === "mail" ||
    s.startsWith("email ") ||
    s.startsWith("e mail ")
  ) {
    return "email";
  }
  return null;
}

function utmsFromUrl(url: string): {
  source: string;
  campaign: string;
  content: string;
} {
  const empty = { source: "", campaign: "", content: "" };
  if (!url || !url.includes("utm_")) return empty;
  try {
    const parsed = new URL(url, "https://attribution.local");
    return {
      source: parsed.searchParams.get("utm_source") || "",
      campaign: parsed.searchParams.get("utm_campaign") || "",
      content: parsed.searchParams.get("utm_content") || "",
    };
  } catch {
    return empty;
  }
}

function utmsFromText(text: string): {
  source: string;
  campaign: string;
  content: string;
} {
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return { source: "", campaign: "", content: "" };
  return utmsFromUrl(match[0].replace(/[),.;]+$/, ""));
}

export type CustomFieldDef = {
  id?: string;
  name?: string;
  fieldKey?: string;
  field_key?: string;
  dataType?: string;
  model?: string;
};

/**
 * Map Converted Campaign / Content / Source / Date to this sub-account's ids.
 * Name wins. fieldKey (`contact.converted_content`) is the fallback.
 */
export function resolveConvertedFieldIds(
  fields: CustomFieldDef[] | null | undefined
): ResolvedConvertedFields {
  const ids: ResolvedConvertedFields = {
    campaignId: null,
    contentId: null,
    sourceId: null,
    dateId: null,
  };
  const slots: Array<[keyof typeof FIELD_NAMES, keyof ResolvedConvertedFields]> = [
    ["campaign", "campaignId"],
    ["content", "contentId"],
    ["source", "sourceId"],
    ["date", "dateId"],
  ];
  for (const field of fields || []) {
    const id = pickString(field.id);
    if (!id) continue;
    const name = normalizeFieldLabel(pickString(field.name));
    const key = normalizeFieldLabel(
      pickString(field.fieldKey, field.field_key).replace(/^contact\.?/i, "")
    );
    for (const [label, slot] of slots) {
      if (ids[slot]) continue;
      if (name === FIELD_NAMES[label] || key === FIELD_NAMES[label]) {
        ids[slot] = id;
      }
    }
  }
  return ids;
}

function fieldValueToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  const rec = asRecord(value);
  if (!rec) return "";
  return fieldValueToString(
    rec.value ?? rec.fieldValue ?? rec.field_value ?? rec.date ?? ""
  );
}

export function customFieldEntries(
  contact: Record<string, unknown>
): Array<{ id: string; value: string }> {
  const raw = contact.customFields ?? contact.customField ?? contact.custom_fields;
  if (Array.isArray(raw)) {
    const out: Array<{ id: string; value: string }> = [];
    for (const item of raw) {
      const rec = asRecord(item);
      if (!rec) continue;
      const id = pickString(rec.id, rec.fieldId, rec.field_id, rec.key);
      if (!id) continue;
      out.push({
        id,
        value: fieldValueToString(rec.value ?? rec.fieldValue ?? rec.field_value),
      });
    }
    return out;
  }
  const rec = asRecord(raw);
  if (!rec) return [];
  return Object.entries(rec).map(([id, value]) => ({
    id,
    value: fieldValueToString(value),
  }));
}

function customFieldValue(
  contact: Record<string, unknown>,
  fieldId: string | null
): string {
  if (!fieldId) return "";
  const hit = customFieldEntries(contact).find((entry) => entry.id === fieldId);
  return hit?.value || "";
}

function snapshotFromParts(
  sourceRaw: string,
  campaignRaw: string,
  contentRaw: string
): { source: MessageSource; campaign: string; content: string } | null {
  let source = normalizeMessageSource(sourceRaw);
  const campaign = campaignRaw.trim();
  const content = contentRaw.trim();
  if (!source && /^sms[\s_-]/i.test(content || campaign)) source = "sms";
  if (!source) return null;
  if (!content && !campaign) return null;
  return {
    source,
    campaign,
    content: content || campaign,
  };
}

export function readUtmSnapshot(
  blob: unknown
): { source: MessageSource; campaign: string; content: string } | null {
  const rec = asRecord(blob);
  if (!rec) return null;
  const fromUrl = utmsFromUrl(pickString(rec.url, rec.pageUrl, rec.referrer));
  const source = pickString(
    rec.utmSource,
    rec.utm_source,
    fromUrl.source,
    rec.sessionSource,
    rec.session_source,
    rec.medium,
    rec.utmMedium,
    rec.utm_medium
  );
  const campaign = pickString(
    rec.utmCampaign,
    rec.utm_campaign,
    rec.campaign,
    fromUrl.campaign
  );
  const content = pickString(rec.utmContent, rec.utm_content, fromUrl.content);
  return snapshotFromParts(source, campaign, content);
}

function readConvertedSnapshot(
  contact: Record<string, unknown>,
  fieldIds: ResolvedConvertedFields
): {
  source: MessageSource;
  campaign: string;
  content: string;
  convertedOn: string | null;
} | null {
  const campaign = customFieldValue(contact, fieldIds.campaignId);
  const content = customFieldValue(contact, fieldIds.contentId);
  const source = customFieldValue(contact, fieldIds.sourceId);
  const convertedOn = ymd(customFieldValue(contact, fieldIds.dateId));
  const snap = snapshotFromParts(source, campaign, content);
  if (!snap) return null;
  return { ...snap, convertedOn };
}

function attributionBlob(
  contact: Record<string, unknown>,
  which: "last" | "first"
): unknown {
  if (which === "last") {
    return (
      contact.lastAttributionSource ??
      contact.last_attribution_source ??
      contact.lastAttribution ??
      null
    );
  }
  return contact.attributionSource ?? contact.attribution_source ?? null;
}

/**
 * Confirmed email/SMS credit on a contact, ignoring which event it belongs to.
 * Converted fields, then Latest attribution, then First.
 */
export function confirmedCreditFromContact(
  contact: Record<string, unknown>,
  fieldIds: ResolvedConvertedFields
): UtmCredit | null {
  const converted = readConvertedSnapshot(contact, fieldIds);
  if (converted) {
    return {
      confidence: "confirmed",
      basis: "converted_fields",
      source: converted.source,
      campaign: converted.campaign,
      content: converted.content,
      convertedOn: converted.convertedOn,
    };
  }
  const latest = readUtmSnapshot(attributionBlob(contact, "last"));
  if (latest) {
    return {
      confidence: "confirmed",
      basis: "latest_utm",
      source: latest.source,
      campaign: latest.campaign,
      content: latest.content,
      convertedOn: null,
    };
  }
  const first = readUtmSnapshot(attributionBlob(contact, "first"));
  if (first) {
    return {
      confidence: "confirmed",
      basis: "first_utm",
      source: first.source,
      campaign: first.campaign,
      content: first.content,
      convertedOn: null,
    };
  }
  return null;
}

/**
 * Attach confirmed credit to one conversion.
 * Converted fields apply on the Converted Date (same calendar day). When the
 * date is blank they apply only if this contact has a single in-window event,
 * so one stamp is not copied onto every booking. Otherwise Latest, then First.
 */
export function confirmedCreditForEvent(
  contact: Record<string, unknown>,
  eventAt: string,
  fieldIds: ResolvedConvertedFields,
  siblingEventCount: number
): UtmCredit | null {
  const credit = confirmedCreditFromContact(contact, fieldIds);
  if (!credit) return null;
  if (credit.basis !== "converted_fields") return credit;
  const eventDay = ymd(eventAt);
  if (!eventDay) return null;
  if (credit.convertedOn) {
    if (credit.convertedOn !== eventDay) {
      const latest = readUtmSnapshot(attributionBlob(contact, "last"));
      if (latest) {
        return {
          confidence: "confirmed",
          basis: "latest_utm",
          source: latest.source,
          campaign: latest.campaign,
          content: latest.content,
          convertedOn: null,
        };
      }
      const first = readUtmSnapshot(attributionBlob(contact, "first"));
      if (first) {
        return {
          confidence: "confirmed",
          basis: "first_utm",
          source: first.source,
          campaign: first.campaign,
          content: first.content,
          convertedOn: null,
        };
      }
      return null;
    }
    return credit;
  }
  if (siblingEventCount > 1) {
    const latest = readUtmSnapshot(attributionBlob(contact, "last"));
    if (latest) {
      return {
        confidence: "confirmed",
        basis: "latest_utm",
        source: latest.source,
        campaign: latest.campaign,
        content: latest.content,
        convertedOn: null,
      };
    }
    return null;
  }
  return credit;
}

function contactTags(contact: Record<string, unknown>): string[] {
  const tags = contact.tags;
  if (!Array.isArray(tags)) return [];
  return tags.map((tag) => String(tag));
}

export function contactDisplayName(contact: Record<string, unknown>): string | null {
  const first = pickString(contact.firstName, contact.first_name);
  const last = pickString(contact.lastName, contact.last_name);
  const named = pickString(contact.name, contact.contactName) || [first, last].filter(Boolean).join(" ");
  return named.trim() || null;
}

export function contactDisplayEmail(contact: Record<string, unknown>): string | null {
  return pickString(contact.email, contact.emailAddress) || null;
}

/**
 * One row when the workflow stamped Converted Date but the forms/calendar
 * APIs did not return an event. Kind comes from tags. Both tags → appointment
 * only, so the latest stamp is not counted twice.
 */
export function kindFromConversionTags(
  tags: string[]
): "form_fill" | "appointment" | null {
  const booked = contactHasTag(tags, MEETING_BOOKED_TAGS);
  const form = contactHasTag(tags, FORM_FILL_TAGS);
  if (booked) return "appointment";
  if (form) return "form_fill";
  return null;
}

function isSmsMessage(msg: Record<string, unknown>): boolean {
  const messageType = String(msg.messageType || msg.type || "").toLowerCase();
  if (messageType.includes("email")) return false;
  if (messageType.includes("sms") || messageType.includes("text")) return true;
  if (msg.type === 2 || msg.type === "2" || msg.messageType === 2) return true;
  return false;
}

function isOutbound(direction: unknown): boolean {
  const d = String(direction || "").toLowerCase();
  return d === "outbound" || d === "outgoing" || d === "out";
}

function messageText(msg: Record<string, unknown>): string {
  const meta = asRecord(msg.meta);
  return [
    msg.body,
    msg.text,
    msg.message,
    msg.content,
    msg.snippet,
    msg.preview,
    meta?.body,
    meta?.text,
  ]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean)
    .join("\n");
}

function messageSubject(msg: Record<string, unknown>): string {
  const meta = asRecord(msg.meta);
  return pickString(msg.subject, msg.emailSubject, msg.title, msg.name, meta?.subject);
}

function messageCampaignId(msg: Record<string, unknown>): string {
  const meta = asRecord(msg.meta);
  return pickString(
    msg.campaignId,
    msg.bulkRequestId,
    msg.emailCampaignId,
    msg.workflowId,
    meta?.campaignId,
    meta?.bulkRequestId,
    meta?.emailCampaignId
  );
}

function messageOwnsContact(msg: Record<string, unknown>, contactId: string): boolean {
  const owner = pickString(msg.contactId, msg.contact_id);
  return !owner || owner === contactId;
}

function smsFailed(msg: Record<string, unknown>): boolean {
  const status = String(msg.status || "").toLowerCase();
  return /fail|undeliver|bounce|reject|opt/.test(status);
}

function smsLabel(text: string): string {
  const cleaned = text
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "SMS";
  if (cleaned.length > 80) return `${cleaned.slice(0, 77).trimEnd()}…`;
  return cleaned;
}

type ThreadCandidate = {
  at: number;
  day: string;
  source: MessageSource;
  msg: Record<string, unknown>;
};

function messageInstant(msg: Record<string, unknown>, day: string): number {
  const raw = pickString(msg.dateAdded, msg.createdAt, msg.date);
  const ms = Date.parse(raw);
  if (Number.isFinite(ms)) return ms;
  return Date.parse(`${day}T12:00:00.000Z`);
}

/**
 * Latest email or SMS on this contact's thread that can take inferred credit.
 * Known sends are used only when the thread message matches them by campaign
 * id or subject/name. A send that merely went out the same day is ignored.
 */
export function inferCreditFromMessages(input: {
  messages: Array<Record<string, unknown>>;
  contactId: string;
  eventAt: string;
  kind: "form_fill" | "appointment";
  sends?: AttributionSend[];
  attributionDays?: number;
  formFilledAt?: string | null;
}): InferredCredit | null {
  const before = ymd(input.eventAt);
  if (!before || !input.contactId) return null;
  const attributionDays = input.attributionDays ?? DEFAULT_ATTRIBUTION_DAYS;
  const formFilledAt = input.kind === "appointment" ? input.formFilledAt || null : null;
  const requireEmailOpen = input.kind === "form_fill";
  const candidates: ThreadCandidate[] = [];

  for (const msg of input.messages) {
    if (!messageOwnsContact(msg, input.contactId)) continue;
    if (!isOutbound(msg.direction)) continue;
    const rawAt = pickString(msg.dateAdded, msg.createdAt, msg.date);
    if (!rawAt || !outboundEmailIsBefore(rawAt, input.eventAt)) continue;
    const day = ymd(rawAt);
    if (!day) continue;
    const lag = dayDiff(before, day);
    if (lag < 0 || lag > attributionDays) continue;

    if (isSmsMessage(msg)) {
      if (smsFailed(msg)) continue;
      const text = [messageSubject(msg), messageText(msg)].filter(Boolean).join("\n");
      if (isTransactionalEmailContent(text)) continue;
      candidates.push({
        at: messageInstant(msg, day),
        day,
        source: "sms",
        msg,
      });
      continue;
    }

    const marketing = isOutboundMarketingTouchMessage(msg, {
      strict: true,
      formFilledAt,
    });
    if (!marketing) continue;
    if (requireEmailOpen && !marketingEmailWasOpened(msg)) continue;
    candidates.push({
      at: messageInstant(msg, day),
      day,
      source: "email",
      msg,
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.at - a.at);
  const winner = candidates[0];
  return creditFromThreadMessage(winner, input.sends || [], input.eventAt, attributionDays);
}

function creditFromThreadMessage(
  candidate: ThreadCandidate,
  sends: AttributionSend[],
  eventAt: string,
  attributionDays: number
): InferredCredit | null {
  const msg = candidate.msg;
  const subject = messageSubject(msg);
  const body = messageText(msg).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const linkUtm = utmsFromText(`${subject}\n${body}`);
  const campaignId = messageCampaignId(msg);
  const touch = {
    day: candidate.day,
    subject,
    text: body,
    campaignId,
  };

  let matched: AttributionSend | null = null;
  let matchedBy: InferredMatch = "thread";
  if (campaignId) {
    matched = sends.find((send) => send.id === campaignId) || null;
    if (matched) matchedBy = "campaign_id";
  }
  if (!matched && candidate.source === "email") {
    const picked = pickSendForEmailTouch(sends, eventAt, touch, attributionDays);
    if (picked) {
      matched = picked.send;
      matchedBy = "subject";
    }
  }
  if (!matched && candidate.source === "sms") {
    const haystack = subject || body;
    const named = sends.find((send) => {
      const labels = [send.subject, send.name].filter(
        (label): label is string => Boolean(label && label.trim())
      );
      return labels.some((label) => emailLabelsMatch(haystack, label));
    });
    if (named) {
      matched = named;
      matchedBy = "subject";
    }
  }

  const utmSource = normalizeMessageSource(linkUtm.source);
  const source = utmSource || candidate.source;
  const campaign =
    linkUtm.campaign.trim() ||
    (matched ? matched.name : "") ||
    "";
  const content =
    linkUtm.content.trim() ||
    (matched ? (matched.subject || matched.name).trim() : "") ||
    (candidate.source === "sms" ? smsLabel(body || subject) : subject || smsLabel(body));
  if (!content) return null;

  return {
    confidence: "inferred",
    basis: "inferred",
    source,
    campaign: campaign || null,
    content,
    sendId: matched?.id || null,
    sendOn: candidate.day,
    subject:
      candidate.source === "sms"
        ? smsLabel(body || subject)
        : subject || null,
    matchedBy,
  };
}

function rowFromConfirmed(
  contact: Record<string, unknown>,
  event: ConversionEvent,
  credit: UtmCredit
): AttributionRow {
  const at = ymd(event.at) || credit.convertedOn || "";
  return {
    id: event.id,
    contactId: String(contact.id || event.contactId || ""),
    contactName: contactDisplayName(contact),
    contactEmail: contactDisplayEmail(contact),
    kind: event.kind,
    at,
    confidence: "confirmed",
    basis: credit.basis,
    source: credit.source,
    campaign: credit.campaign || null,
    content: credit.content,
    sendId: null,
    sendOn: credit.convertedOn,
    subject: null,
    matchedBy: null,
  };
}

function rowFromInferred(
  contact: Record<string, unknown> | null,
  event: ConversionEvent,
  credit: InferredCredit
): AttributionRow {
  return {
    id: event.id,
    contactId: String(contact?.id || event.contactId || ""),
    contactName: contact ? contactDisplayName(contact) : null,
    contactEmail: contact ? contactDisplayEmail(contact) : null,
    kind: event.kind,
    at: ymd(event.at) || "",
    confidence: "inferred",
    basis: "inferred",
    source: credit.source,
    campaign: credit.campaign,
    content: credit.content,
    sendId: credit.sendId,
    sendOn: credit.sendOn,
    subject: credit.subject,
    matchedBy: credit.matchedBy,
  };
}

/**
 * Merge confirmed UTM credit with contact-thread inference.
 * One event → one row. Confirmed wins. Inferred is used only when the caller
 * already verified a message on that contact (pass it in `inferredByEventId`).
 * Contacts stamped with Converted Date and no API event become one tag-based row.
 */
export function assembleAttribution(input: {
  contacts: Array<Record<string, unknown>>;
  fieldIds: ResolvedConvertedFields;
  events: ConversionEvent[];
  inferredByEventId?: Record<string, InferredCredit | null | undefined>;
  start: string;
  end: string;
}): AttributionRow[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const contact of input.contacts) {
    const id = pickString(contact.id);
    if (id) byId.set(id, contact);
  }

  const inRange = input.events.filter((event) => inWindow(event.at, input.start, input.end));
  const siblings = new Map<string, number>();
  for (const event of inRange) {
    const id = event.contactId || "";
    if (!id) continue;
    siblings.set(id, (siblings.get(id) || 0) + 1);
  }

  const rows: AttributionRow[] = [];
  const convertedContactIds = new Set<string>();

  for (const event of inRange) {
    const contactId = event.contactId || "";
    const contact = contactId ? byId.get(contactId) : undefined;
    if (contact) {
      const confirmed = confirmedCreditForEvent(
        contact,
        event.at,
        input.fieldIds,
        siblings.get(contactId) || 1
      );
      if (confirmed) {
        const row = rowFromConfirmed(contact, event, confirmed);
        if (row.at) rows.push(row);
        if (confirmed.basis === "converted_fields") convertedContactIds.add(contactId);
        continue;
      }
    }
    const inferred = input.inferredByEventId?.[event.id];
    if (inferred) {
      const row = rowFromInferred(contact || null, event, inferred);
      if (row.at) rows.push(row);
    }
  }

  for (const contact of input.contacts) {
    const contactId = pickString(contact.id);
    if (!contactId || convertedContactIds.has(contactId)) continue;
    if (inRange.some((event) => event.contactId === contactId)) continue;
    const converted = readConvertedSnapshot(contact, input.fieldIds);
    if (!converted?.convertedOn) continue;
    if (!inWindow(converted.convertedOn, input.start, input.end)) continue;
    const kind = kindFromConversionTags(contactTags(contact));
    if (!kind) continue;
    rows.push({
      id: `converted:${contactId}:${converted.convertedOn}:${kind}`,
      contactId,
      contactName: contactDisplayName(contact),
      contactEmail: contactDisplayEmail(contact),
      kind,
      at: converted.convertedOn,
      confidence: "confirmed",
      basis: "converted_fields",
      source: converted.source,
      campaign: converted.campaign || null,
      content: converted.content,
      sendId: null,
      sendOn: converted.convertedOn,
      subject: null,
      matchedBy: null,
    });
  }

  return rows;
}

export function summarizeAttributionRows(rows: AttributionRow[]): AttributionSummary {
  const summary: AttributionSummary = {
    confirmedAppointments: 0,
    confirmedFormFills: 0,
    inferredAppointments: 0,
    inferredFormFills: 0,
    emailAppointments: 0,
    emailFormFills: 0,
    smsAppointments: 0,
    smsFormFills: 0,
    attributedAppointments: 0,
    attributedFormFills: 0,
  };
  for (const row of rows) {
    const form = row.kind === "form_fill";
    if (row.confidence === "confirmed") {
      if (form) summary.confirmedFormFills += 1;
      else summary.confirmedAppointments += 1;
    } else if (form) summary.inferredFormFills += 1;
    else summary.inferredAppointments += 1;
    if (row.source === "sms") {
      if (form) summary.smsFormFills += 1;
      else summary.smsAppointments += 1;
    } else if (form) summary.emailFormFills += 1;
    else summary.emailAppointments += 1;
    if (form) summary.attributedFormFills += 1;
    else summary.attributedAppointments += 1;
  }
  return summary;
}

export function groupAttributionByContent(
  rows: Array<
    Pick<
      AttributionRow,
      "content" | "source" | "campaign" | "confidence" | "kind"
    > & { clientId: string; clientName: string }
  >
): ContentGroup[] {
  const map = new Map<string, ContentGroup>();
  for (const row of rows) {
    const campaign = row.campaign || "";
    const key = [
      row.clientId,
      row.content,
      row.source,
      campaign,
      row.confidence,
    ].join("\u0000");
    const group = map.get(key) || {
      clientId: row.clientId,
      clientName: row.clientName,
      content: row.content,
      source: row.source,
      campaign: row.campaign,
      confidence: row.confidence,
      formFills: 0,
      appointments: 0,
    };
    if (row.kind === "form_fill") group.formFills += 1;
    else group.appointments += 1;
    map.set(key, group);
  }
  return [...map.values()].sort(
    (a, b) =>
      b.appointments - a.appointments ||
      b.formFills - a.formFills ||
      a.content.localeCompare(b.content) ||
      a.clientName.localeCompare(b.clientName)
  );
}
