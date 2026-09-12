/**
 * Pure attribution helpers for Lifecycle money metrics.
 *
 * GHL does not stamp "this blast caused that booking". We credit a form fill or
 * appointment to the most recent campaign/flow send in the prior N days — same
 * windowing operators already use when reading open → book rates by eye.
 *
 * Abandoned-booking recovery is tag-based: contacts that got `abandoned booking`
 * and later show `meeting booked` (or a booked calendar event) count as recovered.
 */

export const FORM_FILL_TAGS = ["website form submission"] as const;
export const ABANDONED_BOOKING_TAGS = ["abandoned booking"] as const;
export const MEETING_BOOKED_TAGS = ["meeting booked"] as const;

export const DEFAULT_ATTRIBUTION_DAYS = 14;

export type SendChannel = "campaign" | "flow";

export type AttributionSend = {
  id: string;
  name: string;
  sentOn: string | null;
  channel: SendChannel;
};

export type ConversionEvent = {
  id: string;
  contactId: string | null;
  /** ISO or YYYY-MM-DD — when the form landed / appointment was booked. */
  at: string;
  kind: "form_fill" | "appointment";
};

export type SendConversionCounts = {
  formFills: number;
  appointments: number;
};

export type AbandonedContact = {
  id: string;
  tags: string[];
  dateAdded: string | null;
  dateUpdated: string | null;
};

export type AbandonedRecoverySummary = {
  abandoned: number;
  recovered: number;
  recoveryRate: number;
  /** Recovered contacts whose update/booking falls inside the analytics window. */
  recoveredInWindow: number;
  /** Still-open abandoners (have abandoned tag, no booked signal). */
  stillAbandoned: number;
};

const DAY_MS = 86_400_000;

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

function normalizeTags(tags: string[]): string[] {
  return tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
}

export function contactHasTag(tags: string[], candidates: readonly string[]): boolean {
  const set = new Set(normalizeTags(tags));
  return candidates.some((t) => set.has(t.toLowerCase()));
}

/**
 * Abandoned-booking / cart-recovery style workflow names used across client accounts.
 */
export function isAbandonedRecoveryFlowName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  if (/abandon/.test(n)) return true;
  if (/incomplete\s+book/.test(n)) return true;
  if (/unfinished\s+book/.test(n)) return true;
  if (/dropped\s+book/.test(n)) return true;
  if (/missed\s+book/.test(n)) return true;
  if (/booking\s+recover/.test(n)) return true;
  if (/recover\w*\s+book/.test(n)) return true;
  if (/book\w*\s+recover/.test(n)) return true;
  if (/no[\s-]?show\s+recover/.test(n)) return true;
  return false;
}

/**
 * Credit each conversion to the latest send on or before the event, within
 * `attributionDays`. One conversion → one send (no double counting).
 */
export function attributeConversionsToSends(
  sends: AttributionSend[],
  events: ConversionEvent[],
  attributionDays = DEFAULT_ATTRIBUTION_DAYS
): Map<string, SendConversionCounts> {
  const counts = new Map<string, SendConversionCounts>();
  for (const send of sends) {
    counts.set(send.id, { formFills: 0, appointments: 0 });
  }

  const dated = sends
    .map((s) => ({ send: s, on: ymd(s.sentOn) }))
    .filter((s): s is { send: AttributionSend; on: string } => Boolean(s.on))
    .sort((a, b) => b.on.localeCompare(a.on) || a.send.name.localeCompare(b.send.name));

  for (const event of events) {
    const at = ymd(event.at);
    if (!at) continue;
    let best: { send: AttributionSend; on: string } | null = null;
    for (const row of dated) {
      if (row.on > at) continue;
      const lag = dayDiff(at, row.on);
      if (lag < 0 || lag > attributionDays) continue;
      if (!best || row.on > best.on) best = row;
    }
    if (!best) continue;
    const bucket = counts.get(best.send.id) || { formFills: 0, appointments: 0 };
    if (event.kind === "form_fill") bucket.formFills += 1;
    else bucket.appointments += 1;
    counts.set(best.send.id, bucket);
  }

  return counts;
}

export function inInclusiveWindow(
  value: string | null | undefined,
  start: string,
  end: string
): boolean {
  const day = ymd(value);
  if (!day) return false;
  return day >= start && day <= end;
}

/**
 * Recovered = abandoned booking tag AND (meeting booked tag OR a booked appointment
 * on that contact). Windowed recovered uses dateUpdated / appointment day.
 */
export function summarizeAbandonedRecovery(
  contacts: AbandonedContact[],
  appointmentContactDays: Array<{ contactId: string; at: string }>,
  start: string,
  end: string
): AbandonedRecoverySummary {
  const bookedByContact = new Map<string, string[]>();
  for (const row of appointmentContactDays) {
    const id = row.contactId.trim();
    if (!id) continue;
    const day = ymd(row.at);
    if (!day) continue;
    const list = bookedByContact.get(id) || [];
    list.push(day);
    bookedByContact.set(id, list);
  }

  let stillAbandoned = 0;
  let recovered = 0;
  let recoveredInWindow = 0;

  for (const contact of contacts) {
    if (!contactHasTag(contact.tags, ABANDONED_BOOKING_TAGS)) continue;
    const taggedBooked = contactHasTag(contact.tags, MEETING_BOOKED_TAGS);
    const apptDays = bookedByContact.get(contact.id) || [];
    const hasAppt = apptDays.length > 0;
    if (!taggedBooked && !hasAppt) {
      stillAbandoned += 1;
      continue;
    }
    recovered += 1;
    const updatedInWindow = inInclusiveWindow(contact.dateUpdated, start, end);
    const apptInWindow = apptDays.some((d) => d >= start && d <= end);
    if (updatedInWindow || apptInWindow) recoveredInWindow += 1;
  }

  const abandoned = stillAbandoned + recovered;
  const recoveryRate =
    abandoned > 0 ? Math.round((recovered / abandoned) * 1000) / 10 : 0;

  return {
    abandoned,
    recovered,
    recoveryRate,
    recoveredInWindow,
    stillAbandoned,
  };
}
