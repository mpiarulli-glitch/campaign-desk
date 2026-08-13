import { nanoid } from "nanoid";
import { HAS_PRODUCTION_BRIEF_SQL } from "./production-brief";
import {
  getDb,
  nowIso,
  type AssetType,
  type BusinessModel,
  type ScheduledSend,
  type SendStatus,
} from "./db";

export type { ScheduledSend, SendStatus, AssetType };

const STATUSES: SendStatus[] = ["requested", "planned", "scheduled", "sent"];
export const SEND_STATUSES = STATUSES;

const ASSET_TYPES: AssetType[] = [
  "social_post",
  "social_video_carousel",
  "email_campaign",
  "crm_automation",
  "blog_post",
];
export const ASSET_TYPES_LIST = ASSET_TYPES;

function normalizeAssetType(v: unknown): AssetType | "" {
  return ASSET_TYPES.includes(v as AssetType) ? (v as AssetType) : "";
}

/**
 * Which rows on the calendar are editorial planning rather than real scheduling.
 *
 * A production is a shoot the client booked or an admin briefed. It shares the
 * table with planned content but is not part of an editorial calendar: it must
 * never be swept up by a replace-the-range import, and a client whose only rows
 * are shoots still has no editorial calendar.
 *
 * Written once and shared, because the importer, the calendar, and the "has this
 * client got a calendar" check have to agree. When they drifted, one of them was
 * always wrong about somebody's shoot.
 *
 * See ./production-brief for why a real brief is one that parses as JSON rather
 * than one that is merely non-empty.
 */
export const EDITORIAL_PREDICATE = `requested_by_client = 0 AND NOT ${HAS_PRODUCTION_BRIEF_SQL}`;
export const PRODUCTION_PREDICATE = `(requested_by_client = 1 OR ${HAS_PRODUCTION_BRIEF_SQL})`;

// A send joined with its client's model (for calendar color-coding). model is
// null when the send has no linked client.
export interface SendWithClient extends ScheduledSend {
  business_model: BusinessModel | null;
}

export interface ClientCalendarSummary {
  clientId: string;
  /**
   * Editorial entries for this client, all time and every month. Zero is the
   * signal that there is no calendar to look at yet, which is a different fact
   * from "nothing in the month you happen to be viewing" and has to be told
   * apart from it: prompting somebody to build a calendar that already exists
   * because they paged into an empty December would be worse than saying nothing.
   */
  total: number;
  /** Production shoots. Named separately so an account with only shoots reads right. */
  productions: number;
  firstDate: string;
  lastDate: string;
  /** Months (YYYY-MM) that hold editorial entries, ascending. */
  months: string[];
}

/**
 * The editorial footprint of one client's calendar.
 *
 * Deliberately not team-scoped. Whether an account has a calendar at all is a
 * fact about the account, not about who is looking: a social-team viewer must not
 * be told to build a calendar that is already full of email work they cannot see.
 */
