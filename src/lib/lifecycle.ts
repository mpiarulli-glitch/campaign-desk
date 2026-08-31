/**
 * Lifecycle Marketing department: automations registry, notes, saved links,
 * and the refresh-rule engine that decides when a LinkedIn campaign is tired.
 */

import { nanoid } from "nanoid";
import {
  getDb,
  nowIso,
  type AutomationPlatform,
  type AutomationStatus,
  type LifecycleAutomation,
  type LifecycleCampaignMeta,
  type LifecycleLink,
  type LifecycleNote,
  type LinkCategory,
} from "./db";
import type { SkyleadCampaign, SkyleadSweep } from "./skylead";

export type {
  LifecycleAutomation,
  LifecycleLink,
  LifecycleNote,
  LifecycleCampaignMeta,
};

const PLATFORMS: AutomationPlatform[] = [
  "ghl",
  "klaviyo",
  "skylead",
  "appfront",
  "boulevard",
  "other",
];
const STATUSES: AutomationStatus[] = ["live", "paused", "draft"];
const CATEGORIES: LinkCategory[] = ["doc", "inspo", "reference"];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(fromIso: string | number | null, to = Date.now()): number | null {
  if (!fromIso) return null;
  const ms = typeof fromIso === "number" ? fromIso : Date.parse(fromIso);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.floor((to - ms) / 86_400_000);
}

/* ------------------------------------------------------------- settings */

export interface RefreshSettings {
  /** Days without processing before a campaign counts as stale. */
  staleDays: number;
  /** Acceptance rate floor, as a percentage. */
  minAcceptanceRate: number;
  /** Reply rate floor, as a percentage. */
  minResponseRate: number;
  /** Ignore rate rules until the campaign has this much volume behind it. */
  minVolume: number;
  /** Relative drop vs the trailing average, as a percentage, to count as decay. */
  decayDropPercent: number;
}

export const DEFAULT_REFRESH: RefreshSettings = {
  staleDays: 60,
  minAcceptanceRate: 20,
  minResponseRate: 5,
  minVolume: 50,
  decayDropPercent: 30,
};

const SETTING_KEY = "lifecycle_refresh_settings";

export function getRefreshSettings(): RefreshSettings {
  const row = getDb()
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(SETTING_KEY) as { value: string } | undefined;
  if (!row?.value) return { ...DEFAULT_REFRESH };
  try {
    return { ...DEFAULT_REFRESH, ...(JSON.parse(row.value) as Partial<RefreshSettings>) };
  } catch {
    return { ...DEFAULT_REFRESH };
  }
}

export function setRefreshSettings(patch: Partial<RefreshSettings>): RefreshSettings {
  const next = { ...getRefreshSettings() };
  for (const key of Object.keys(DEFAULT_REFRESH) as Array<keyof RefreshSettings>) {
    const value = patch[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      next[key] = value;
    }
  }
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(SETTING_KEY, JSON.stringify(next), nowIso());
  return next;
}

/* --------------------------------------------------------- stats history */

