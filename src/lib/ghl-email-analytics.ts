/**
 * Live GoHighLevel email campaign analytics for one subaccount.
 *
 * Same pull pattern as Email Cowork / ghl-mcp: list scheduled campaigns, then
 * fetch per-campaign stats via bulkRequestId. Date filtering is done here —
 * GHL's schedule list is not a clean analytics query API.
 */

import { parseTimeInput, zonedLocalToUtc } from "./forecast-time";
import { ghlRequest, GhlError } from "./ghl";
import {
  DEFAULT_ATTRIBUTION_DAYS,
  attributeConversionsToSends,
  summarizeAbandonedRecovery,
  type AttributionSend,
  type ConversionEvent,
} from "./email-conversion-attribution";
import {
  listAbandonedBookingContacts,
  listBookedAppointmentEvents,
  listFormFillEvents,
  listWorkflowEmailCampaigns,
} from "./ghl-conversion-analytics";

const STATS_CONCURRENCY = 4;
const SCHEDULE_TIME_ZONE =
  process.env.APP_TIME_ZONE || "America/Los_Angeles";

export type AnalyticsPreset = "1m" | "3m" | "6m" | "12m" | "custom";

export type EmailSendChannel = "campaign" | "flow";

export interface GhlCampaignRow {
  id: string;
  name: string;
  subject: string;
  status: string;
  sentOn: string | null;
  bulkRequestId: string | null;
  channel: EmailSendChannel;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  unsubscribed: number;
  openRate: number;
  clickRate: number;
  statsAvailable: boolean;
  /** Form fills attributed to this send (post-send window). */
  formFills: number;
  /** Booked appointments attributed to this send (post-send window). */
  attributedAppointments: number;
  /** True for abandoned-booking recovery automations. */
  abandonedRecovery: boolean;
}

export interface AbandonedRecoveryStats {
  abandoned: number;
  recovered: number;
  recoveryRate: number;
  recoveredInWindow: number;
  stillAbandoned: number;
  error: string | null;
}

/** DTC / ecommerce store-sales rollup (from rev_metrics). */
export interface CommerceAnalytics {
  revenue: number;
  orders: number;
  aov: number;
  months: number;
  revenueSource: string;
}

export type AnalyticsMoneyMode = "service" | "commerce";

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
  /** service = GHL form/booking money; commerce = DTC store sales. */
  moneyMode: AnalyticsMoneyMode;
  totals: EmailAnalyticsTotals;
  /** Broadcast / one-shot email campaigns. */
  campaigns: GhlCampaignRow[];
  /** Workflow / automation email flows. */
  flows: GhlCampaignRow[];
  appointments: number | null;
  appointmentsError: string | null;
  formFills: number | null;
  formFillsError: string | null;
  abandonedRecovery: AbandonedRecoveryStats | null;
  /** Present for ecommerce clients — orders + revenue in the window. */
  commerce: CommerceAnalytics | null;
  attributionDays: number;
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
  scheduledAt?: string | number;
  scheduledTimestamp?: string | number;
  dateAdded?: string;
  timeZone?: string;
  timezone?: string;
  successCount?: number;
  totalCount?: number;
  scheduleConfig?: Record<string, unknown>;
  bulkRequestStatusInfo?: Record<string, unknown>;
  emailMeta?: Record<string, unknown>;
  rssConfig?: Record<string, unknown>;
  schedule?: Record<string, unknown>;
  meta?: Record<string, unknown>;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function ghlTimeZone(raw: Record<string, unknown>): string {
  const nested =
    asRecord(raw.scheduleConfig) ||
    asRecord(raw.schedule) ||
    asRecord(raw.rssConfig) ||
    {};
  for (const value of [
    raw.timeZone,
    raw.timezone,
    raw.scheduledTimezone,
    nested.timeZone,
    nested.timezone,
  ]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return SCHEDULE_TIME_ZONE;
}

function parseUnixMs(value: number): string | null {
  const ms = Math.abs(value) < 1e12 ? value * 1000 : value;
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function parseGhlClockTime(value: string): string {
  const trimmed = value.trim();
  const withSeconds = trimmed.match(/^(\d{1,2}:\d{2}):\d{2}(\s*[ap]m)?$/i);
  const raw = withSeconds ? `${withSeconds[1]}${withSeconds[2] || ""}` : trimmed;
  return parseTimeInput(raw);
}

function parseGhlDateTime(value: unknown, timeZone: string): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return parseUnixMs(value);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{10,13}$/.test(trimmed)) {
    return parseUnixMs(Number(trimmed));
  }
  const wall = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?))?$/i
  );
  if (wall) {
    const hhmm = parseGhlClockTime(wall[2] || "09:00") || "09:00";
    const at = zonedLocalToUtc(wall[1], hhmm, timeZone);
    if (at && Number.isFinite(at.getTime())) return at.toISOString();
  }
  const ms = Date.parse(trimmed);
  if (Number.isFinite(ms)) return new Date(ms).toISOString();
  return null;
}

