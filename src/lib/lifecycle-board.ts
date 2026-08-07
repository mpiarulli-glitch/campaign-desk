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
} from "./db";
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

/** This month's key, e.g. "2026-08". */
export function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

export function isValidPeriod(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}$/.test(v);
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

/** Every active client gets a card for `period` the first time the board opens on it. */
function ensureCardsForPeriod(period: string): void {
  const db = getDb();
  const clients = listRevClients(false).filter((c) => c.active === 1);
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
      `SELECT c.id, c.title, c.client_id, c.status, c.updated_at, c.magic_token,
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
    updated_at: string;
    magic_token: string;
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
      updatedAt: r.updated_at,
      magicToken: r.magic_token,
      emailCount: r.email_count,
      smsCount: r.sms_count,
      delivered: true,
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

/** Adds a card for a client outside the normal active-client sweep (inactive client, one-off). */
export function addBoardCard(clientId: string, period: string): boolean {
  const db = getDb();
  const client = listRevClients(true).find((c) => c.id === clientId);
  if (!client) return false;
  const ts = nowIso();
  db.prepare(
    `INSERT INTO lifecycle_board_cards
       (id, client_id, period, column_key, sort_order, notes, created_at, updated_at)
     VALUES (?, ?, ?, 'triage', 0, '', ?, ?)
     ON CONFLICT(client_id, period) DO NOTHING`
  ).run(nanoid(12), clientId, period, ts, ts);
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
 * Remove a card from the board. This dismisses rather than deletes: the board
 * re-seeds a card for every active client whenever it loads, so deleting the
 * row would simply bring the card back on the next refresh.
 */
export function deleteBoardCard(id: string): boolean {
  return (
    getDb()
      .prepare(
        `UPDATE lifecycle_board_cards SET dismissed = 1, updated_at = ? WHERE id = ?`
      )
      .run(nowIso(), id).changes > 0
  );
}
