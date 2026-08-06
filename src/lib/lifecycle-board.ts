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
  type LifecycleBoardItem,
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
  /** Whether this campaign's emails count toward the month's quota yet. */
  delivered: boolean;
}

export interface BoardManualItem {
  id: string;
  label: string;
  done: boolean;
  sortOrder: number;
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
  notes: string;
  campaigns: BoardCampaignItem[];
  manualItems: BoardManualItem[];
  /** Emails per month this client is contracted for. 0 means none on file. */
  quota: number;
  /** Emails delivered against that quota this month. */
  delivered: number;
  updatedAt: string;
}

function suggestColumn(campaigns: BoardCampaignItem[]): BoardColumnKey {
  if (campaigns.length === 0) return "next_up";
  if (campaigns.some((c) => c.status === "needs_changes")) return "needs_revisions";
  if (campaigns.some((c) => c.status === "in_review")) return "sent_for_approval";
  if (campaigns.some((c) => c.status === "draft")) return "qa";
  if (campaigns.every((c) => c.status === "sent")) return "deliverables_met";
  if (campaigns.every((c) => c.status === "scheduled" || c.status === "sent")) return "scheduling";
  return "completed";
}

function toBoardCard(
  row: LifecycleBoardCard,
  clientName: string,
  quota: number,
  campaigns: BoardCampaignItem[],
  items: LifecycleBoardItem[]
): BoardCard {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName,
    period: row.period,
    columnKey: row.column_key,
    suggestedColumnKey: suggestColumn(campaigns),
    sortOrder: row.sort_order,
    notes: row.notes,
    campaigns: [...campaigns].sort((a, b) => a.title.localeCompare(b.title)),
    manualItems: [...items]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({ id: i.id, label: i.label, done: i.done === 1, sortOrder: i.sort_order })),
    quota,
    delivered: campaigns.reduce((n, c) => n + (c.delivered ? c.emailCount : 0), 0),
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
    .prepare(`SELECT * FROM lifecycle_board_cards WHERE period = ?`)
    .all(period) as LifecycleBoardCard[];
  if (!cardRows.length) return [];

  const allClients = listRevClients(true);
  const clientNames = new Map(allClients.map((c) => [c.id, c.name]));
  const clientQuotas = new Map(allClients.map((c) => [c.id, c.monthly_email_quota ?? 0]));

  // email_count comes from campaign_emails: a campaign is a review package and
  // routinely bundles several emails, so counting campaign rows would under-
  // report a client's delivered volume against a contract written in emails.
  const campaignRows = db
    .prepare(
      `SELECT c.id, c.title, c.client_id, c.status, c.updated_at, c.magic_token,
              (SELECT COUNT(*) FROM campaign_emails e WHERE e.campaign_id = c.id) AS email_count
         FROM campaigns c
        WHERE c.archived_at IS NULL AND c.client_id IS NOT NULL
          AND strftime('%Y-%m', c.created_at) = ?`
    )
    .all(period) as Array<{
    id: string;
    title: string;
    client_id: string;
    status: CampaignStatus;
    updated_at: string;
    magic_token: string;
    email_count: number;
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
      // A campaign with no emails attached yet still represents one planned
      // send, so it never counts as zero.
      emailCount: Math.max(1, r.email_count),
      delivered: DELIVERED_STATUSES.includes(r.status),
    });
    campaignsByClient.set(r.client_id, list);
  }

  const cardIds = cardRows.map((c) => c.id);
  const itemsByCard = new Map<string, LifecycleBoardItem[]>();
  if (cardIds.length) {
    const placeholders = cardIds.map(() => "?").join(",");
    const itemRows = db
      .prepare(`SELECT * FROM lifecycle_board_items WHERE card_id IN (${placeholders})`)
      .all(...cardIds) as LifecycleBoardItem[];
    for (const r of itemRows) {
      const list = itemsByCard.get(r.card_id) ?? [];
      list.push(r);
      itemsByCard.set(r.card_id, list);
    }
  }

  return cardRows
    .map((row) => {
      const clientName = clientNames.get(row.client_id);
      if (!clientName) return null;
      return toBoardCard(
        row,
        clientName,
        clientQuotas.get(row.client_id) ?? 0,
        campaignsByClient.get(row.client_id) ?? [],
        itemsByCard.get(row.id) ?? []
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

export function updateBoardCardNotes(id: string, notes: string): boolean {
  if (!getCardRow(id)) return false;
  getDb()
    .prepare(`UPDATE lifecycle_board_cards SET notes = ?, updated_at = ? WHERE id = ?`)
    .run(notes.trim(), nowIso(), id);
  return true;
}

export function deleteBoardCard(id: string): boolean {
  return getDb().prepare(`DELETE FROM lifecycle_board_cards WHERE id = ?`).run(id).changes > 0;
}

/* ------------------------------------------------------------- manual items */

export function addBoardItem(cardId: string, label: string): BoardManualItem | null {
  if (!label.trim() || !getCardRow(cardId)) return null;
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  const { n } = db
    .prepare(`SELECT COUNT(*) AS n FROM lifecycle_board_items WHERE card_id = ?`)
    .get(cardId) as { n: number };
  db.prepare(
    `INSERT INTO lifecycle_board_items (id, card_id, label, done, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?, ?)`
  ).run(id, cardId, label.trim(), n, ts, ts);
  return { id, label: label.trim(), done: false, sortOrder: n };
}

export function updateBoardItem(
  id: string,
  patch: { label?: string; done?: boolean }
): boolean {
  const db = getDb();
  const existing = db
    .prepare(`SELECT * FROM lifecycle_board_items WHERE id = ?`)
    .get(id) as LifecycleBoardItem | undefined;
  if (!existing) return false;
  db.prepare(
    `UPDATE lifecycle_board_items SET label = ?, done = ?, updated_at = ? WHERE id = ?`
  ).run(
    patch.label !== undefined ? patch.label.trim() : existing.label,
    patch.done !== undefined ? (patch.done ? 1 : 0) : existing.done,
    nowIso(),
    id
  );
  return true;
}

export function deleteBoardItem(id: string): boolean {
  return getDb().prepare(`DELETE FROM lifecycle_board_items WHERE id = ?`).run(id).changes > 0;
}
