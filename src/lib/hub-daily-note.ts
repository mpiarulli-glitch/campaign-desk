// Morning brief for MEG Team Hub: recent Basecamp client threads, ads-launch
// mentions, review-link comments, and Deliverables cards that moved to Approved.
//
// Only the last 36 hours. Older unanswered threads belong in the messages
// report, not at the top of the hub. Pings are fetched live in the API route
// because they are per-person and cannot be shared.

import { looksLikeAdsLaunch } from "./ads-launch";
import { approvalActivitySummary } from "./activity-copy";
import { asPerson, hasConnection, listMyReadings, type BcReading } from "./basecamp";
import {
  lastMessageSyncAt,
  listCachedClientMessages,
  threadUrl,
} from "./basecamp-messages";
import { getDb, type BasecampClientMessage } from "./db";

export const TEAM_TZ = "America/Los_Angeles";
/** Overnight plus this morning — not the unanswered-message archive. */
export const RECENT_MS = 36 * 3600 * 1000;

export interface DailyNoteMessage {
  id: string;
  clientName: string;
  title: string;
  preview: string;
  authorName: string;
  url: string;
  at: string;
  awaitingReply: boolean;
}

export interface DailyNoteApproval {
  id: string;
  clientName: string;
  campaignTitle: string;
  summary: string;
  at: string;
  cardUrl: string;
  href: string;
  channel: string | null;
}

export interface DailyNoteComment {
  id: string;
  clientName: string;
  campaignTitle: string;
  actor: string;
  body: string;
  at: string;
  href: string;
}

export interface DailyNotePing {
  id: string;
  section: string;
  title: string;
  excerpt: string;
  projectName: string;
  actor: string;
  url: string;
  at: string;
  unread: boolean;
}

export interface DailyNotePings {
  items: DailyNotePing[];
  reason: "ok" | "no-person" | "not-connected" | "error";
}

export interface DailyNote {
  dayKey: string;
  label: string;
  syncedAt: string | null;
  clientMessages: DailyNoteMessage[];
  waiting: DailyNoteMessage[];
  adsLaunched: DailyNoteMessage[];
  approvals: DailyNoteApproval[];
  reviewComments: DailyNoteComment[];
}

export function pacificDateKey(at: Date | string, timeZone = TEAM_TZ): string {
  const date = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function pacificDayLabel(dayKey: string, timeZone = TEAM_TZ): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  if (!y || !m || !d) return dayKey;
  const noonUtc = new Date(Date.UTC(y, m - 1, d, 19, 0, 0));
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(noonUtc);
}

export function isOnPacificDay(
  iso: string,
  dayKey: string,
  timeZone = TEAM_TZ
): boolean {
  return Boolean(iso) && pacificDateKey(iso, timeZone) === dayKey;
}

export function isRecent(
  iso: string,
  now: Date,
  windowMs = RECENT_MS
): boolean {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  const age = now.getTime() - t;
  return age >= -60_000 && age <= windowMs;
}

function newestFirst<T extends { at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

function clip(text: string, n = 180): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  return `${t.slice(0, n - 1).trimEnd()}…`;
}

function lastActivityAt(row: {
  created_at: string;
  last_client_at: string;
  last_team_at: string;
}): string {
  return [row.last_client_at, row.last_team_at, row.created_at]
    .filter(Boolean)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || row.created_at;
}

function asMessage(row: BasecampClientMessage): DailyNoteMessage {
  return {
    id: row.id,
    clientName: row.client_name,
    title: row.title,
    preview: clip(row.preview || ""),
    authorName: row.author_name,
    url: threadUrl(row),
    at: lastActivityAt(row),
    awaitingReply: row.awaiting_reply === 1,
  };
}

export function buildDailyNote(now: Date = new Date()): DailyNote {
  const dayKey = pacificDateKey(now);
  const cached = listCachedClientMessages();

  const clientMessages = newestFirst(
    cached
      .filter((m) => isRecent(m.last_client_at, now))
      .map(asMessage)
  );

  const waiting = newestFirst(
    cached
      .filter((m) => m.awaiting_reply === 1 && isRecent(m.last_client_at, now))
      .map(asMessage)
  );

  const adsLaunched = newestFirst(
    cached
      .filter((m) => {
        const blob = `${m.title} ${m.preview || ""}`;
        return looksLikeAdsLaunch(blob) && isRecent(lastActivityAt(m), now);
      })
      .map(asMessage)
  );

  const db = getDb();
  const campaigns = db
    .prepare(
      `SELECT id, title, client_name, approved_by, approved_channel,
              approved_at, basecamp_card_url
         FROM campaigns
        WHERE approved_at IS NOT NULL`
    )
    .all() as Array<{
    id: string;
    title: string;
    client_name: string;
    approved_by: string | null;
    approved_channel: string | null;
    approved_at: string;
    basecamp_card_url: string | null;
  }>;

  const approvals: DailyNoteApproval[] = newestFirst(
    campaigns
    .filter((c) => isRecent(c.approved_at, now))
    .map((c) => ({
      id: c.id,
      clientName: c.client_name,
      campaignTitle: c.title,
      summary: approvalActivitySummary({
        client_name: c.client_name,
        actor: c.approved_by,
        campaign_title: c.title,
        approved_channel: c.approved_channel,
      }),
      at: c.approved_at,
      cardUrl: c.basecamp_card_url || "",
      href: `/admin/campaigns/${c.id}`,
      channel: c.approved_channel,
    }))
  );

  const commentRows = db
    .prepare(
      `SELECT c.id, c.author_name, c.body, c.created_at, c.campaign_id,
              cam.title AS campaign_title, cam.client_name
         FROM comments c
         JOIN campaigns cam ON cam.id = c.campaign_id
        ORDER BY c.created_at DESC
        LIMIT 80`
    )
    .all() as Array<{
    id: string;
    author_name: string;
    body: string;
    created_at: string;
    campaign_id: string;
    campaign_title: string;
    client_name: string;
  }>;

  const reviewComments: DailyNoteComment[] = newestFirst(
    commentRows
    .filter((c) => isRecent(c.created_at, now))
    .map((c) => ({
      id: c.id,
      clientName: c.client_name,
      campaignTitle: c.campaign_title,
      actor: c.author_name || "Someone",
      body: clip(c.body, 220),
      at: c.created_at,
      href: `/admin/campaigns/${c.campaign_id}`,
    }))
  );

  return {
    dayKey,
    label: pacificDayLabel(dayKey),
    syncedAt: lastMessageSyncAt(),
    clientMessages,
    waiting,
    adsLaunched,
    approvals,
    reviewComments,
  };
}

const PING_SECTIONS = new Set(["pings", "mentions", "inbox"]);

export function pingsForDay(readings: BcReading[], now: Date): DailyNotePing[] {
  return newestFirst(
    readings
    .filter((r) => PING_SECTIONS.has(r.section) || r.unread)
    .filter((r) => isRecent(r.at, now))
    .map((r) => ({
      id: String(r.id),
      section: r.section,
      title: r.title,
      excerpt: clip(r.excerpt, 160),
      projectName: r.projectName,
      actor: r.actor,
      url: r.url,
      at: r.at,
      unread: r.unread,
    }))
  );
}

export async function loadDailyNotePings(person: string | null): Promise<DailyNotePings> {
  if (!person) return { items: [], reason: "no-person" };
  if (!hasConnection(person)) return { items: [], reason: "not-connected" };
  try {
    const now = new Date();
    const items = pingsForDay(await listMyReadings(asPerson(person)), now);
    return { items, reason: "ok" };
  } catch {
    return { items: [], reason: "error" };
  }
}
