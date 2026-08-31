/**
 * Live GoHighLevel email campaign analytics for one subaccount.
 *
 * Same pull pattern as Email Cowork / ghl-mcp: list scheduled campaigns, then
 * fetch per-campaign stats via bulkRequestId. Date filtering is done here —
 * GHL's schedule list is not a clean analytics query API.
 */

import { ghlRequest, GhlError } from "./ghl";

const STATS_CONCURRENCY = 4;

export type AnalyticsPreset = "1m" | "3m" | "6m" | "12m" | "custom";

export interface GhlCampaignRow {
  id: string;
  name: string;
  subject: string;
  status: string;
  sentOn: string | null;
  bulkRequestId: string | null;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  unsubscribed: number;
  openRate: number;
  clickRate: number;
  statsAvailable: boolean;
}

export interface EmailAnalyticsTotals {
  campaigns: number;
  withStats: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  unsubscribed: number;
  openRate: number;
  clickRate: number;
}

export interface ClientEmailAnalytics {
  locationId: string;
  start: string;
  end: string;
  fetchedAt: string;
  totals: EmailAnalyticsTotals;
  campaigns: GhlCampaignRow[];
  appointments: number | null;
  appointmentsError: string | null;
}

interface RawSchedule {
  id?: string;
  _id?: string;
  name?: string;
  subject?: string;
  status?: string;
  campaignType?: string;
  bulkRequestId?: string;
  createdAt?: string;
  updatedAt?: string;
  scheduledAt?: string;
  dateAdded?: string;
  successCount?: number;
  totalCount?: number;
}

interface RawStats {
  sent?: number;
  delivered?: number;
  opened?: number;
  clicked?: number;
  bounced?: number;
  permanentFail?: number;
  temporaryFail?: number;
  unsubscribed?: number;
  complained?: number;
  openRate?: number | string;
  clickRate?: number | string;
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(/%/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function ymdFromUnknown(value: string | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function campaignSentOn(raw: RawSchedule): string | null {
  return (
    ymdFromUnknown(raw.scheduledAt) ||
    ymdFromUnknown(raw.createdAt) ||
    ymdFromUnknown(raw.dateAdded) ||
    ymdFromUnknown(raw.updatedAt)
  );
}

function inRange(ymd: string | null, start: string, end: string): boolean {
  if (!ymd) return false;
  return ymd >= start && ymd <= end;
}

function rate(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function emptyTotals(): EmailAnalyticsTotals {
  return {
    campaigns: 0,
    withStats: 0,
    sent: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    unsubscribed: 0,
    openRate: 0,
    clickRate: 0,
  };
}

function addTotals(a: EmailAnalyticsTotals, row: GhlCampaignRow): void {
  a.campaigns += 1;
  if (row.statsAvailable) a.withStats += 1;
  a.sent += row.sent;
  a.delivered += row.delivered;
  a.opened += row.opened;
  a.clicked += row.clicked;
  a.bounced += row.bounced;
  a.unsubscribed += row.unsubscribed;
}

function finalizeTotals(a: EmailAnalyticsTotals): EmailAnalyticsTotals {
  return {
    ...a,
    openRate: rate(a.opened, a.delivered || a.sent),
    clickRate: rate(a.clicked, a.delivered || a.sent),
  };
}

async function pooled<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(STATS_CONCURRENCY, Math.max(items.length, 1)) },
    async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    }
  );
  await Promise.all(workers);
  return out;
}

function monthsAgoYmd(months: number, now: Date): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() - months;
  const d = now.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, lastDay))).toISOString().slice(0, 10);
}

function todayYmd(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

/** Resolve a preset or custom from/to into inclusive YYYY-MM-DD bounds. */
export function resolveAnalyticsRange(
  preset: AnalyticsPreset,
  from?: string | null,
  to?: string | null,
  now = new Date()
): { start: string; end: string } {
  const end = todayYmd(now);
  if (preset === "custom") {
    const start = (from || "").trim();
    const customEnd = (to || "").trim() || end;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(customEnd)) {
      throw new Error("Custom range needs from and to as YYYY-MM-DD.");
    }
    if (start > customEnd) throw new Error("Start date must be on or before end date.");
    return { start, end: customEnd };
  }
  const months = preset === "1m" ? 1 : preset === "3m" ? 3 : preset === "6m" ? 6 : 12;
  return { start: monthsAgoYmd(months, now), end };
}

