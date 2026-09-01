/**
 * GoHighLevel email performance sync + dashboard aggregations.
 *
 * Pulls sent marketing campaigns (and completed bulk actions) from every
 * client-linked GHL location, caches per-send stats in `ghl_email_sends`, and
 * builds the Email analytics dashboard from that cache.
 *
 * Why a cache: a live fan-out across dozens of locations on every page load
 * would hammer GHL's rate limits the same way an unthrottled workflow sweep
 * did. Sync on demand (or from a cron later); the dashboard reads SQLite.
 *
 * Endpoints match the public v2 paths already used by `pushEmailTemplate` in
 * ghl-tools.ts — those are the ones known to work against this agency.
 */

import { nanoid } from "nanoid";
import { getDb, nowIso } from "./db";
import { ghlRequest, isGhlConfigured } from "./ghl";
import { listRevClients } from "./revenue";

const CONCURRENCY = 4;
const PAGE_SIZE = 20;
/** How far back sync pulls from GHL — six months. */
export const SYNC_LOOKBACK_DAYS = 180;
const MAX_CAMPAIGNS_PER_LOCATION = 100;
const MAX_BULK_PER_LOCATION = 60;

/** Dashboard window options (days). */
export const EMAIL_ANALYTICS_PERIODS = [30, 60, 90, 180] as const;
export type EmailAnalyticsPeriod = (typeof EMAIL_ANALYTICS_PERIODS)[number];

export const EMAIL_ANALYTICS_PERIOD_LABELS: Record<EmailAnalyticsPeriod, string> = {
  30: "30 days",
  60: "60 days",
  90: "90 days",
  180: "6 months",
};

const DEFAULT_PERIOD: EmailAnalyticsPeriod = 90;

export type GhlEmailSource = "email-campaigns" | "bulk-actions";

export interface GhlEmailSendRow {
  id: string;
  client_id: string | null;
  client_name: string;
  location_id: string;
  source: GhlEmailSource;
  source_id: string;
  campaign_name: string;
  subject: string;
  preview_text: string;
  status: string;
  sent_at: string;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
  complained: number;
  bounced: number;
  replied: number;
  open_rate: number;
  click_rate: number;
  synced_at: string;
}

export interface EmailSendView {
  id: string;
  clientId: string | null;
  clientName: string;
  locationId: string;
  source: GhlEmailSource;
  sourceId: string;
  campaignName: string;
  subject: string;
  previewText: string;
  status: string;
  sentAt: string;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
  complained: number;
  bounced: number;
  replied: number;
  openRate: number;
  clickRate: number;
}

export interface SubjectLeaderboardRow {
  subject: string;
  sends: number;
  delivered: number;
  opened: number;
  clicked: number;
  openRate: number;
  clickRate: number;
  clients: string[];
  bestClient: string;
  latestSentAt: string;
}

export interface ClientEngagementRow {
  clientId: string | null;
  clientName: string;
  sends: number;
  delivered: number;
  opened: number;
  clicked: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  latestSentAt: string;
}

export interface MonthTrendRow {
  month: string;
  sends: number;
  delivered: number;
  opened: number;
  clicked: number;
  openRate: number;
  clickRate: number;
}

export interface EmailAnalyticsDashboard {
  configured: boolean;
  lastSyncedAt: string | null;
  periodDays: EmailAnalyticsPeriod;
  periodLabel: string;
  range: { start: string; end: string };
  totals: {
    sends: number;
    clients: number;
    delivered: number;
    opened: number;
    clicked: number;
    openRate: number;
    clickRate: number;
    replyRate: number;
  };
  trends: MonthTrendRow[];
  topSubjects: SubjectLeaderboardRow[];
  bottomSubjects: SubjectLeaderboardRow[];
  clients: ClientEngagementRow[];
  recent: EmailSendView[];
  linkedLocations: number;
  unlinkedClients: number;
}

