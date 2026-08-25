/**
 * The Deliverables board: one card per client per month, tracked through the
 * same production pipeline the team already uses in Basecamp (QA, internal
 * revisions, client approval, follow-up, revisions, scheduling, done).
 *
 * A card's column is always hand-set — dragging or the status picker is the
 * only thing that changes it. Its email checklist rows are never stored:
 * they're read live off `campaigns` by client_id + created_at month, so that
 * part of the card can never drift from the Campaigns tab. Only the extra,
 * non-email deliverables (LinkedIn, SMS, landing pages, etc.) are persisted,
 * in lifecycle_board_items.
 */

import { nanoid } from "nanoid";
import {
  getDb,
  nowIso,
  type BoardColumnKey,
  type CampaignStatus,
  type LifecycleBoardCard,
  type LifecycleBoardRemoval,
} from "./db";
import { createCampaign } from "./campaigns";
import { APP_TIME_ZONE, currentPeriod, shiftPeriod } from "./period";
import { listRevClients, updateRevClient } from "./revenue";

export interface BoardColumn {
  key: BoardColumnKey;
  label: string;
}

/**
 * Where every client starts each month. Triage is not part of the pipeline —
 * it's the parking lot you pull work out of — so the UI renders it as its own
 * area above the columns rather than as the first column.
 */
export const TRIAGE_COLUMN: BoardColumn = { key: "triage", label: "Triage" };

export const BOARD_COLUMNS: BoardColumn[] = [
  TRIAGE_COLUMN,
  { key: "next_up", label: "Next Up" },
  { key: "qa", label: "Sent for QA Check" },
  { key: "internal_revisions", label: "Internal Revisions" },
  { key: "sent_for_approval", label: "Sent for Approval" },
  { key: "follow_up_sent", label: "Follow-Up Sent" },
  { key: "needs_revisions", label: "Needs Revisions" },
  { key: "scheduling", label: "Needs Scheduling" },
  { key: "completed", label: "Completed" },
  { key: "deliverables_met", label: "Deliverables Met" },
];

const COLUMN_KEYS = BOARD_COLUMNS.map((c) => c.key) as string[];

function isColumnKey(v: unknown): v is BoardColumnKey {
  return typeof v === "string" && COLUMN_KEYS.includes(v);
}

// Month keys are shared with the board page, timezone rules and all. See
// ./period for why they are not derived from UTC.
export { currentPeriod, isValidPeriod } from "./period";

/**
 * The first month a board change is allowed to sweep forward from. Adding or
 * removing a client is a standing decision, so it carries into every later
 * month — but months that have already been worked are a record of what
 * happened, so the sweep never starts earlier than the current one. Acting on
 * an old board still changes that one card; it just doesn't rewrite its
 * neighbours.
 */
function sweepFrom(period: string): string {
  const current = currentPeriod();
  return period > current ? period : current;
}

/** How far ahead a removal will pre-fill dismissed rows when it is undone. */
const MAX_GAP_MONTHS = 240;

function getRemoval(clientId: string): LifecycleBoardRemoval | undefined {
  return getDb()
    .prepare(`SELECT * FROM lifecycle_board_removals WHERE client_id = ?`)
    .get(clientId) as LifecycleBoardRemoval | undefined;
}

/** Clients that are off the board for `period`, by standing removal. */
function removedClientIds(period: string): Set<string> {
  const rows = getDb()
    .prepare(`SELECT client_id FROM lifecycle_board_removals WHERE from_period <= ?`)
    .all(period) as Array<{ client_id: string }>;
  return new Set(rows.map((r) => r.client_id));
}

/**
 * A campaign counts toward the month's contracted volume once it has left our
 * hands, not once the client signs off. `needs_changes` still counts: the work
 * was delivered and is now in a revision loop, so dropping it would make the
 * number fall backwards when a client sends notes.
 */
const DELIVERED_STATUSES: CampaignStatus[] = [
  "in_review",
  "needs_changes",
  "approved",
  "scheduled",
  "sent",
];