function unwrapStats(payload: unknown): RawStats {
  if (!payload || typeof payload !== "object") return {};
  const obj = payload as Record<string, unknown>;
  if (obj.stats && typeof obj.stats === "object") return obj.stats as RawStats;
  return obj as RawStats;
}

async function listScheduledCampaigns(locationId: string): Promise<RawSchedule[]> {
  const result = await ghlRequest<{
    schedules?: RawSchedule[];
    data?: RawSchedule[];
    items?: RawSchedule[];
  }>("GET", "/emails/schedule", {
    locationId,
    params: { locationId },
  });
  return result.schedules || result.data || result.items || [];
}

async function fetchCampaignStats(
  locationId: string,
  bulkRequestId: string
): Promise<RawStats | null> {
  try {
    const result = await ghlRequest(
      "GET",
      `/emails/public/v2/locations/${locationId}/campaigns/stats/email-campaigns/${bulkRequestId}`,
      { locationId }
    );
    return unwrapStats(result);
  } catch (err) {
    // Drafts and brand-new sends often 404 until GHL has numbers.
    if (err instanceof GhlError && (err.status === 404 || err.status === 400)) return null;
    throw err;
  }
}

function toRow(raw: RawSchedule, stats: RawStats | null): GhlCampaignRow {
  const sent = num(stats?.sent) || num(raw.totalCount);
  const delivered = num(stats?.delivered) || num(raw.successCount) || sent;
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

  return {
    id: String(raw.id || raw._id || ""),
    name: String(raw.name || "Untitled campaign"),
    subject: String(raw.subject || ""),
    status: String(raw.status || "unknown"),
    sentOn: campaignSentOn(raw),
    bulkRequestId: raw.bulkRequestId || null,
    sent,
    delivered,
    opened,
    clicked,
    bounced,
    unsubscribed,
    openRate,
    clickRate,
    statsAvailable: Boolean(stats),
  };
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

function countsInTotals(row: GhlCampaignRow): boolean {
  const status = row.status.toLowerCase();
  // Cancelled / draft / paused blasts shouldn't dilute open and click rates.
  if (status === "cancelled" || status === "canceled") return false;
  if (status === "draft" || status === "paused") return false;
  return true;
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

async function countBookedAppointments(
  locationId: string,
  start: string,
  end: string
): Promise<number> {
  const startMs = new Date(`${start}T00:00:00.000Z`).getTime();
  const endMs = new Date(`${end}T23:59:59.999Z`).getTime();
  const calendars = await listCalendars(locationId);
  if (calendars.length === 0) return 0;

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
      // One bad calendar must not blank the appointment count.
    }
  });

  let booked = 0;
  for (const event of unique.values()) {
    if (isBookedAppointment(event)) booked += 1;
  }
  return booked;
}

/**
 * Pull campaign-level email stats and booked appointments for one GHL location
 * inside an inclusive date window.
 */
export async function pullClientEmailAnalytics(
  locationId: string,
  start: string,
  end: string
): Promise<ClientEmailAnalytics> {
  const schedules = await listScheduledCampaigns(locationId);
  const inWindow = schedules.filter((s) => inRange(campaignSentOn(s), start, end));

  const withIds = inWindow.filter((s) => Boolean(s.bulkRequestId));
  const statsById = new Map<string, RawStats | null>();
  await pooled(withIds, async (s) => {
    const id = s.bulkRequestId as string;
    statsById.set(id, await fetchCampaignStats(locationId, id));
  });

  const campaigns = inWindow
    .map((s) => {
      const id = s.bulkRequestId || "";
      const stats = id ? statsById.get(id) ?? null : null;
      return toRow(s, stats);
    })
    .sort((a, b) => {
      const da = a.sentOn || "";
      const db = b.sentOn || "";
      return db.localeCompare(da) || a.name.localeCompare(b.name);
    });

  const totals = emptyTotals();
  for (const row of campaigns) {
    if (!countsInTotals(row)) continue;
    addTotals(totals, row);
  }

  let appointments: number | null = null;
  let appointmentsError: string | null = null;
  try {
    appointments = await countBookedAppointments(locationId, start, end);
  } catch (err) {
    appointmentsError = err instanceof Error ? err.message : "Could not load appointments.";
  }

  return {
    locationId,
    start,
    end,
    fetchedAt: new Date().toISOString(),
    totals: finalizeTotals(totals),
    campaigns,
    appointments,
    appointmentsError,
  };
}