export interface EmailSyncResult {
  ok: boolean;
  configured: boolean;
  locationsScanned: number;
  campaignsUpserted: number;
  failures: Array<{ locationId: string; clientName: string; error: string }>;
  syncedAt: string;
  error?: string;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function rate(part: number, whole: number): number {
  if (!whole) return 0;
  return (part / whole) * 100;
}

export function parseEmailAnalyticsPeriod(v: unknown): EmailAnalyticsPeriod {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  if (EMAIL_ANALYTICS_PERIODS.includes(n as EmailAnalyticsPeriod)) {
    return n as EmailAnalyticsPeriod;
  }
  return DEFAULT_PERIOD;
}

export function cutoffIsoForDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

export function minDeliveredForPeriod(days: EmailAnalyticsPeriod): number {
  if (days <= 30) return 25;
  if (days <= 60) return 35;
  if (days <= 90) return 40;
  return 50;
}

function lookbackCutoffIso(): string {
  return cutoffIsoForDays(SYNC_LOOKBACK_DAYS);
}

export function inPeriod(sentAt: string, periodDays: number, now = new Date()): boolean {
  if (!sentAt) return true;
  const t = Date.parse(sentAt);
  if (Number.isNaN(t)) return true;
  const start = now.getTime() - periodDays * 86_400_000;
  return t >= start && t <= now.getTime();
}

export function filterSendsByPeriod(
  sends: EmailSendView[],
  periodDays: EmailAnalyticsPeriod
): EmailSendView[] {
  return sends.filter((s) => inPeriod(s.sentAt, periodDays));
}

function monthKey(iso: string): string {
  return (iso || "").slice(0, 7);
}

async function pooled<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length || 1) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/* ----------------------------------------------------------- GHL fetchers */

interface ListedCampaign {
  id: string;
  sourceId: string;
  name: string;
  subject: string;
  previewText: string;
  status: string;
  sentAt: string;
  source: GhlEmailSource;
}

interface RawStats {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
  complained: number;
  bounced: number;
  replied: number;
  openRate: number;
  clickRate: number;
}

function pickSubject(raw: Record<string, unknown>): string {
  return (
    str(raw.subject) ||
    str(raw.subjectLine) ||
    str((raw.emailMeta as Record<string, unknown> | undefined)?.subject) ||
    str((raw.emailMeta as Record<string, unknown> | undefined)?.subjectLine)
  );
}

function pickSentAt(raw: Record<string, unknown>): string {
  return (
    str(raw.completedAt) ||
    str(raw.sentAt) ||
    str(raw.scheduledAt) ||
    str(raw.updatedAt) ||
    str(raw.createdAt)
  );
}

async function listSentEmailCampaigns(
  locationId: string,
  cutoffIso: string
): Promise<ListedCampaign[]> {
  const out: ListedCampaign[] = [];
  let offset = 0;
  while (out.length < MAX_CAMPAIGNS_PER_LOCATION) {
    const res = await ghlRequest<{
      campaigns?: Array<Record<string, unknown>>;
      total?: number;
    }>("GET", `/emails/public/v2/locations/${locationId}/campaigns/emails`, {
      locationId,
      params: {
        limit: PAGE_SIZE,
        offset,
        status: "sent",
      },
    });
    const batch = res.campaigns || [];
    if (!batch.length) break;
    let sawOlder = false;
    for (const raw of batch) {
      const id = str(raw.id);
      if (!id) continue;
      const sentAt = pickSentAt(raw);
      if (sentAt && sentAt < cutoffIso) {
        sawOlder = true;
        continue;
      }
      out.push({
        id,
        sourceId: str(raw.sourceId) || id,
        name: str(raw.name) || "Untitled campaign",
        subject: pickSubject(raw),
        previewText: str(raw.previewText),
        status: str(raw.status) || "sent",
        sentAt,
        source: "email-campaigns",
      });
      if (out.length >= MAX_CAMPAIGNS_PER_LOCATION) break;
    }
    offset += batch.length;
    if (batch.length < PAGE_SIZE || sawOlder) break;
    if (typeof res.total === "number" && offset >= res.total) break;
  }
  return out;
}

async function listCompletedBulkActions(
  locationId: string,
  cutoffIso: string
): Promise<ListedCampaign[]> {
  const out: ListedCampaign[] = [];
  let offset = 0;
  const dateFrom = cutoffIso.slice(0, 10);
  while (out.length < MAX_BULK_PER_LOCATION) {
    const res = await ghlRequest<{
      campaigns?: Array<Record<string, unknown>>;
      total?: number;
    }>("GET", `/emails/public/v2/locations/${locationId}/campaigns/bulk-actions`, {
      locationId,
      params: {
        limit: PAGE_SIZE,
        offset,
        status: "complete",
        dateFrom,
      },
    });
    const batch = res.campaigns || [];
    if (!batch.length) break;
    for (const raw of batch) {
      const id = str(raw.id);
      if (!id) continue;
      out.push({
        id,
        sourceId: str(raw.sourceId) || id,
        name: str(raw.name) || "Bulk send",
        subject: pickSubject(raw),
        previewText: str(raw.previewText),
        status: str(raw.status) || "complete",
        sentAt: pickSentAt(raw),
        source: "bulk-actions",
      });
      if (out.length >= MAX_BULK_PER_LOCATION) break;
    }
    offset += batch.length;
    if (batch.length < PAGE_SIZE) break;
    if (typeof res.total === "number" && offset >= res.total) break;
  }
  return out;
}

