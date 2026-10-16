/**
 * Pure attribution helpers for Lifecycle money metrics.
 *
 * GHL does not stamp "this blast caused that booking". This helper only matches
 * conversion *dates* to nearby campaign/flow *send dates*. That is not proof the
 * booker received (or opened) the email — busy accounts over-count badly.
 *
 * Callers that report "email-driven" numbers must first filter conversions with
 * contact-level email evidence (see ghl-contact-email-touch). Form fills require
 * a marketing email that was received and opened in the window before the fill.
 *
 * Abandoned-booking recovery is tag-based: contacts that got `abandoned booking`
 * and later show `meeting booked` (or a booked calendar event) count as recovered.
 */

export const FORM_FILL_TAGS = ["website form submission"] as const;
export const ABANDONED_BOOKING_TAGS = ["abandoned booking"] as const;
export const MEETING_BOOKED_TAGS = ["meeting booked"] as const;

export const DEFAULT_ATTRIBUTION_DAYS = 5;

export type SendChannel = "campaign" | "flow";

export type AttributionSend = {
  id: string;
  name: string;
  sentOn: string | null;
  channel: SendChannel;
  /** Email subject line when the schedule exposes one. */
  subject?: string | null;
};

/**
 * Proof of the marketing email on a contact's thread.
 * Campaign credit uses this — a nearby send date is not enough.
 */
export type EmailTouchRef = {
  /** YYYY-MM-DD the contact received the email. */
  day: string;
  /** Subject line from the conversation. Empty when GHL omitted it. */
  subject: string;
  /** Plain body, used only when the subject is empty. */
  text: string;
  /** Campaign / bulk id stamped on the message, when GHL sends one. */
  campaignId: string;
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

export type AttributionJourney = {
  event: ConversionEvent;
  send: AttributionSend;
  /** Resolved YYYY-MM-DD of the credited send. */
  sendOn: string;
};

const MIN_SUBJECT_MATCH = 16;

/** Lowercase, strip reply prefixes, collapse punctuation. */
export function normalizeEmailLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/g, "")
    .replace(/&amp;/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when the contact's email text is the send's subject or name.
 * Short labels are ignored so a word like "update" cannot claim a thread.
 */
export function emailLabelsMatch(touchText: string, sendLabel: string): boolean {
  const send = normalizeEmailLabel(sendLabel);
  const touch = normalizeEmailLabel(touchText);
  if (!send || !touch || send.length < MIN_SUBJECT_MATCH) return false;
  if (touch === send) return true;
  if (touch.includes(send)) return true;
  return touch.length >= MIN_SUBJECT_MATCH && send.includes(touch);
}

function sendMatchesTouch(send: AttributionSend, touch: EmailTouchRef): boolean {
  if (touch.campaignId && touch.campaignId === send.id) return true;
  const haystack = touch.subject.trim() ? touch.subject : touch.text;
  if (!haystack.trim()) return false;
  const labels = [send.subject, send.name].filter(
    (label): label is string => Boolean(label && label.trim())
  );
  return labels.some((label) => emailLabelsMatch(haystack, label));
}

/**
 * Campaign to credit for one contact email.
 * The send subject (or name) has to match the message on the thread.
 * Among matches, the send closest to the day they received it wins.
 */
export function pickSendForEmailTouch(
  sends: AttributionSend[],
  eventAt: string,
  touch: EmailTouchRef,
  attributionDays = DEFAULT_ATTRIBUTION_DAYS
): { send: AttributionSend; sendOn: string } | null {
  const at = ymd(eventAt);
  const touchDay = ymd(touch.day);
  if (!at || !touchDay) return null;
  let best: { send: AttributionSend; on: string; distance: number } | null = null;
  for (const send of sends) {
    const on = ymd(send.sentOn);
    if (!on || on > at) continue;
    const lag = dayDiff(at, on);
    if (lag < 0 || lag > attributionDays) continue;
    if (!sendMatchesTouch(send, touch)) continue;
    const distance = Math.abs(dayDiff(touchDay, on));
    if (
      !best ||
      distance < best.distance ||
      (distance === best.distance && on > best.on)
    ) {
      best = { send, on, distance };
    }
  }
  return best ? { send: best.send, sendOn: best.on } : null;
}

/** Label for a thread email that did not match a campaign subject. */
export function threadEmailLabel(touch: EmailTouchRef): string {
  const subject = touch.subject.trim();
  if (subject) return subject;
  const preview = touch.text.replace(/\s+/g, " ").trim();
  if (preview.length >= 24) {
    return preview.length > 90 ? `${preview.slice(0, 87).trimEnd()}…` : preview;
  }
  return "Marketing email";
}

/**
 * Pair each conversion with the latest send on or before the event, within
 * `attributionDays`. One conversion → one journey (no double counting).
 *
 * Pass `touchByEventId` to require the credited send's subject to match the
 * email on that contact. A same-day blast with a different subject is skipped.
 */
export function attributeConversionsToJourneys(
  sends: AttributionSend[],
  events: ConversionEvent[],
  attributionDays = DEFAULT_ATTRIBUTION_DAYS,
  touchByEventId?: Record<string, EmailTouchRef>
): AttributionJourney[] {
  const dated = sends
    .map((s) => ({ send: s, on: ymd(s.sentOn) }))
    .filter((s): s is { send: AttributionSend; on: string } => Boolean(s.on))
    .sort((a, b) => b.on.localeCompare(a.on) || a.send.name.localeCompare(b.send.name));

  const journeys: AttributionJourney[] = [];
  for (const event of events) {
    const at = ymd(event.at);
    if (!at) continue;
    if (touchByEventId) {
      const touch = touchByEventId[event.id];
      if (!touch) continue;
      const picked = pickSendForEmailTouch(sends, at, touch, attributionDays);
      if (!picked) continue;
      journeys.push({ event, send: picked.send, sendOn: picked.sendOn });
      continue;
    }
    let best: { send: AttributionSend; on: string } | null = null;
    for (const row of dated) {
      if (row.on > at) continue;
      const lag = dayDiff(at, row.on);
      if (lag < 0 || lag > attributionDays) continue;
      if (!best || row.on > best.on) best = row;
    }
    if (!best) continue;
    journeys.push({ event, send: best.send, sendOn: best.on });
  }
  return journeys;
}

/**
 * Credit each conversion to the latest send on or before the event, within
 * `attributionDays`. One conversion → one send (no double counting).
 */
export function attributeConversionsToSends(
  sends: AttributionSend[],
  events: ConversionEvent[],
  attributionDays = DEFAULT_ATTRIBUTION_DAYS,
  touchByEventId?: Record<string, EmailTouchRef>
): Map<string, SendConversionCounts> {
  const counts = new Map<string, SendConversionCounts>();
  for (const send of sends) {
    counts.set(send.id, { formFills: 0, appointments: 0 });
  }

  for (const journey of attributeConversionsToJourneys(
    sends,
    events,
    attributionDays,
    touchByEventId
  )) {
    const bucket = counts.get(journey.send.id) || {
      formFills: 0,
      appointments: 0,
    };
    if (journey.event.kind === "form_fill") bucket.formFills += 1;
    else bucket.appointments += 1;
    counts.set(journey.send.id, bucket);
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