export function clientCalendarSummary(clientId: string): ClientCalendarSummary {
  const db = getDb();
  // Cancelled rows are excluded: a called-off entry is not something the client
  // is owed, so it should not make an empty calendar look occupied.
  const where = `client_id = ? AND cancelled_at IS NULL`;

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(MIN(send_date), '') AS firstDate,
              COALESCE(MAX(send_date), '') AS lastDate
       FROM scheduled_sends
       WHERE ${where} AND ${EDITORIAL_PREDICATE}`
    )
    .get(clientId) as { total: number; firstDate: string; lastDate: string };

  const productions = db
    .prepare(
      `SELECT COUNT(*) AS n FROM scheduled_sends
       WHERE ${where} AND ${PRODUCTION_PREDICATE}`
    )
    .get(clientId) as { n: number };

  const months = (
    db
      .prepare(
        `SELECT DISTINCT substr(send_date, 1, 7) AS month FROM scheduled_sends
         WHERE ${where} AND ${EDITORIAL_PREDICATE}
         ORDER BY month ASC`
      )
      .all(clientId) as Array<{ month: string }>
  ).map((r) => r.month);

  return {
    clientId,
    total: totals.total,
    productions: productions.n,
    firstDate: totals.firstDate,
    lastDate: totals.lastDate,
    months,
  };
}

export interface ProductionSend extends ScheduledSend {
  account_manager: string;
  videographer: string;
}

function normalizeStatus(v: unknown): SendStatus {
  return STATUSES.includes(v as SendStatus) ? (v as SendStatus) : "planned";
}

// Sends whose date falls in [start, end] (inclusive), ascending. Dates are
// YYYY-MM-DD strings so lexical comparison is chronological.
// `assetTypes` narrows to the kinds of work a team owns (see TEAM_FOCUS). An
// empty list returns no sends, which is how "does no campaign work" is spelled.
export function listSends(
  start: string,
  end: string,
  opts?: { assetTypes?: readonly AssetType[] }
): SendWithClient[] {
  // An empty list means "owns no campaign work", which must return nothing
  // rather than falling through to no filter at all.
  const types = opts?.assetTypes;
  const filter = types
    ? types.length
      ? `AND s.asset_type IN (${types.map(() => "?").join(", ")})`
      : "AND 1 = 0"
    : "";
  const params = types ? [start, end, ...types] : [start, end];
  return getDb()
    .prepare(
      `SELECT s.*, c.business_model AS business_model
       FROM scheduled_sends s
       LEFT JOIN rev_clients c ON c.id = s.client_id
       WHERE s.send_date >= ? AND s.send_date <= ? ${filter}
       ORDER BY s.send_date ASC, s.created_at ASC`
    )
    .all(...params) as SendWithClient[];
}

// Client-submitted production requests, including the people responsible for
// the account and shoot. These power the Requested / Confirmed admin queues.
export function listProductionSends(includeCancelled = false): ProductionSend[] {
  return getDb()
    .prepare(
      `SELECT
         s.*,
         COALESCE(c.account_manager, '') AS account_manager,
         COALESCE(v.name, '') AS videographer
       FROM scheduled_sends s
       LEFT JOIN rev_clients c ON c.id = s.client_id
       LEFT JOIN videographers v ON v.id = c.videographer_id
       WHERE s.requested_by_client = 1
         AND (? = 1 OR s.cancelled_at IS NULL)
       ORDER BY
         CASE WHEN s.status = 'requested' THEN 0 ELSE 1 END,
         s.send_date ASC,
         s.send_time ASC,
         s.created_at ASC`
    )
    .all(includeCancelled ? 1 : 0) as ProductionSend[];
}

// Cancelling a production: called off, or requested by accident. The row stays
// for the record but stops counting, so the client goes back to needing a
// production and reminders resume. Reversible, unlike deleteSend.
export function cancelSend(id: string, cancelled: boolean): ScheduledSend | null {
  const existing = getSend(id);
  if (!existing) return null;
  const ts = nowIso();
  getDb()
    .prepare(`UPDATE scheduled_sends SET cancelled_at = ?, updated_at = ? WHERE id = ?`)
    .run(cancelled ? ts : null, ts, id);
  return getSend(id);
}

// The no-login link for the crew. Minted on demand so old productions get one
// the first time somebody needs it.
export function getOrCreateCrewToken(id: string): string | null {
  const existing = getSend(id);
  if (!existing) return null;
  if (existing.crew_token) return existing.crew_token;
  const token = nanoid(24);
  getDb()
    .prepare(`UPDATE scheduled_sends SET crew_token = ?, updated_at = ? WHERE id = ?`)
    .run(token, nowIso(), id);
  return token;
}

export function getSendByCrewToken(token: string): ScheduledSend | null {
  if (!token) return null;
  return (
    (getDb()
      .prepare(`SELECT * FROM scheduled_sends WHERE crew_token = ?`)
      .get(token) as ScheduledSend | undefined) || null
  );
}

// The crew accepting a job from their link. Moves it out of "requested", which
// is what the Needs Approval card is waiting on, and stamps who-when separately
// from the status so an admin confirmation and a crew acceptance stay tellable
// apart.
//
// Idempotent: pressing it twice, or two people pressing it, is not an error. It
// refuses only when there is nothing to approve.
export function approveByCrew(
  token: string
): { ok: true; send: ScheduledSend; alreadyDone: boolean } | { ok: false; error: string } {
  const existing = getSendByCrewToken(token);
  if (!existing) return { ok: false, error: "Not found" };
  if (existing.cancelled_at) {
    return { ok: false, error: "This production was cancelled." };
  }
  if (existing.crew_approved_at) {
    return { ok: true, send: existing, alreadyDone: true };
  }
  if (existing.status !== "requested") {
    // Already confirmed by an admin. Record the acceptance without moving it
    // backwards through the statuses.
    const ts = nowIso();
    getDb()
      .prepare(`UPDATE scheduled_sends SET crew_approved_at = ?, updated_at = ? WHERE id = ?`)
      .run(ts, ts, existing.id);
    return { ok: true, send: getSend(existing.id)!, alreadyDone: false };
  }
  const ts = nowIso();
  getDb()
    .prepare(
      `UPDATE scheduled_sends
       SET status = 'scheduled', crew_approved_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(ts, ts, existing.id);
  return { ok: true, send: getSend(existing.id)!, alreadyDone: false };
}