async function fetchCampaignDetail(
  locationId: string,
  campaignId: string
): Promise<{ subject: string; previewText: string } | null> {
  try {
    const raw = await ghlRequest<Record<string, unknown>>(
      "GET",
      `/emails/public/v2/locations/${locationId}/campaigns/emails/${encodeURIComponent(campaignId)}`,
      { locationId }
    );
    return {
      subject: pickSubject(raw),
      previewText: str(raw.previewText),
    };
  } catch {
    return null;
  }
}

async function fetchCampaignStats(
  locationId: string,
  source: GhlEmailSource,
  sourceId: string
): Promise<RawStats | null> {
  try {
    const res = await ghlRequest<{ stats?: Record<string, unknown> }>(
      "GET",
      `/emails/public/v2/locations/${locationId}/campaigns/stats/${source}/${encodeURIComponent(sourceId)}`,
      { locationId }
    );
    const s = res.stats || {};
    const delivered = num(s.delivered);
    const opened = num(s.opened);
    const clicked = num(s.clicked);
    const sent = num(s.sent) || delivered;
    const bounced = num(s.permanentFail) + num(s.temporaryFail) + num(s.bounced);
    // Prefer GHL's own rates when present; otherwise derive from counts.
    const openRate = num(s.openRate) || rate(opened, delivered);
    const clickRate = num(s.clickRate) || rate(clicked, delivered);
    return {
      sent,
      delivered,
      opened,
      clicked,
      unsubscribed: num(s.unsubscribed),
      complained: num(s.complained),
      bounced,
      replied: num(s.replied),
      openRate,
      clickRate,
    };
  } catch {
    return null;
  }
}

/** Calendar + review-package subjects, for backfilling GHL rows that omit subject. */
function localSubjectsFor(clientId: string | null): Array<{ subject: string; date: string; title: string; previewText: string }> {
  if (!clientId) return [];
  const db = getDb();
  const calendar = db
    .prepare(
      `SELECT subject, send_date AS date, title, COALESCE(preview_text, '') AS previewText
         FROM scheduled_sends
        WHERE client_id = ?
          AND TRIM(COALESCE(subject, '')) <> ''
        ORDER BY send_date DESC`
    )
    .all(clientId) as Array<{ subject: string; date: string; title: string; previewText: string }>;

  const review = db
    .prepare(
      `SELECT s.subject, SUBSTR(s.created_at, 1, 10) AS date, c.title,
              COALESCE(s.preview_text, '') AS previewText
         FROM email_subjects s
         JOIN campaigns c ON c.id = s.campaign_id
        WHERE c.client_id = ?
          AND c.archived_at IS NULL
          AND TRIM(COALESCE(s.subject, '')) <> ''
        ORDER BY s.created_at DESC`
    )
    .all(clientId) as Array<{ subject: string; date: string; title: string; previewText: string }>;

  return [...calendar, ...review];
}

function matchLocalSubject(
  campaign: ListedCampaign,
  locals: Array<{ subject: string; date: string; title: string; previewText: string }>
): { subject: string; previewText: string } {
  if (campaign.subject) {
    return { subject: campaign.subject, previewText: campaign.previewText };
  }
  const day = (campaign.sentAt || "").slice(0, 10);
  if (day) {
    const onDay = locals.filter((l) => l.date === day);
    if (onDay.length === 1) {
      return { subject: onDay[0].subject, previewText: onDay[0].previewText || campaign.previewText };
    }
  }
  const name = campaign.name.toLowerCase();
  const byTitle = locals.find((l) => l.title && name.includes(l.title.toLowerCase()));
  if (byTitle) {
    return { subject: byTitle.subject, previewText: byTitle.previewText || campaign.previewText };
  }
  return { subject: "", previewText: campaign.previewText };
}

/* ----------------------------------------------------------------- store */

