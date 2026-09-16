/**
 * Lifecycle outcomes from a GHL location: appointments, form submissions,
 * and (when present) payments. Attribution is last-touch on the contact or
 * the form session — GHL does not stamp campaign IDs on calendar events.
 */

import { ghlRequest } from "./ghl";
import {
  addTouch,
  classifyLifecycleTouch,
  emptyTouchCounts,
  isBookedStatus,
  summarizeAbandons,
  type AppointmentEvent,
  type AppointmentOutcomes,
  type CommerceOutcomes,
  type FormOutcomes,
  type LifecycleOutcomes,
  type LifecycleTouch,
} from "./ghl-outcome-math";

export type {
  AppointmentEvent,
  AppointmentOutcomes,
  CommerceOutcomes,
  FormOutcomes,
  LifecycleOutcomes,
  LifecycleTouch,
  TouchCounts,
} from "./ghl-outcome-math";
export {
  addTouch,
  classifyLifecycleTouch,
  emptyTouchCounts,
  fromEmailOrFlow,
  isAbandonedStatus,
  isBookedStatus,
  summarizeAbandons,
} from "./ghl-outcome-math";

const PAGE_LIMIT = 100;
const MAX_PAGES = 15;
const MAX_CONTACTS = 200;
const CONTACT_CONCURRENCY = 6;
const CAL_CONCURRENCY = 4;

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(/[$,]/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function eventMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = Math.abs(value) < 1e12 ? value * 1000 : value;
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}