/** Record today's numbers for every campaign in a sweep. Idempotent per day. */
export function recordSweepStats(data: SkyleadSweep): number {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO lifecycle_campaign_stats
       (skylead_campaign_id, captured_on, acceptance_rate, response_rate, open_rate,
        connections_requested, accepted, messages_sent, replies, total_leads, remaining_leads, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(skylead_campaign_id, captured_on) DO UPDATE SET
       acceptance_rate = excluded.acceptance_rate,
       response_rate = excluded.response_rate,
       open_rate = excluded.open_rate,
       connections_requested = excluded.connections_requested,
       accepted = excluded.accepted,
       messages_sent = excluded.messages_sent,
       replies = excluded.replies,
       total_leads = excluded.total_leads,
       remaining_leads = excluded.remaining_leads,
       captured_at = excluded.captured_at`
  );

  const day = today();
  const ts = nowIso();
  let count = 0;
  const run = db.transaction((rows: SkyleadCampaign[]) => {
    for (const c of rows) {
      stmt.run(
        c.id,
        day,
        c.stats.acceptanceRate,
        c.stats.responseRate,
        c.stats.openRate,
        c.stats.connectionsRequested,
        c.stats.connectionRequestsAccepted,
        c.stats.messagesSent,
        c.stats.connectionReplies,
        c.stats.totalLeads,
        c.stats.remainingLeads,
        ts
      );
      count++;
    }
  });

  run(data.seats.flatMap((s) => s.campaigns));
  return count;
}

/**
 * Trailing average of a rate, ignoring the most recent `excludeDays` so a
 * campaign is compared against its own earlier self rather than right now.
 */
function trailingAverage(
  campaignId: number,
  column: "acceptance_rate" | "response_rate",
  excludeDays = 14,
  windowDays = 60
): { avg: number; samples: number } {
  const to = new Date(Date.now() - excludeDays * 86_400_000).toISOString().slice(0, 10);
  const from = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);
  const row = getDb()
    .prepare(
      `SELECT AVG(${column}) AS avg, COUNT(*) AS n
         FROM lifecycle_campaign_stats
        WHERE skylead_campaign_id = ? AND captured_on >= ? AND captured_on <= ?`
    )
    .get(campaignId, from, to) as { avg: number | null; n: number };
  return { avg: row?.avg ?? 0, samples: row?.n ?? 0 };
}

export function campaignHistory(campaignId: number, limit = 90) {
  return getDb()
    .prepare(
      `SELECT * FROM lifecycle_campaign_stats
        WHERE skylead_campaign_id = ?
        ORDER BY captured_on DESC LIMIT ?`
    )
    .all(campaignId, limit);
}

/* --------------------------------------------------- refresh-rule engine */

/**
 * `off`      campaign is switched off in Skylead, so nothing to judge
 * `blocked`  campaign is on but its seat can't send (auth, 2FA, subscription)
 * `ok` / `watch` / `refresh`  the campaign is genuinely running
 *
 * `off` and `blocked` exist so a stale-but-deliberately-paused campaign does
 * not shout the same way a live, decaying one does. Without them almost every
 * campaign flags and the list stops meaning anything.
 */
export type RefreshSeverity = "ok" | "watch" | "refresh" | "off" | "blocked";

export interface RefreshReason {
  code: "exhausted" | "stale" | "low_acceptance" | "low_reply" | "decay";
  label: string;
  detail: string;
  severity: Exclude<RefreshSeverity, "ok">;
}

export interface RefreshVerdict {
  severity: RefreshSeverity;
  reasons: RefreshReason[];
  daysSinceActivity: number | null;
  muted: boolean;
}

/**
 * Decide whether a campaign needs a refresh. Time-based and performance-based
 * rules both run; the worst reason wins.
 *
 * Campaigns that are switched off, or that sit on a seat which cannot send,
 * short-circuit before the rules run. Judging those on staleness would flag
 * nearly the whole account and bury the handful that genuinely need work.
 */
export function evaluateRefresh(
  campaign: SkyleadCampaign,
  settings: RefreshSettings,
  meta?: LifecycleCampaignMeta | null,
  ctx?: { seatHealthy?: boolean }
): RefreshVerdict {
  const reasons: RefreshReason[] = [];
  const s = campaign.stats;

  const activityMsEarly =
    campaign.lastProcessingTimestamp > 0
      ? campaign.lastProcessingTimestamp
      : Date.parse(campaign.updatedAt);

  if (!s.isActive) {
    return {
      severity: "off",
      reasons: [],
      daysSinceActivity: daysBetween(activityMsEarly),
      muted: Boolean(meta?.muted),
    };
  }

  if (ctx?.seatHealthy === false) {
    return {
      severity: "blocked",
      reasons: [
        {
          code: "stale",
          label: "Seat cannot send",
          detail: "The campaign is switched on but its LinkedIn seat is not connected.",
          severity: "refresh",
        },
      ],
      daysSinceActivity: daysBetween(activityMsEarly),
      muted: Boolean(meta?.muted),
    };
  }

  // Prefer Skylead's own processing clock, then our manual refresh marker,
  // then the record's updatedAt as a last resort.
  const activityMs =
    campaign.lastProcessingTimestamp > 0
      ? campaign.lastProcessingTimestamp
      : meta?.last_refreshed_at
        ? Date.parse(meta.last_refreshed_at)
        : Date.parse(campaign.updatedAt);
  const daysSinceActivity = daysBetween(activityMs);

  const staleLimit =
    meta?.refresh_interval_days && meta.refresh_interval_days > 0
      ? meta.refresh_interval_days
      : settings.staleDays;

  // 1. Out of leads while still switched on. Most actionable signal there is.
  if (s.isActive && s.totalLeads > 0 && s.remainingLeads === 0) {
    reasons.push({
      code: "exhausted",
      label: "Out of leads",
      detail: `All ${s.totalLeads} leads have been worked. The campaign is on but has nothing left to send.`,
      severity: "refresh",
    });
  }

  // 2. Stale by the clock.
  if (daysSinceActivity !== null && daysSinceActivity > staleLimit) {
    reasons.push({
      code: "stale",
      label: "Stale",
      detail: `No activity in ${daysSinceActivity} days, past the ${staleLimit}-day limit.`,
      severity: "refresh",
    });
  }

  // 3. Rate floors, only once there is enough volume to trust the number.
  if (s.connectionsRequested >= settings.minVolume && s.acceptanceRate < settings.minAcceptanceRate) {
    reasons.push({
      code: "low_acceptance",
      label: "Low acceptance",
      detail: `${s.acceptanceRate.toFixed(1)}% acceptance across ${s.connectionsRequested} requests, under the ${settings.minAcceptanceRate}% floor.`,
      severity: "refresh",
    });
  }

  if (s.messagesSent >= settings.minVolume && s.responseRate < settings.minResponseRate) {
    reasons.push({
      code: "low_reply",
      label: "Low reply rate",
      detail: `${s.responseRate.toFixed(1)}% replies across ${s.messagesSent} messages, under the ${settings.minResponseRate}% floor.`,
      severity: "refresh",
    });
  }

  // 4. Decay against the campaign's own trailing average. Needs history, so
  //    this stays quiet until the snapshot table has enough days behind it.
  for (const [column, current, name] of [
    ["acceptance_rate", s.acceptanceRate, "Acceptance"],
    ["response_rate", s.responseRate, "Reply rate"],
  ] as const) {
    const { avg, samples } = trailingAverage(campaign.id, column);
    if (samples < 7 || avg <= 0) continue;
    const dropPercent = ((avg - current) / avg) * 100;
    if (dropPercent >= settings.decayDropPercent) {
      reasons.push({
        code: "decay",
        label: `${name} decaying`,
        detail: `${current.toFixed(1)}% now vs a ${avg.toFixed(1)}% trailing average, down ${dropPercent.toFixed(0)}%.`,
        severity: "watch",
      });
    }
  }

  const muted = Boolean(meta?.muted);
  let severity: RefreshSeverity = "ok";
  if (reasons.some((r) => r.severity === "refresh")) severity = "refresh";
  else if (reasons.length > 0) severity = "watch";
  if (muted) severity = "ok";

  return { severity, reasons, daysSinceActivity, muted };
}

/* ----------------------------------------------------- campaign metadata */

export function listCampaignMeta(): Map<number, LifecycleCampaignMeta> {
  const rows = getDb()
    .prepare(`SELECT * FROM lifecycle_campaign_meta`)
    .all() as LifecycleCampaignMeta[];
  return new Map(rows.map((r) => [r.skylead_campaign_id, r]));
}

export function upsertCampaignMeta(
  campaignId: number,
  patch: Partial<{
    clientId: string | null;
    refreshIntervalDays: number | null;
    muted: boolean;
    note: string;
    markRefreshed: boolean;
  }>
): LifecycleCampaignMeta {
  const db = getDb();
  const ts = nowIso();
  const existing = db
    .prepare(`SELECT * FROM lifecycle_campaign_meta WHERE skylead_campaign_id = ?`)
    .get(campaignId) as LifecycleCampaignMeta | undefined;

  const next = {
    client_id: patch.clientId !== undefined ? patch.clientId : (existing?.client_id ?? null),
    refresh_interval_days:
      patch.refreshIntervalDays !== undefined
        ? patch.refreshIntervalDays
        : (existing?.refresh_interval_days ?? null),
    muted: patch.muted !== undefined ? (patch.muted ? 1 : 0) : (existing?.muted ?? 0),
    note: patch.note !== undefined ? patch.note.trim() : (existing?.note ?? ""),
    last_refreshed_at: patch.markRefreshed ? ts : (existing?.last_refreshed_at ?? null),
  };

  db.prepare(
    `INSERT INTO lifecycle_campaign_meta
       (skylead_campaign_id, client_id, refresh_interval_days, last_refreshed_at, muted, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(skylead_campaign_id) DO UPDATE SET
       client_id = excluded.client_id,
       refresh_interval_days = excluded.refresh_interval_days,
       last_refreshed_at = excluded.last_refreshed_at,
       muted = excluded.muted,
       note = excluded.note,
       updated_at = excluded.updated_at`
  ).run(
    campaignId,
    next.client_id,
    next.refresh_interval_days,
    next.last_refreshed_at,
    next.muted,
    next.note,
    existing?.created_at ?? ts,
    ts
  );

  return db
    .prepare(`SELECT * FROM lifecycle_campaign_meta WHERE skylead_campaign_id = ?`)
    .get(campaignId) as LifecycleCampaignMeta;
}

/* ---------------------------------------------------------- automations */

export function listAutomations(clientId?: string): LifecycleAutomation[] {
  const db = getDb();
  if (clientId) {
    return db
      .prepare(
        `SELECT * FROM lifecycle_automations WHERE client_id = ?
          ORDER BY status ASC, platform ASC, name ASC`
      )
      .all(clientId) as LifecycleAutomation[];
  }
  return db
    .prepare(`SELECT * FROM lifecycle_automations ORDER BY status ASC, platform ASC, name ASC`)
    .all() as LifecycleAutomation[];
}

export function createAutomation(input: {
  name: string;
  clientId?: string | null;
  platform?: string;
  kind?: string;
  status?: string;
  accountRef?: string;
  description?: string;
  link?: string;
}): LifecycleAutomation {
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  const platform = PLATFORMS.includes(input.platform as AutomationPlatform)
    ? (input.platform as AutomationPlatform)
    : "ghl";
  const status = STATUSES.includes(input.status as AutomationStatus)
    ? (input.status as AutomationStatus)
    : "live";

  db.prepare(
    `INSERT INTO lifecycle_automations
       (id, client_id, name, platform, kind, status, account_ref, description, link, last_reviewed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
  ).run(
    id,
    input.clientId || null,
    input.name.trim(),
    platform,
    (input.kind || "").trim(),
    status,
    (input.accountRef || "").trim(),
    (input.description || "").trim(),
    (input.link || "").trim(),
    ts,
    ts
  );

  return db
    .prepare(`SELECT * FROM lifecycle_automations WHERE id = ?`)
    .get(id) as LifecycleAutomation;
}

export function updateAutomation(
  id: string,
  patch: Partial<{
    name: string;
    clientId: string | null;
    platform: string;
    kind: string;
    status: string;
    accountRef: string;
    description: string;
    link: string;
    markReviewed: boolean;
  }>
): LifecycleAutomation | null {
  const db = getDb();
  const existing = db
    .prepare(`SELECT * FROM lifecycle_automations WHERE id = ?`)
    .get(id) as LifecycleAutomation | undefined;
  if (!existing) return null;

  const platform =
    patch.platform !== undefined && PLATFORMS.includes(patch.platform as AutomationPlatform)
      ? (patch.platform as AutomationPlatform)
      : existing.platform;
  const status =
    patch.status !== undefined && STATUSES.includes(patch.status as AutomationStatus)
      ? (patch.status as AutomationStatus)
      : existing.status;

  db.prepare(
    `UPDATE lifecycle_automations SET
       name = ?, client_id = ?, platform = ?, kind = ?, status = ?,
       account_ref = ?, description = ?, link = ?, last_reviewed_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    patch.name !== undefined ? patch.name.trim() : existing.name,
    patch.clientId !== undefined ? patch.clientId : existing.client_id,
    platform,
    patch.kind !== undefined ? patch.kind.trim() : existing.kind,
    status,
    patch.accountRef !== undefined ? patch.accountRef.trim() : existing.account_ref,
    patch.description !== undefined ? patch.description.trim() : existing.description,
    patch.link !== undefined ? patch.link.trim() : existing.link,
    patch.markReviewed ? nowIso() : existing.last_reviewed_at,
    nowIso(),
    id
  );

  return db
    .prepare(`SELECT * FROM lifecycle_automations WHERE id = ?`)
    .get(id) as LifecycleAutomation;
}

export function deleteAutomation(id: string): boolean {
  return getDb().prepare(`DELETE FROM lifecycle_automations WHERE id = ?`).run(id).changes > 0;
}

/* ---------------------------------------------------------------- notes */

export function listNotes(clientId?: string): LifecycleNote[] {
  const db = getDb();
  const order = `ORDER BY pinned DESC, updated_at DESC`;
  if (clientId) {
    return db
      .prepare(`SELECT * FROM lifecycle_notes WHERE client_id = ? ${order}`)
      .all(clientId) as LifecycleNote[];
  }
  return db.prepare(`SELECT * FROM lifecycle_notes ${order}`).all() as LifecycleNote[];
}

export function createNote(input: {
  title?: string;
  body?: string;
  clientId?: string | null;
  tags?: string;
  pinned?: boolean;
}): LifecycleNote {
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  db.prepare(
    `INSERT INTO lifecycle_notes (id, client_id, title, body, tags, pinned, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.clientId || null,
    (input.title || "").trim(),
    (input.body || "").trim(),
    (input.tags || "").trim(),
    input.pinned ? 1 : 0,
    ts,
    ts
  );
  return db.prepare(`SELECT * FROM lifecycle_notes WHERE id = ?`).get(id) as LifecycleNote;
}

export function updateNote(
  id: string,
  patch: Partial<{ title: string; body: string; clientId: string | null; tags: string; pinned: boolean }>
): LifecycleNote | null {
  const db = getDb();
  const existing = db
    .prepare(`SELECT * FROM lifecycle_notes WHERE id = ?`)
    .get(id) as LifecycleNote | undefined;
  if (!existing) return null;

  db.prepare(
    `UPDATE lifecycle_notes SET title = ?, body = ?, client_id = ?, tags = ?, pinned = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    patch.title !== undefined ? patch.title.trim() : existing.title,
    patch.body !== undefined ? patch.body.trim() : existing.body,
    patch.clientId !== undefined ? patch.clientId : existing.client_id,
    patch.tags !== undefined ? patch.tags.trim() : existing.tags,
    patch.pinned !== undefined ? (patch.pinned ? 1 : 0) : existing.pinned,
    nowIso(),
    id
  );

  return db.prepare(`SELECT * FROM lifecycle_notes WHERE id = ?`).get(id) as LifecycleNote;
}

export function deleteNote(id: string): boolean {
  return getDb().prepare(`DELETE FROM lifecycle_notes WHERE id = ?`).run(id).changes > 0;
}

/* ---------------------------------------------------------------- links */

export function listLinks(opts?: { clientId?: string; category?: string }): LifecycleLink[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts?.clientId) {
    where.push(`client_id = ?`);
    params.push(opts.clientId);
  }
  if (opts?.category && CATEGORIES.includes(opts.category as LinkCategory)) {
    where.push(`category = ?`);
    params.push(opts.category);
  }
  const sql = `SELECT * FROM lifecycle_links ${
    where.length ? `WHERE ${where.join(" AND ")}` : ""
  } ORDER BY created_at DESC`;
  return getDb().prepare(sql).all(...params) as LifecycleLink[];
}

export function createLink(input: {
  title: string;
  url: string;
  clientId?: string | null;
  category?: string;
  note?: string;
}): LifecycleLink {
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  const category = CATEGORIES.includes(input.category as LinkCategory)
    ? (input.category as LinkCategory)
    : "doc";

  db.prepare(
    `INSERT INTO lifecycle_links (id, client_id, title, url, category, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.clientId || null,
    input.title.trim(),
    input.url.trim(),
    category,
    (input.note || "").trim(),
    ts,
    ts
  );

  return db.prepare(`SELECT * FROM lifecycle_links WHERE id = ?`).get(id) as LifecycleLink;
}

export function deleteLink(id: string): boolean {
  return getDb().prepare(`DELETE FROM lifecycle_links WHERE id = ?`).run(id).changes > 0;
}