function upsertSend(row: Omit<GhlEmailSendRow, "id" | "synced_at"> & { id?: string }): void {
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT id FROM ghl_email_sends
        WHERE location_id = ? AND source = ? AND source_id = ?`
    )
    .get(row.location_id, row.source, row.source_id) as { id: string } | undefined;
  const id = existing?.id || row.id || nanoid(14);
  const ts = nowIso();
  db.prepare(
    `INSERT INTO ghl_email_sends (
       id, client_id, client_name, location_id, source, source_id,
       campaign_name, subject, preview_text, status, sent_at,
       sent, delivered, opened, clicked, unsubscribed, complained, bounced, replied,
       open_rate, click_rate, synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(location_id, source, source_id) DO UPDATE SET
       client_id = excluded.client_id,
       client_name = excluded.client_name,
       campaign_name = excluded.campaign_name,
       subject = CASE
         WHEN TRIM(excluded.subject) <> '' THEN excluded.subject
         ELSE ghl_email_sends.subject
       END,
       preview_text = CASE
         WHEN TRIM(excluded.preview_text) <> '' THEN excluded.preview_text
         ELSE ghl_email_sends.preview_text
       END,
       status = excluded.status,
       sent_at = excluded.sent_at,
       sent = excluded.sent,
       delivered = excluded.delivered,
       opened = excluded.opened,
       clicked = excluded.clicked,
       unsubscribed = excluded.unsubscribed,
       complained = excluded.complained,
       bounced = excluded.bounced,
       replied = excluded.replied,
       open_rate = excluded.open_rate,
       click_rate = excluded.click_rate,
       synced_at = excluded.synced_at`
  ).run(
    id,
    row.client_id,
    row.client_name,
    row.location_id,
    row.source,
    row.source_id,
    row.campaign_name,
    row.subject,
    row.preview_text,
    row.status,
    row.sent_at,
    row.sent,
    row.delivered,
    row.opened,
    row.clicked,
    row.unsubscribed,
    row.complained,
    row.bounced,
    row.replied,
    row.open_rate,
    row.click_rate,
    ts
  );
}

export function listCachedEmailSends(): GhlEmailSendRow[] {
  return getDb()
    .prepare(`SELECT * FROM ghl_email_sends ORDER BY sent_at DESC, synced_at DESC`)
    .all() as GhlEmailSendRow[];
}

export function lastEmailStatsSyncAt(): string | null {
  const row = getDb()
    .prepare(`SELECT MAX(synced_at) AS synced_at FROM ghl_email_sends`)
    .get() as { synced_at: string | null } | undefined;
  return row?.synced_at || null;
}

/* ------------------------------------------------------------------ sync */

async function syncLocation(args: {
  locationId: string;
  clientId: string | null;
  clientName: string;
  cutoff: string;
}): Promise<{ upserted: number; error?: string }> {
  const { locationId, clientId, clientName, cutoff } = args;
  try {
    const [emails, bulks] = await Promise.all([
      listSentEmailCampaigns(locationId, cutoff),
      listCompletedBulkActions(locationId, cutoff).catch(() => [] as ListedCampaign[]),
    ]);
    const locals = localSubjectsFor(clientId);
    const candidates = [...emails, ...bulks].filter((c) => {
      if (!c.sentAt) return true;
      return c.sentAt >= cutoff;
    });

    const results = await pooled(candidates, async (campaign) => {
      const stats = await fetchCampaignStats(locationId, campaign.source, campaign.sourceId);
      if (!stats || (stats.delivered <= 0 && stats.sent <= 0)) return false;

      let subject = campaign.subject;
      let previewText = campaign.previewText;
      const local = matchLocalSubject(campaign, locals);
      subject = subject || local.subject;
      previewText = previewText || local.previewText;
      if (!subject && campaign.source === "email-campaigns") {
        const detail = await fetchCampaignDetail(locationId, campaign.id);
        if (detail) {
          subject = detail.subject || subject;
          previewText = detail.previewText || previewText;
        }
      }

      upsertSend({
        client_id: clientId,
        client_name: clientName,
        location_id: locationId,
        source: campaign.source,
        source_id: campaign.sourceId,
        campaign_name: campaign.name,
        subject,
        preview_text: previewText,
        status: campaign.status,
        sent_at: campaign.sentAt,
        sent: Math.round(stats.sent),
        delivered: Math.round(stats.delivered),
        opened: Math.round(stats.opened),
        clicked: Math.round(stats.clicked),
        unsubscribed: Math.round(stats.unsubscribed),
        complained: Math.round(stats.complained),
        bounced: Math.round(stats.bounced),
        replied: Math.round(stats.replied),
        open_rate: stats.openRate,
        click_rate: stats.clickRate,
      });
      return true;
    });

    return { upserted: results.filter(Boolean).length };
  } catch (err) {
    return {
      upserted: 0,
      error: err instanceof Error ? err.message : "Failed to sync location",
    };
  }
}

/**
 * Pull recent email performance from every client-linked GHL location.
 *
 * Only mapped clients are scanned — unlinked subaccounts stay out of the
 * fan-out so a sync stays within rate limits. Failures are isolated per
 * location so one dead token does not blank the whole run.
 */
export async function syncGhlEmailStats(): Promise<EmailSyncResult> {
  const syncedAt = nowIso();
  if (!isGhlConfigured()) {
    return {
      ok: false,
      configured: false,
      locationsScanned: 0,
      campaignsUpserted: 0,
      failures: [],
      syncedAt,
      error: "GoHighLevel is not connected. Add the GHL OAuth credentials first.",
    };
  }

  const clients = listRevClients(false);
  const linked = clients.filter((c) => (c.ghl_location_id || "").trim());
  const cutoff = lookbackCutoffIso();
  const failures: EmailSyncResult["failures"] = [];
  let campaignsUpserted = 0;

  const results = await pooled(linked, async (client) => {
    const locationId = client.ghl_location_id.trim();
    return {
      locationId,
      clientName: client.name,
      result: await syncLocation({
        locationId,
        clientId: client.id,
        clientName: client.name,
        cutoff,
      }),
    };
  });

  for (const r of results) {
    campaignsUpserted += r.result.upserted;
    if (r.result.error) {
      failures.push({
        locationId: r.locationId,
        clientName: r.clientName,
        error: r.result.error,
      });
    }
  }

  return {
    ok: failures.length < linked.length || campaignsUpserted > 0,
    configured: true,
    locationsScanned: linked.length,
    campaignsUpserted,
    failures,
    syncedAt,
  };
}

/* ------------------------------------------------------------- dashboard */

function toView(row: GhlEmailSendRow): EmailSendView {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name || "Unknown",
    locationId: row.location_id,
    source: row.source,
    sourceId: row.source_id,
    campaignName: row.campaign_name,
    subject: row.subject,
    previewText: row.preview_text,
    status: row.status,
    sentAt: row.sent_at,
    sent: row.sent,
    delivered: row.delivered,
    opened: row.opened,
    clicked: row.clicked,
    unsubscribed: row.unsubscribed,
    complained: row.complained,
    bounced: row.bounced,
    replied: row.replied,
    openRate: row.open_rate,
    clickRate: row.click_rate,
  };
}

/** Normalise a subject for grouping near-identical lines. */
export function subjectKey(subject: string): string {
  return subject.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Rank subject lines by open rate, requiring a minimum delivered sample so a
 * 100% open on 4 recipients cannot outrank a real winner.
 */
export function rankSubjects(
  sends: EmailSendView[],
  minDelivered = 50
): SubjectLeaderboardRow[] {
  const groups = new Map<
    string,
    {
      subject: string;
      sends: number;
      delivered: number;
      opened: number;
      clicked: number;
      clients: Set<string>;
      latestSentAt: string;
      bestClient: string;
      bestOpenRate: number;
    }
  >();

  for (const s of sends) {
    const subject = s.subject.trim();
    if (!subject) continue;
    const key = subjectKey(subject);
    let g = groups.get(key);
    if (!g) {
      g = {
        subject,
        sends: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        clients: new Set(),
        latestSentAt: "",
        bestClient: s.clientName,
        bestOpenRate: -1,
      };
      groups.set(key, g);
    }
    g.sends += 1;
    g.delivered += s.delivered;
    g.opened += s.opened;
    g.clicked += s.clicked;
    g.clients.add(s.clientName);
    if (s.sentAt > g.latestSentAt) g.latestSentAt = s.sentAt;
    if (s.openRate > g.bestOpenRate) {
      g.bestOpenRate = s.openRate;
      g.bestClient = s.clientName;
    }
  }

  return [...groups.values()]
    .filter((g) => g.delivered >= minDelivered)
    .map((g) => ({
      subject: g.subject,
      sends: g.sends,
      delivered: g.delivered,
      opened: g.opened,
      clicked: g.clicked,
      openRate: rate(g.opened, g.delivered),
      clickRate: rate(g.clicked, g.delivered),
      clients: [...g.clients].sort(),
      bestClient: g.bestClient,
      latestSentAt: g.latestSentAt,
    }))
    .sort((a, b) => b.openRate - a.openRate || b.delivered - a.delivered);
}

export function rankClients(sends: EmailSendView[]): ClientEngagementRow[] {
  const groups = new Map<
    string,
    {
      clientId: string | null;
      clientName: string;
      sends: number;
      delivered: number;
      opened: number;
      clicked: number;
      replied: number;
      latestSentAt: string;
    }
  >();

  for (const s of sends) {
    const key = s.clientId || `name:${s.clientName}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        clientId: s.clientId,
        clientName: s.clientName,
        sends: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        replied: 0,
        latestSentAt: "",
      };
      groups.set(key, g);
    }
    g.sends += 1;
    g.delivered += s.delivered;
    g.opened += s.opened;
    g.clicked += s.clicked;
    g.replied += s.replied;
    if (s.sentAt > g.latestSentAt) g.latestSentAt = s.sentAt;
  }

  return [...groups.values()]
    .filter((g) => g.delivered > 0)
    .map((g) => ({
      clientId: g.clientId,
      clientName: g.clientName,
      sends: g.sends,
      delivered: g.delivered,
      opened: g.opened,
      clicked: g.clicked,
      openRate: rate(g.opened, g.delivered),
      clickRate: rate(g.clicked, g.delivered),
      replyRate: rate(g.replied, g.delivered),
      latestSentAt: g.latestSentAt,
    }))
    .sort((a, b) => b.openRate - a.openRate || b.delivered - a.delivered);
}