async function pooled<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) || 0 }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function listCalendars(locationId: string): Promise<Array<{ id: string }>> {
  const attempts: Array<{ path: string; params: Record<string, string> }> = [
    { path: "/calendars/", params: { locationId } },
    { path: "/calendars", params: { locationId } },
  ];
  let lastErr: unknown;
  for (const attempt of attempts) {
    try {
      const result = await ghlRequest<{
        calendars?: Array<{ id?: string; _id?: string }>;
        data?: Array<{ id?: string; _id?: string }>;
        items?: Array<{ id?: string; _id?: string }>;
      }>("GET", attempt.path, { locationId, params: attempt.params });
      const rows = result.calendars || result.data || result.items || [];
      return rows
        .map((c) => ({ id: String(c.id || c._id || "") }))
        .filter((c) => c.id);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Could not list calendars.");
}

function toAppointmentEvent(
  event: Record<string, unknown>,
  calendarId: string
): AppointmentEvent | null {
  const startMs =
    eventMs(event.startTime) ?? eventMs(event.start) ?? eventMs(event.date);
  if (startMs == null) return null;
  const id = String(
    event.id ||
      event._id ||
      `${calendarId}:${event.startTime}:${event.contactId || event.title || ""}`
  );
  return {
    id,
    contactId: String(event.contactId || ""),
    startMs,
    addedMs: eventMs(event.dateAdded) ?? eventMs(event.dateUpdated) ?? startMs,
    status: String(event.appointmentStatus || event.status || ""),
    source: event.source ?? asRecord(event.createdBy)?.source ?? null,
    createdBy: event.createdBy ?? null,
    raw: event,
  };
}

export async function listLocationAppointments(
  locationId: string,
  start: string,
  end: string
): Promise<AppointmentEvent[]> {
  const startMs = new Date(`${start}T00:00:00.000Z`).getTime();
  const endMs = new Date(`${end}T23:59:59.999Z`).getTime();
  const calendars = await listCalendars(locationId);
  if (calendars.length === 0) return [];

  const unique = new Map<string, AppointmentEvent>();
  await pooled(calendars, CAL_CONCURRENCY, async (cal) => {
    try {
      const result = await ghlRequest<{
        events?: Array<Record<string, unknown>>;
        data?: Array<Record<string, unknown>>;
      }>("GET", "/calendars/events", {
        locationId,
        params: {
          locationId,
          calendarId: cal.id,
          startTime: startMs,
          endTime: endMs,
        },
      });
      const events = result.events || result.data || [];
      for (const event of events) {
        const row = toAppointmentEvent(event, cal.id);
        if (!row) continue;
        unique.set(row.id, row);
      }
    } catch {
      // One bad calendar must not blank the appointment count.
    }
  });
  return [...unique.values()];
}

interface FormSubmission {
  id: string;
  contactId: string;
  eventData: unknown;
  others: unknown;
}

async function listFormSubmissions(
  locationId: string,
  start: string,
  end: string
): Promise<FormSubmission[]> {
  const out: FormSubmission[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await ghlRequest<{
      submissions?: Array<Record<string, unknown>>;
      meta?: { nextPage?: number | null };
    }>("GET", "/forms/submissions", {
      locationId,
      params: {
        locationId,
        startAt: start,
        endAt: end,
        page,
        limit: PAGE_LIMIT,
      },
    });
    const rows = result.submissions || [];
    for (const row of rows) {
      const others = asRecord(row.others);
      out.push({
        id: String(row.id || `${row.contactId || ""}:${row.createdAt || page}:${out.length}`),
        contactId: String(row.contactId || ""),
        eventData: others?.eventData ?? row.eventData ?? null,
        others,
      });
    }
    if (rows.length < PAGE_LIMIT) break;
    if (result.meta?.nextPage == null && rows.length === 0) break;
  }
  return out;
}

interface PaymentOrder {
  id: string;
  contactId: string;
  amount: number;
  status: string;
}

function orderAmount(raw: Record<string, unknown>): number {
  const cents = num(raw.amount);
  const dollars = num(raw.total) || num(raw.amount);
  // GHL Payments usually stores dollars. If only `amount` exists, use it.
  if (raw.amountInDollars != null) return num(raw.amountInDollars);
  return dollars || cents;
}

function orderInWindow(raw: Record<string, unknown>, start: string, end: string): boolean {
  const startMs = new Date(`${start}T00:00:00.000Z`).getTime();
  const endMs = new Date(`${end}T23:59:59.999Z`).getTime();
  const when =
    eventMs(raw.createdAt) ??
    eventMs(raw.dateAdded) ??
    eventMs(raw.created_at) ??
    eventMs(raw.startAt);
  if (when == null) return true;
  return when >= startMs && when <= endMs;
}

function isPaidOrder(status: string): boolean {
  const s = status.toLowerCase();
  if (!s) return true;
  return !["cancelled", "canceled", "failed", "refunded", "void", "unpaid"].includes(s);
}

async function listOrders(
  locationId: string,
  start: string,
  end: string
): Promise<PaymentOrder[]> {
  const out: PaymentOrder[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await ghlRequest<{
      orders?: Array<Record<string, unknown>>;
      data?: Array<Record<string, unknown>>;
    }>("GET", "/payments/orders", {
      locationId,
      params: {
        locationId,
        limit: PAGE_LIMIT,
        offset: page * PAGE_LIMIT,
        startAt: start,
        endAt: end,
      },
    });
    const rows = result.orders || result.data || [];
    for (const row of rows) {
      if (!orderInWindow(row, start, end)) continue;
      const status = String(row.status || "");
      if (!isPaidOrder(status)) continue;
      out.push({
        id: String(row.id || row._id || `${row.contactId || ""}:${out.length}`),
        contactId: String(row.contactId || ""),
        amount: orderAmount(row),
        status,
      });
    }
    if (rows.length < PAGE_LIMIT) break;
  }
  return out;
}

interface ContactAttribution {
  last: unknown;
  first: unknown;
  source: unknown;
}

async function loadContactAttributions(
  locationId: string,
  contactIds: string[]
): Promise<Map<string, ContactAttribution>> {
  const unique = [...new Set(contactIds.filter(Boolean))].slice(0, MAX_CONTACTS);
  const map = new Map<string, ContactAttribution>();
  await pooled(unique, CONTACT_CONCURRENCY, async (id) => {
    try {
      const result = await ghlRequest<{ contact?: Record<string, unknown> } & Record<string, unknown>>(
        "GET",
        `/contacts/${id}`,
        { locationId }
      );
      const contact = result.contact || result;
      map.set(id, {
        last: contact.lastAttributionSource ?? contact.last_attribution_source,
        first: contact.attributionSource ?? contact.attribution_source,
        source: contact.source,
      });
    } catch {
      // Leave unattributed rather than failing the whole pull.
    }
  });
  return map;
}

function touchForContact(
  contacts: Map<string, ContactAttribution>,
  contactId: string,
  extras: unknown[]
): LifecycleTouch | null {
  if (!contactId) return extras.length ? classifyLifecycleTouch(...extras) : null;
  const hit = contacts.get(contactId);
  if (!hit) return extras.length ? classifyLifecycleTouch(...extras) : null;
  return classifyLifecycleTouch(hit.last, hit.first, hit.source, ...extras);
}

const ATTRIBUTION_NOTE =
  "Last-touch from the GHL contact or form session (utm / session source). Campaign vs flow is inferred from those fields — calendar events do not carry a campaign id.";

export async function pullLifecycleOutcomes(
  locationId: string,
  start: string,
  end: string
): Promise<LifecycleOutcomes> {
  const appointments: AppointmentOutcomes = {
    ...emptyTouchCounts(),
    booked: 0,
    abandoned: 0,
    recovered: 0,
    recoveryRate: 0,
    error: null,
  };
  const forms: FormOutcomes = { ...emptyTouchCounts(), error: null };
  const commerce: CommerceOutcomes = {
    ...emptyTouchCounts(),
    revenue: 0,
    fromCampaignRevenue: 0,
    fromFlowRevenue: 0,
    error: null,
  };

  let events: AppointmentEvent[] = [];
  let submissions: FormSubmission[] = [];
  let orders: PaymentOrder[] = [];

  try {
    events = await listLocationAppointments(locationId, start, end);
  } catch (err) {
    appointments.error = err instanceof Error ? err.message : "Could not load appointments.";
  }

  try {
    submissions = await listFormSubmissions(locationId, start, end);
  } catch (err) {
    forms.error = err instanceof Error ? err.message : "Could not load form submissions.";
  }

  try {
    orders = await listOrders(locationId, start, end);
  } catch (err) {
    commerce.error = err instanceof Error ? err.message : "Could not load orders.";
  }

  const contactIds = [
    ...events.map((e) => e.contactId),
    ...submissions.map((s) => s.contactId),
    ...orders.map((o) => o.contactId),
  ];
  const contacts = await loadContactAttributions(locationId, contactIds);

  const bookedEvents = events.filter((e) => isBookedStatus(e.status));
  appointments.booked = bookedEvents.length;
  const abandons = summarizeAbandons(events);
  appointments.abandoned = abandons.abandoned;
  appointments.recovered = abandons.recovered;
  appointments.recoveryRate = abandons.recoveryRate;

  for (const event of bookedEvents) {
    addTouch(appointments, touchForContact(contacts, event.contactId, [event.source, event.createdBy]));
  }

  for (const sub of submissions) {
    addTouch(forms, touchForContact(contacts, sub.contactId, [sub.eventData, sub.others]));
  }

  for (const order of orders) {
    const touch = touchForContact(contacts, order.contactId, []);
    addTouch(commerce, touch);
    commerce.revenue += order.amount;
    if (touch === "campaign") commerce.fromCampaignRevenue += order.amount;
    if (touch === "flow") commerce.fromFlowRevenue += order.amount;
  }

  return { appointments, forms, commerce, attributionNote: ATTRIBUTION_NOTE };
}