export interface BoardCampaignItem {
  id: string;
  title: string;
  status: CampaignStatus;
  approvedChannel: string | null;
  updatedAt: string;
  magicToken: string;
  /**
   * Emails inside this campaign. A campaign is a review package and routinely
   * holds several, so the quota counts these rather than campaign rows.
   */
  emailCount: number;
  /** Text messages inside this campaign. Shown, but never counted against the
   *  email quota — a client's contract is written in emails. */
  smsCount: number;
  /** Whether this campaign's emails count toward the month's quota yet. */
  delivered: boolean;
  /** True once an approval card exists to comment a follow-up onto. */
  hasCard: boolean;
  /** True when this send was logged from the board for work done off-app. */
  loggedOffApp: boolean;
}

export interface BoardCard {
  id: string;
  clientId: string;
  clientName: string;
  period: string;
  columnKey: BoardColumnKey;
  /** Best guess from this month's campaign statuses. A hint only — never applied automatically. */
  suggestedColumnKey: BoardColumnKey;
  sortOrder: number;
  campaigns: BoardCampaignItem[];
  /** Emails per month this client is contracted for. 0 means none on file. */
  quota: number;
  /** Emails delivered against that quota this month. */
  delivered: number;
  updatedAt: string;
}

/**
 * Only campaigns that reached the client appear on a card, so this reads the
 * worst live status: anything in revision outranks anything awaiting sign-off,
 * and a card is only "met" once every send has actually gone out.
 */
function suggestColumn(campaigns: BoardCampaignItem[]): BoardColumnKey {
  if (campaigns.length === 0) return "triage";
  if (campaigns.some((c) => c.status === "needs_changes")) return "needs_revisions";
  if (campaigns.some((c) => c.status === "in_review")) return "sent_for_approval";
  if (campaigns.every((c) => c.status === "sent")) return "deliverables_met";
  if (campaigns.every((c) => c.status === "scheduled" || c.status === "sent")) return "scheduling";
  return "completed";
}

function toBoardCard(
  row: LifecycleBoardCard,
  clientName: string,
  quota: number,
  campaigns: BoardCampaignItem[]
): BoardCard {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName,
    period: row.period,
    columnKey: row.column_key,
    suggestedColumnKey: suggestColumn(campaigns),
    sortOrder: row.sort_order,
    campaigns: [...campaigns].sort((a, b) => a.title.localeCompare(b.title)),
    quota,
    delivered: campaigns.reduce((n, c) => n + c.emailCount, 0),
    updatedAt: row.updated_at,
  };
}

/**
 * Every active client gets a card for `period` the first time the board opens
 * on it, except the ones removed from the board on or before that month. A
 * removal has to be honoured here rather than only on existing rows: a future
 * month has no rows yet, and seeding it blind would put a client the team
 * already took off back on the board.
 */
