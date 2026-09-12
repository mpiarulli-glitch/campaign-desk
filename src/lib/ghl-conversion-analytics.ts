/**
 * Live GHL pulls that feed conversion attribution: form fills, abandoned-booking
 * contacts, booked appointment events, and workflow (flow) email campaigns.
 */

import { ghlRequest, GhlError } from "./ghl";
import {
  ABANDONED_BOOKING_TAGS,
  FORM_FILL_TAGS,
  MEETING_BOOKED_TAGS,
  contactHasTag,
  isAbandonedRecoveryFlowName,
  type AbandonedContact,
  type ConversionEvent,
} from "./email-conversion-attribution";

const SEARCH_PAGE = 100;
const WORKFLOW_PAGE = 20;
const DAY_MS = 86_400_000;

export type BookedAppointmentEvent = {
  id: string;
  contactId: string | null;
  at: string;
};

export type WorkflowEmailCampaign = {
  id: string;
  name: string;
  status: string;
  sourceId: string | null;
  sentOn: string | null;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  unsubscribed: number;
  openRate: number;
  clickRate: number;
  statsAvailable: boolean;
  abandonedRecovery: boolean;
};

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(/%/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function rate(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function ymd(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function inRange(day: string | null, start: string, end: string): boolean {
  if (!day) return false;
  return day >= start && day <= end;
}

async function pooled<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  concurrency = 4
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

async function searchContactsByTag(
  locationId: string,
  tag: string
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let page = 1; page <= 20; page++) {
    let batch: Array<Record<string, unknown>> = [];
    try {
      const res = await ghlRequest<{ contacts?: Array<Record<string, unknown>> }>(
        "POST",
        "/contacts/search",
        {
          locationId,
          body: {
            locationId,
            page,
            pageLimit: SEARCH_PAGE,
            filters: [{ field: "tags", operator: "contains", value: tag }],
          },
        }
      );
      batch = res.contacts || [];
    } catch (err) {
      if (err instanceof GhlError && err.status && err.status >= 400 && err.status < 500) {
        break;
      }
      throw err;
    }
    if (batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < SEARCH_PAGE) break;
  }
  return rows;
}

function contactFromRaw(raw: Record<string, unknown>): AbandonedContact {
  const tags = ((raw.tags as string[]) || []).map(String);
  return {
    id: String(raw.id || ""),
    tags,
    dateAdded: String(raw.dateAdded || raw.dateCreated || "") || null,
    dateUpdated: String(raw.dateUpdated || raw.updatedAt || "") || null,
  };
}

/** Contacts tagged as website form submissions inside the window. */
export async function listFormFillEvents(
  locationId: string,
  start: string,
  end: string
): Promise<ConversionEvent[]> {
  const seen = new Map<string, ConversionEvent>();
  for (const tag of FORM_FILL_TAGS) {
    let rows: Array<Record<string, unknown>> = [];
    try {
      rows = await searchContactsByTag(locationId, tag);
    } catch {
      continue;
    }
    for (const raw of rows) {
      const contact = contactFromRaw(raw);
      if (!contact.id) continue;
      if (!contactHasTag(contact.tags, FORM_FILL_TAGS)) continue;
      const at = ymd(contact.dateAdded);
      if (!inRange(at, start, end)) continue;
      seen.set(contact.id, {
        id: `form:${contact.id}`,
        contactId: contact.id,
        at: at!,
        kind: "form_fill",
      });
    }
  }
  return [...seen.values()];
}

/** Every contact currently carrying the abandoned-booking tag. */
export async function listAbandonedBookingContacts(
  locationId: string
): Promise<AbandonedContact[]> {
  const seen = new Map<string, AbandonedContact>();
  const tags = [...new Set([...ABANDONED_BOOKING_TAGS, ...MEETING_BOOKED_TAGS])];
  for (const tag of tags) {
    let rows: Array<Record<string, unknown>> = [];
    try {
      rows = await searchContactsByTag(locationId, tag);
    } catch {
      continue;
    }
    for (const raw of rows) {
      const contact = contactFromRaw(raw);
      if (!contact.id || seen.has(contact.id)) continue;
      if (!contactHasTag(contact.tags, ABANDONED_BOOKING_TAGS)) continue;
      seen.set(contact.id, contact);
    }
  }
  return [...seen.values()];
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

function normalizeAppointmentStatus(status: unknown): string {
  return String(status || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isBookedAppointment(event: Record<string, unknown>): boolean {
  const status = normalizeAppointmentStatus(event.appointmentStatus || event.status);
  return !["cancelled", "canceled", "deleted", "invalid", "noshow"].includes(status);
}

function eventBookedAt(event: Record<string, unknown>): string | null {
  return (
    ymd(String(event.dateAdded || "")) ||
    ymd(String(event.createdAt || "")) ||
    ymd(String(event.startTime || ""))
  );
}

/** Booked calendar events with contact ids — used for attribution + recovery. */
export async function listBookedAppointmentEvents(
  locationId: string,
  start: string,
  end: string
): Promise<BookedAppointmentEvent[]> {
  const startMs = new Date(`${start}T00:00:00.000Z`).getTime() - 14 * DAY_MS;
  const endMs = new Date(`${end}T23:59:59.999Z`).getTime() + 60 * DAY_MS;
  const calendars = await listCalendars(locationId);
  if (calendars.length === 0) return [];

  const unique = new Map<string, Record<string, unknown>>();
  await pooled(calendars, async (cal) => {
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
        const id = String(
          event.id ||
            event._id ||
            `${cal.id}:${event.startTime}:${event.contactId || event.title || ""}`
        );
        unique.set(id, event);
      }
    } catch {
      // Skip bad calendars.
    }
  });

  const out: BookedAppointmentEvent[] = [];
  for (const event of unique.values()) {
    if (!isBookedAppointment(event)) continue;
    const at = eventBookedAt(event);
    if (!inRange(at, start, end)) continue;
    out.push({
      id: String(event.id || event._id || `${event.contactId}:${at}`),
      contactId: event.contactId ? String(event.contactId) : null,
      at: at!,
    });
  }
  return out;
}

function unwrapStats(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  if (obj.stats && typeof obj.stats === "object") return obj.stats as Record<string, unknown>;
  if (obj.data && typeof obj.data === "object" && !Array.isArray(obj.data)) {
    const data = obj.data as Record<string, unknown>;
    if (data.stats && typeof data.stats === "object") return data.stats as Record<string, unknown>;
    return data;
  }
  return obj;
}

async function fetchWorkflowCampaignStats(
  locationId: string,
  sourceId: string
): Promise<Record<string, unknown> | null> {
  try {
    const result = await ghlRequest(
      "GET",
      `/emails/locations/${locationId}/campaigns/stats/workflow-campaigns/${sourceId}`,
      { locationId, version: "v3" }
    );
    return unwrapStats(result);
  } catch (err) {
    if (err instanceof GhlError && (err.status === 404 || err.status === 400 || err.status === 403)) {
      return null;
    }
    throw err;
  }
}

/**
 * Workflow email campaigns (automation flows) with optional aggregate stats.
 * Requires emails/campaigns.readonly + emails/stats.readonly on the location token.
 */
export async function listWorkflowEmailCampaigns(
  locationId: string
): Promise<WorkflowEmailCampaign[]> {
  const campaigns: Array<Record<string, unknown>> = [];
  try {
    for (let offset = 0; offset < 200; offset += WORKFLOW_PAGE) {
      const result = await ghlRequest<{
        campaigns?: Array<Record<string, unknown>>;
        data?: Array<Record<string, unknown>>;
      }>("GET", `/emails/locations/${locationId}/campaigns/workflows`, {
        locationId,
        version: "v3",
        params: { limit: WORKFLOW_PAGE, offset, status: "published" },
      });
      const page = result.campaigns || result.data || [];
      campaigns.push(...page);
      if (page.length < WORKFLOW_PAGE) break;
    }
  } catch (err) {
    if (err instanceof GhlError && (err.status === 403 || err.status === 401 || err.status === 404)) {
      return [];
    }
    throw err;
  }

  const out: WorkflowEmailCampaign[] = [];
  await pooled(campaigns, async (raw) => {
    const id = String(raw.id || raw._id || "");
    if (!id) return;
    const name = String(raw.name || "Untitled flow");
    const sourceId = String(raw.sourceId || raw.source_id || id);
    const stats = sourceId ? await fetchWorkflowCampaignStats(locationId, sourceId) : null;
    const sent = num(stats?.sent);
    const delivered = num(stats?.delivered) || num(stats?.accepted) || sent;
    const opened = num(stats?.opened);
    const clicked = num(stats?.clicked);
    const bounced =
      num(stats?.bounced) || num(stats?.permanentFail) + num(stats?.temporaryFail);
    const unsubscribed = num(stats?.unsubscribed);
    const openRate =
      stats?.openRate !== undefined && stats?.openRate !== null
        ? num(stats.openRate)
        : rate(opened, delivered);
    const clickRate =
      stats?.clickRate !== undefined && stats?.clickRate !== null
        ? num(stats.clickRate)
        : rate(clicked, delivered);
    const sentOn =
      ymd(String(raw.updatedAt || "")) || ymd(String(raw.createdAt || "")) || null;

    out.push({
      id,
      name,
      status: String(raw.status || "published"),
      sourceId: sourceId || null,
      sentOn,
      sent,
      delivered,
      opened,
      clicked,
      bounced,
      unsubscribed,
      openRate,
      clickRate,
      statsAvailable: Boolean(stats),
      abandonedRecovery: isAbandonedRecoveryFlowName(name),
    });
  });

  return out.sort((a, b) => a.name.localeCompare(b.name));
}