export function monthTrends(sends: EmailSendView[]): MonthTrendRow[] {
  const groups = new Map<
    string,
    { sends: number; delivered: number; opened: number; clicked: number }
  >();

  for (const s of sends) {
    const month = monthKey(s.sentAt);
    if (!month || month.length < 7) continue;
    let g = groups.get(month);
    if (!g) {
      g = { sends: 0, delivered: 0, opened: 0, clicked: 0 };
      groups.set(month, g);
    }
    g.sends += 1;
    g.delivered += s.delivered;
    g.opened += s.opened;
    g.clicked += s.clicked;
  }

  return [...groups.entries()]
    .map(([month, g]) => ({
      month,
      sends: g.sends,
      delivered: g.delivered,
      opened: g.opened,
      clicked: g.clicked,
      openRate: rate(g.opened, g.delivered),
      clickRate: rate(g.clicked, g.delivered),
    }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
}

export function buildEmailAnalyticsDashboard(
  periodDays: EmailAnalyticsPeriod = DEFAULT_PERIOD
): EmailAnalyticsDashboard {
  const clients = listRevClients(false);
  const linkedLocations = clients.filter((c) => (c.ghl_location_id || "").trim()).length;
  const unlinkedClients = clients.length - linkedLocations;
  const allRows = listCachedEmailSends().map(toView);
  const rows = filterSendsByPeriod(allRows, periodDays);
  const minDelivered = minDeliveredForPeriod(periodDays);
  const rankedSubjects = rankSubjects(rows, minDelivered);
  const delivered = rows.reduce((n, r) => n + r.delivered, 0);
  const opened = rows.reduce((n, r) => n + r.opened, 0);
  const clicked = rows.reduce((n, r) => n + r.clicked, 0);
  const replied = rows.reduce((n, r) => n + r.replied, 0);
  const rangeStart = cutoffIsoForDays(periodDays).slice(0, 10);
  const rangeEnd = new Date().toISOString().slice(0, 10);

  return {
    configured: isGhlConfigured(),
    lastSyncedAt: lastEmailStatsSyncAt(),
    periodDays,
    periodLabel: EMAIL_ANALYTICS_PERIOD_LABELS[periodDays],
    range: { start: rangeStart, end: rangeEnd },
    totals: {
      sends: rows.length,
      clients: new Set(rows.map((r) => r.clientId || r.clientName)).size,
      delivered,
      opened,
      clicked,
      openRate: rate(opened, delivered),
      clickRate: rate(clicked, delivered),
      replyRate: rate(replied, delivered),
    },
    trends: monthTrends(rows),
    topSubjects: rankedSubjects.slice(0, 15),
    bottomSubjects: [...rankedSubjects].reverse().slice(0, 8),
    clients: rankClients(rows).slice(0, 25),
    recent: rows.slice(0, 40),
    linkedLocations,
    unlinkedClients,
  };
}