function pickDateAndTime(
  raw: Record<string, unknown>,
  timeZone: string
): string | null {
  const schedule = asRecord(raw.schedule);
  const dateCandidate = [
    raw.scheduledDate,
    raw.scheduleDate,
    raw.sendDate,
    schedule?.date,
    schedule?.sendDate,
  ].find((value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value));
  const timeCandidate = [
    raw.scheduledTime,
    raw.sendTime,
    schedule?.time,
    schedule?.sendTime,
  ].find((value) => typeof value === "string" && parseGhlClockTime(value));
  if (typeof dateCandidate !== "string") return null;
  const date = dateCandidate.slice(0, 10);
  const time =
    typeof timeCandidate === "string"
      ? parseGhlClockTime(timeCandidate) || "09:00"
      : "09:00";
  const at = zonedLocalToUtc(date, time, timeZone);
  return at && Number.isFinite(at.getTime()) ? at.toISOString() : null;
}

function firstInstant(
  values: unknown[],
  timeZone: string,
  skip?: string | null
): string | null {
  const skipMs = skip ? Date.parse(skip) : NaN;
  for (const value of values) {
    const iso = parseGhlDateTime(value, timeZone);
    if (!iso) continue;
    if (Number.isFinite(skipMs) && Math.abs(Date.parse(iso) - skipMs) < 60_000) {
      continue;
    }
    return iso;
  }
  return null;
}

/**
 * Instant the blast is supposed to send — not when someone clicked Schedule.
 * GHL's list payload often only documents createdAt; the send time lives on
 * scheduledTimestamp / scheduleConfig.sendAt once limitedFields is off.
 */
export function ghlCampaignSendAt(raw: Record<string, unknown>): string | null {
  const timeZone = ghlTimeZone(raw);
  const created = parseGhlDateTime(
    raw.createdAt || raw.dateAdded || raw.updatedAt,
    timeZone
  );
  const scheduleConfig = asRecord(raw.scheduleConfig);
  const bulk = asRecord(raw.bulkRequestStatusInfo);
  const rss = asRecord(raw.rssConfig);
  const meta = asRecord(raw.meta);
  return (
    firstInstant(
      [
        scheduleConfig?.sendAt,
        raw.scheduledTimestamp,
        bulk?.scheduledTimestamp,
        bulk?.sendAt,
        bulk?.scheduledTime,
        raw.sendAt,
        raw.scheduledTime,
        rss?.firstExecutionDate,
        raw.firstExecutionDate,
        meta?.scheduledTimestamp,
        meta?.sendAt,
      ],
      timeZone,
      created
    ) ||
    pickDateAndTime(raw, timeZone) ||
    firstInstant([raw.scheduledAt], timeZone, created)
  );
}

function scheduleSubject(raw: RawSchedule): string {
  const meta = asRecord(raw.emailMeta) || asRecord(raw.meta);
  const nested = meta && typeof meta.subject === "string" ? meta.subject : "";
  return String(raw.subject || nested || "").trim();
}