function ensureCardsForPeriod(period: string): void {
  const db = getDb();
  const removed = removedClientIds(period);
  const clients = listRevClients(false).filter(
    (c) => c.active === 1 && !removed.has(c.id)
  );
  if (!clients.length) return;
  const ts = nowIso();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO lifecycle_board_cards
       (id, client_id, period, column_key, sort_order, notes, created_at, updated_at)
     VALUES (?, ?, ?, 'triage', 0, '', ?, ?)`
  );
  const run = db.transaction((rows: typeof clients) => {
    for (const c of rows) insert.run(nanoid(12), c.id, period, ts, ts);
  });
  run(clients);
}

export function listBoardCards(period: string): BoardCard[] {
  ensureCardsForPeriod(period);
  const db = getDb();

  const cardRows = db
    .prepare(`SELECT * FROM lifecycle_board_cards WHERE period = ? AND dismissed = 0`)
    .all(period) as LifecycleBoardCard[];
  if (!cardRows.length) return [];

  const allClients = listRevClients(true);
  const clientNames = new Map(allClients.map((c) => [c.id, c.name]));
  const clientQuotas = new Map(allClients.map((c) => [c.id, c.monthly_email_quota ?? 0]));

  // This board tracks lifecycle sends only: emails and SMS. Blog posts, copy
  // decks and website mock-ups are ignored — a review package can hold any of
  // those, and they are not lifecycle work. A campaign carrying none of the
  // two drops out entirely via the HAVING clause.
  //
  // The counts are split because a client's contract is written in emails.
  // SMS shows on the card but does not tick off an email quota, and per-kind
  // counts matter because a package routinely bundles several sends; counting
  // campaign rows would under-report delivered volume.
  const campaignRows = db
    .prepare(
      `SELECT c.id, c.title, c.client_id, c.status, c.approved_channel, c.updated_at, c.magic_token,
              c.basecamp_card_id, c.logged_off_app,
              SUM(CASE WHEN e.kind = 'email' THEN 1 ELSE 0 END) AS email_count,
              SUM(CASE WHEN e.kind = 'sms'   THEN 1 ELSE 0 END) AS sms_count
         FROM campaigns c
         JOIN campaign_emails e
           ON e.campaign_id = c.id AND e.kind IN ('email', 'sms')
        WHERE c.archived_at IS NULL AND c.client_id IS NOT NULL
          AND c.status IN (${DELIVERED_STATUSES.map(() => "?").join(",")})
          AND strftime('%Y-%m', c.created_at) = ?
        GROUP BY c.id
        HAVING COUNT(e.id) > 0`
    )
    .all(...DELIVERED_STATUSES, period) as Array<{
    id: string;
    title: string;
    client_id: string;
    status: CampaignStatus;
    approved_channel: string | null;
    updated_at: string;
    magic_token: string;
    basecamp_card_id: string | null;
    logged_off_app: number;
    email_count: number;
    sms_count: number;
  }>;
  const campaignsByClient = new Map<string, BoardCampaignItem[]>();
  for (const r of campaignRows) {
    const list = campaignsByClient.get(r.client_id) ?? [];
    list.push({
      id: r.id,
      title: r.title,
      status: r.status,
      approvedChannel: r.approved_channel,
      updatedAt: r.updated_at,
      magicToken: r.magic_token,
      emailCount: r.email_count,
      smsCount: r.sms_count,
      delivered: true,
      hasCard: Boolean(r.basecamp_card_id),
      loggedOffApp: Boolean(r.logged_off_app),
    });
    campaignsByClient.set(r.client_id, list);
  }

  return cardRows
    .map((row) => {
      const clientName = clientNames.get(row.client_id);
      if (!clientName) return null;
      return toBoardCard(
        row,
        clientName,
        clientQuotas.get(row.client_id) ?? 0,
        campaignsByClient.get(row.client_id) ?? []
      );
    })
    .filter((c): c is BoardCard => c !== null)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.clientName.localeCompare(b.clientName));
}

function getCardRow(id: string): LifecycleBoardCard | undefined {
  return getDb().prepare(`SELECT * FROM lifecycle_board_cards WHERE id = ?`).get(id) as
    | LifecycleBoardCard
    | undefined;
}

export function boardCardExists(id: string): boolean {
  return Boolean(getCardRow(id));
}

const OFF_APP_STATUSES = new Set<CampaignStatus>(["sent", "approved"]);

export interface OffAppCampaignInput {
  title: string;
  /** YYYY-MM-DD. Clamped onto this card's month so the send lands on this board. */
  sentOn?: string;
  status?: "sent" | "approved";
}

/**
 * Stamp a completed send onto a board card for work that never went through
 * Campaign Desk. The board's counts read live off `campaigns`, so this is a
 * real sent/approved campaign with one email — not a parallel ledger.
 */
export function logOffAppCampaign(
  cardId: string,
  input: OffAppCampaignInput
): BoardCard | null {
  const row = getCardRow(cardId);
  if (!row || row.dismissed === 1) return null;
  const title = input.title.trim();
  if (!title) return null;

  const client = listRevClients(true).find((c) => c.id === row.client_id);
  if (!client) return null;

  const status: CampaignStatus = OFF_APP_STATUSES.has(input.status as CampaignStatus)
    ? (input.status as CampaignStatus)
    : "sent";
  const createdAt = isoInPeriod(row.period, input.sentOn);
  const ts = nowIso();

  const db = getDb();
  const run = db.transaction(() => {
    const campaign = createCampaign({
      title,
      clientName: client.name,
      clientId: client.id,
      description: "Logged off-app. Completed outside Campaign Desk.",
      htmlContent: "<p>Logged off-app — no copy in Campaign Desk.</p>",
      emailTitle: title,
    });
    db.prepare(
      `UPDATE campaigns
          SET status = ?, created_at = ?, logged_off_app = 1,
              approved_at = ?, approved_channel = ?, updated_at = ?
        WHERE id = ?`
    ).run(
      status,
      createdAt,
      status === "approved" ? createdAt : null,
      status === "approved" ? "client" : null,
      ts,
      campaign.id
    );
    return campaign.id;
  });
  run();

  return listBoardCards(row.period).find((c) => c.id === cardId) ?? null;
}

/** Put `sentOn` (or today) on this board month so SQLite's UTC month key matches. */
function isoInPeriod(period: string, sentOn?: string): string {
  const [py, pm] = period.split("-").map(Number);
  const lastDay = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  let day = Math.min(15, lastDay);

  if (sentOn && /^\d{4}-\d{2}-\d{2}$/.test(sentOn)) {
    const d = Number(sentOn.slice(8, 10));
    if (Number.isFinite(d) && d >= 1) day = Math.min(d, lastDay);
  } else if (currentPeriod() === period) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: APP_TIME_ZONE,
      day: "2-digit",
    }).formatToParts(new Date());
    const today = Number(parts.find((p) => p.type === "day")?.value || "15");
    if (Number.isFinite(today) && today >= 1) day = Math.min(today, lastDay);
  }

  return new Date(Date.UTC(py, pm - 1, day, 12, 0, 0)).toISOString();
}

/**
 * Put a client on the board for a period and every month after it. Covers both
 * a client the sweep skips (inactive, one-off) and one that was removed
 * earlier.
 *
 * Removal dismisses rather than deletes, so the row usually already exists.
 * On conflict this un-dismisses and returns it to Triage; DO NOTHING here would
 * leave the card dismissed and the add would silently fail.
 *
 * Months before the sweep point that the removal had been suppressing get a
 * dismissed row written for them first, so clearing the standing removal
 * doesn't quietly repopulate boards that were worked without this client.
 */
export function addBoardCard(clientId: string, period: string): boolean {
  const db = getDb();
  const client = listRevClients(true).find((c) => c.id === clientId);
  if (!client) return false;
  const ts = nowIso();
  const from = sweepFrom(period);
  const removal = getRemoval(clientId);

  const insert = db.prepare(
    `INSERT INTO lifecycle_board_cards
       (id, client_id, period, column_key, sort_order, notes, dismissed, created_at, updated_at)
     VALUES (?, ?, ?, 'triage', 0, '', ?, ?, ?)
     ON CONFLICT(client_id, period) DO NOTHING`
  );
  const undismiss = db.prepare(
    `INSERT INTO lifecycle_board_cards
       (id, client_id, period, column_key, sort_order, notes, dismissed, created_at, updated_at)
     VALUES (?, ?, ?, 'triage', 0, '', 0, ?, ?)
     ON CONFLICT(client_id, period) DO UPDATE SET
       dismissed = 0,
       column_key = CASE WHEN lifecycle_board_cards.dismissed = 1
                         THEN 'triage' ELSE lifecycle_board_cards.column_key END,
       updated_at = excluded.updated_at`
  );

  const run = db.transaction(() => {
    if (removal) {
      // Freeze the already-removed past: every month the removal covered that
      // sits before the sweep point keeps a dismissed row, apart from the one
      // being added right now.
      for (let p = removal.from_period, i = 0; p < from && i < MAX_GAP_MONTHS; p = shiftPeriod(p, 1), i++) {
        if (p === period) continue;
        insert.run(nanoid(12), clientId, p, 1, ts, ts);
      }
      db.prepare(`DELETE FROM lifecycle_board_removals WHERE client_id = ?`).run(clientId);
    }

    // The month being acted on, then every month from the sweep point forward
    // that already has a row. Later months with no row are handled by the
    // per-period seed now that the standing removal is gone.
    undismiss.run(nanoid(12), clientId, period, ts, ts);
    db.prepare(
      `UPDATE lifecycle_board_cards
          SET dismissed = 0,
              column_key = CASE WHEN dismissed = 1 THEN 'triage' ELSE column_key END,
              updated_at = ?
        WHERE client_id = ? AND period >= ? AND dismissed = 1`
    ).run(ts, clientId, from);
  });
  run();
  return true;
}

export function moveBoardCard(
  id: string,
  patch: { columnKey?: string; sortOrder?: number }
): boolean {
  const existing = getCardRow(id);
  if (!existing) return false;
  const columnKey = isColumnKey(patch.columnKey) ? patch.columnKey : existing.column_key;
  const sortOrder =
    typeof patch.sortOrder === "number" ? patch.sortOrder : existing.sort_order;
  getDb()
    .prepare(
      `UPDATE lifecycle_board_cards SET column_key = ?, sort_order = ?, updated_at = ? WHERE id = ?`
    )
    .run(columnKey, sortOrder, nowIso(), id);
  return true;
}

/**
 * After a Basecamp review nudge, slide this month's card from Sent for Approval
 * to Follow-Up Sent. Other columns are left alone — a follow-up should not yank
 * work out of QA or revisions.
 */
export function markClientFollowUpSent(clientId: string, period = currentPeriod()): boolean {
  const row = getDb()
    .prepare(
      `SELECT id, column_key FROM lifecycle_board_cards
        WHERE client_id = ? AND period = ? AND dismissed = 0`
    )
    .get(clientId, period) as { id: string; column_key: string } | undefined;
  if (!row) return false;
  if (row.column_key !== "sent_for_approval") return true;
  return moveBoardCard(row.id, { columnKey: "follow_up_sent" });
}

/**
 * Set the contracted monthly email volume from a board card. The value lives on
 * the client record, so it applies to every month rather than just this card's.
 */
export function setBoardCardQuota(id: string, quota: number): boolean {
  const card = getCardRow(id);
  if (!card) return false;
  return Boolean(
    updateRevClient(card.client_id, {
      monthlyEmailQuota: Math.max(0, Math.round(quota)),
    })
  );
}

/**
 * Remove a card from the board, this month and every month after it. Taking a
 * client off is a standing decision, so it carries forward instead of having to
 * be repeated on each month's board. Months already in the past keep whatever
 * they had — the one exception being the card actually clicked, so acting on an
 * old board still does the obvious thing.
 *
 * This dismisses rather than deletes: the board re-seeds a card for every
 * active client whenever it loads, so deleting the row would simply bring the
 * card back on the next refresh. The standing removal row covers later months
 * that have no row yet.
 */
export function deleteBoardCard(id: string): boolean {
  const card = getCardRow(id);
  if (!card) return false;
  const db = getDb();
  const ts = nowIso();
  const from = sweepFrom(card.period);

  const run = db.transaction(() => {
    db.prepare(`UPDATE lifecycle_board_cards SET dismissed = 1, updated_at = ? WHERE id = ?`)
      .run(ts, id);
    db.prepare(
      `UPDATE lifecycle_board_cards SET dismissed = 1, updated_at = ?
        WHERE client_id = ? AND period >= ?`
    ).run(ts, card.client_id, from);
    db.prepare(
      `INSERT INTO lifecycle_board_removals (client_id, from_period, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(client_id) DO UPDATE SET
         from_period = MIN(lifecycle_board_removals.from_period, excluded.from_period),
         updated_at = excluded.updated_at`
    ).run(card.client_id, from, ts, ts);
  });
  run();
  return true;
}