export function getSend(id: string): ScheduledSend | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM scheduled_sends WHERE id = ?`)
      .get(id) as ScheduledSend | undefined) || null
  );
}

// Resolve the client display name from rev_clients when a client_id is given.
function resolveClientName(clientId: string | null, fallback: string): string {
  if (clientId) {
    const row = getDb()
      .prepare(`SELECT name FROM rev_clients WHERE id = ?`)
      .get(clientId) as { name: string } | undefined;
    if (row) return row.name;
  }
  return (fallback || "").trim();
}

export function createSend(input: {
  clientId?: string | null;
  clientName?: string;
  title: string;
  sendDate: string;
  sendTime?: string;
  duration?: string;
  status?: SendStatus;
  platform?: string;
  assetType?: AssetType | "";
  note?: string;
  audience?: string;
  purpose?: string;
  offer?: string;
  subject?: string;
  previewText?: string;
  productionBrief?: string;
  cadenceWindowStart?: string | null;
  requestedByClient?: boolean;
  // Set by the spreadsheet importer so the whole batch can be undone together.
  importBatch?: string;
}): ScheduledSend {
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  const clientId = input.clientId || null;
  db.prepare(
    `INSERT INTO scheduled_sends
      (id, client_id, client_name, title, send_date, send_time, duration, status, platform, asset_type, note,
       audience, purpose, offer, subject, preview_text, production_brief,
       cadence_window_start, requested_by_client, import_batch, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    clientId,
    resolveClientName(clientId, input.clientName || ""),
    input.title.trim(),
    input.sendDate,
    (input.sendTime || "").trim(),
    input.duration === "full" ? "full" : "half",
    normalizeStatus(input.status),
    (input.platform || "").trim(),
    normalizeAssetType(input.assetType),
    (input.note || "").trim(),
    (input.audience || "").trim(),
    (input.purpose || "").trim(),
    (input.offer || "").trim(),
    (input.subject || "").trim(),
    (input.previewText || "").trim(),
    input.productionBrief || "",
    input.cadenceWindowStart || null,
    input.requestedByClient ? 1 : 0,
    (input.importBatch || "").trim(),
    ts,
    ts
  );
  return getSend(id)!;
}

export function updateSend(
  id: string,
  updates: Partial<{
    clientId: string | null;
    clientName: string;
    title: string;
    sendDate: string;
    sendTime: string;
    duration: string;
    status: SendStatus;
    platform: string;
    assetType: AssetType | "";
    note: string;
    audience: string;
    purpose: string;
    offer: string;
    subject: string;
    previewText: string;
    // JSON blob of the production brief. Admins fill this in when a production
    // was arranged off-app and the client never submitted one.
    productionBrief: string;
  }>
): ScheduledSend | null {
  const existing = getSend(id);
  if (!existing) return null;
  const db = getDb();
  const clientId =
    updates.clientId === undefined ? existing.client_id : updates.clientId;
  const clientName =
    updates.clientId !== undefined || updates.clientName !== undefined
      ? resolveClientName(clientId, updates.clientName ?? existing.client_name)
      : existing.client_name;
  db.prepare(
    `UPDATE scheduled_sends SET
       client_id = ?, client_name = ?, title = ?, send_date = ?, send_time = ?, duration = ?,
       status = ?, platform = ?, asset_type = ?, note = ?, audience = ?, purpose = ?,
       offer = ?, subject = ?, preview_text = ?, production_brief = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    clientId,
    clientName,
    updates.title?.trim() ?? existing.title,
    updates.sendDate ?? existing.send_date,
    updates.sendTime?.trim() ?? existing.send_time,
    updates.duration === undefined ? existing.duration : updates.duration === "full" ? "full" : "half",
    updates.status ? normalizeStatus(updates.status) : existing.status,
    updates.platform?.trim() ?? existing.platform,
    updates.assetType !== undefined ? normalizeAssetType(updates.assetType) : existing.asset_type,
    updates.note?.trim() ?? existing.note,
    updates.audience?.trim() ?? existing.audience,
    updates.purpose?.trim() ?? existing.purpose,
    updates.offer?.trim() ?? existing.offer,
    updates.subject?.trim() ?? existing.subject,
    updates.previewText?.trim() ?? existing.preview_text,
    updates.productionBrief ?? existing.production_brief,
    nowIso(),
    id
  );
  return getSend(id);
}

export function deleteSend(id: string): boolean {
  return getDb().prepare(`DELETE FROM scheduled_sends WHERE id = ?`).run(id).changes > 0;
}