function ymdFromUnknown(value: string | undefined | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function campaignSentOn(raw: RawSchedule): string | null {
  return (
    ymdFromUnknown(ghlCampaignSendAt(raw as Record<string, unknown>)) ||
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

export type GhlEmailSchedule = {
  id: string;
  name: string;
  subject: string;
  status: string;
  scheduledAt: string | null;
};

async function listScheduledCampaigns(locationId: string): Promise<RawSchedule[]> {
  const rows: RawSchedule[] = [];
  const limit = 100;
  for (let offset = 0; offset < 500; offset += limit) {
    const result = await ghlRequest<{
      schedules?: RawSchedule[];
      data?: RawSchedule[];
      items?: RawSchedule[];
    }>("GET", "/emails/schedule", {
      locationId,
      params: { locationId, limit, offset },
    });
    const page = result.schedules || result.data || result.items || [];
    rows.push(...page);
    if (page.length < limit) break;
  }
  return rows;
}

function unwrapCampaign(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  const nested = asRecord(obj.campaign) || asRecord(obj.data) || asRecord(obj.email);
  return nested || obj;
}

async function listV2EmailCampaigns(
  locationId: string,
  status: string
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const limit = 20;
  try {
    for (let offset = 0; offset < 200; offset += limit) {
      const result = await ghlRequest<{
        campaigns?: Record<string, unknown>[];
        data?: Record<string, unknown>[];
      }>("GET", `/emails/locations/${locationId}/campaigns/emails`, {
        locationId,
        version: "v3",
        params: { limit, offset, status },
      });
      const page = result.campaigns || result.data || [];
      rows.push(...page);
      if (page.length < limit) break;
    }
  } catch {
    // Tokens without emails/campaigns.readonly still have the legacy list.
  }
  return rows;
}

async function fetchV2EmailCampaign(
  locationId: string,
  campaignId: string
): Promise<Record<string, unknown> | null> {
  try {
    const result = await ghlRequest(
      "GET",
      `/emails/locations/${locationId}/campaigns/emails/${campaignId}`,
      { locationId, version: "v3" }
    );
    return unwrapCampaign(result);
  } catch {
    return null;
  }
}

function scheduleName(raw: Record<string, unknown>): string {
  return String(raw.name || raw.title || "").trim();
}

function toScheduleRow(raw: Record<string, unknown>): GhlEmailSchedule {
  const rec = raw as RawSchedule & Record<string, unknown>;
  return {
    id: String(rec.id || rec._id || ""),
    name: scheduleName(rec),
    subject: scheduleSubject(rec),
    status: String(rec.status || "").trim() || "unknown",
    scheduledAt: ghlCampaignSendAt(rec),
  };
}

function mergeScheduleRows(lists: Record<string, unknown>[][]): GhlEmailSchedule[] {
  const byId = new Map<string, GhlEmailSchedule>();
  for (const list of lists) {
    for (const raw of list) {
      const row = toScheduleRow(raw);
      if (!row.id) continue;
      const prev = byId.get(row.id);
      if (!prev) {
        byId.set(row.id, row);
        continue;
      }
      byId.set(row.id, {
        ...prev,
        name: row.name || prev.name,
        subject: row.subject || prev.subject,
        status: row.status !== "unknown" ? row.status : prev.status,
        scheduledAt: row.scheduledAt || prev.scheduledAt,
      });
    }
  }
  return [...byId.values()].filter((row) => row.name);
}

/** Pull send timestamps onto rows that only have a name from the list APIs. */
export async function fillGhlSendTimes(
  locationId: string,
  schedules: GhlEmailSchedule[]
): Promise<void> {
  const missing = schedules.filter((row) => row.id && !row.scheduledAt);
  if (!missing.length) return;
  await pooled(missing, async (row) => {
    const detail = await fetchV2EmailCampaign(locationId, row.id);
    if (!detail) return;
    const sendAt = ghlCampaignSendAt(detail);
    if (sendAt) row.scheduledAt = sendAt;
    const subject = String(detail.subject || "").trim();
    if (subject && !row.subject) row.subject = subject;
    const name = scheduleName(detail);
    if (name && !row.name) row.name = name;
  });
}

/** Scheduled (and recently sent) GHL email blasts for one subaccount. */
export async function listLocationEmailSchedules(
  locationId: string
): Promise<GhlEmailSchedule[]> {
  const [legacy, scheduled, processing] = await Promise.all([
    listScheduledCampaigns(locationId),
    listV2EmailCampaigns(locationId, "scheduled"),
    listV2EmailCampaigns(locationId, "processing"),
  ]);
  return mergeScheduleRows([
    legacy as unknown as Record<string, unknown>[],
    scheduled,
    processing,
  ]);
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
    subject: scheduleSubject(raw),
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
    channel: "campaign",
    formFills: 0,
    attributedAppointments: 0,
    abandonedRecovery: false,
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
  end: string,
  attributionDays = DEFAULT_ATTRIBUTION_DAYS
): Promise<ClientEmailAnalytics> {
  const schedules = await listScheduledCampaigns(locationId);
  const inWindow = schedules.filter((s) => inRange(campaignSentOn(s), start, end));

  const withIds = inWindow.filter((s) => Boolean(s.bulkRequestId));
  const statsById = new Map<string, RawStats | null>();
  await pooled(withIds, async (s) => {
    const id = s.bulkRequestId as string;
    statsById.set(id, await fetchCampaignStats(locationId, id));
  });

  let campaigns = inWindow
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

  let flows: GhlCampaignRow[] = [];
  try {
    const workflowCampaigns = await listWorkflowEmailCampaigns(locationId);
    flows = workflowCampaigns.map((flow) => ({
      id: flow.id,
      name: flow.name,
      subject: "",
      status: flow.status,
      sentOn: flow.sentOn,
      bulkRequestId: flow.sourceId,
      channel: "flow" as const,
      sent: flow.sent,
      delivered: flow.delivered,
      opened: flow.opened,
      clicked: flow.clicked,
      bounced: flow.bounced,
      unsubscribed: flow.unsubscribed,
      openRate: flow.openRate,
      clickRate: flow.clickRate,
      statsAvailable: flow.statsAvailable,
      formFills: 0,
      attributedAppointments: 0,
      abandonedRecovery: flow.abandonedRecovery,
    }));
  } catch {
    flows = [];
  }

  const totals = emptyTotals();
  for (const row of campaigns) {
    if (!countsInTotals(row)) continue;
    addTotals(totals, row);
  }

  let appointments: number | null = null;
  let appointmentsError: string | null = null;
  let appointmentEvents: Awaited<ReturnType<typeof listBookedAppointmentEvents>> = [];
  try {
    appointmentEvents = await listBookedAppointmentEvents(locationId, start, end);
    appointments = appointmentEvents.length;
  } catch (err) {
    appointmentsError = err instanceof Error ? err.message : "Could not load appointments.";
    try {
      appointments = await countBookedAppointments(locationId, start, end);
    } catch (fallbackErr) {
      appointmentsError =
        fallbackErr instanceof Error ? fallbackErr.message : appointmentsError;
    }
  }

  let formFills: number | null = null;
  let formFillsError: string | null = null;
  let formEvents: ConversionEvent[] = [];
  try {
    formEvents = await listFormFillEvents(locationId, start, end);
    formFills = formEvents.length;
  } catch (err) {
    formFillsError = err instanceof Error ? err.message : "Could not load form fills.";
  }

  const conversionEvents: ConversionEvent[] = [
    ...formEvents,
    ...appointmentEvents.map((event) => ({
      id: event.id,
      contactId: event.contactId,
      at: event.at,
      kind: "appointment" as const,
    })),
  ];

  const attributionSends: AttributionSend[] = [
    ...campaigns.map((row) => ({
      id: row.id,
      name: row.name,
      sentOn: row.sentOn,
      channel: "campaign" as const,
    })),
    ...flows.map((row) => ({
      id: row.id,
      name: row.name,
      sentOn: row.sentOn,
      channel: "flow" as const,
    })),
  ];
  const attributed = attributeConversionsToSends(
    attributionSends,
    conversionEvents,
    attributionDays
  );

  campaigns = campaigns.map((row) => {
    const counts = attributed.get(row.id);
    return {
      ...row,
      formFills: counts?.formFills || 0,
      attributedAppointments: counts?.appointments || 0,
    };
  });
  flows = flows.map((row) => {
    const counts = attributed.get(row.id);
    return {
      ...row,
      formFills: counts?.formFills || 0,
      attributedAppointments: counts?.appointments || 0,
    };
  });

  let abandonedRecovery: AbandonedRecoveryStats | null = null;
  try {
    const abandonedContacts = await listAbandonedBookingContacts(locationId);
    const summary = summarizeAbandonedRecovery(
      abandonedContacts,
      appointmentEvents
        .filter((event) => event.contactId)
        .map((event) => ({ contactId: event.contactId as string, at: event.at })),
      start,
      end
    );
    abandonedRecovery = {
      abandoned: summary.abandoned,
      recovered: summary.recovered,
      recoveryRate: summary.recoveryRate,
      recoveredInWindow: summary.recoveredInWindow,
      stillAbandoned: summary.stillAbandoned,
      error: null,
    };

    const recoveryFlows = flows.filter((flow) => flow.abandonedRecovery);
    if (recoveryFlows.length && summary.recoveredInWindow > 0) {
      const share = Math.floor(summary.recoveredInWindow / recoveryFlows.length);
      let remainder = summary.recoveredInWindow - share * recoveryFlows.length;
      flows = flows.map((flow) => {
        if (!flow.abandonedRecovery) return flow;
        const extra = share + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder -= 1;
        return {
          ...flow,
          attributedAppointments: Math.max(flow.attributedAppointments, extra),
        };
      });
    }
  } catch (err) {
    abandonedRecovery = {
      abandoned: 0,
      recovered: 0,
      recoveryRate: 0,
      recoveredInWindow: 0,
      stillAbandoned: 0,
      error: err instanceof Error ? err.message : "Could not load abandoned bookings.",
    };
  }

  return {
    locationId,
    start,
    end,
    fetchedAt: new Date().toISOString(),
    moneyMode: "service",
    totals: finalizeTotals(totals),
    campaigns,
    flows,
    appointments,
    appointmentsError,
    formFills,
    formFillsError,
    abandonedRecovery,
    commerce: null,
    attributionDays,
  };
}

/** Empty email analytics shell for DTC clients with no GHL location linked. */
export function emptyClientEmailAnalytics(
  start: string,
  end: string,
  moneyMode: AnalyticsMoneyMode = "commerce"
): ClientEmailAnalytics {
  return {
    locationId: "",
    start,
    end,
    fetchedAt: new Date().toISOString(),
    moneyMode,
    totals: emptyTotals(),
    campaigns: [],
    flows: [],
    appointments: null,
    appointmentsError: null,
    formFills: null,
    formFillsError: null,
    abandonedRecovery: null,
    commerce: null,
    attributionDays: DEFAULT_ATTRIBUTION_DAYS,
  };
}
