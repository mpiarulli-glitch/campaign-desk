// One place that decides which clients are still working with the agency.
//
// Lists, pickers, counts, and jobs should call activeClients() or add
// activeClientSql() to a query. A lookup by id (getRevClient, a share token,
// a direct admin URL) still returns an archived row so the page can open.
// Unarchive puts the same row back; nothing is deleted.

import { getDb, nowIso, type RevClient } from "./db";

export type ClientListOptions = {
  /** Include clients marked inactive. Archived clients stay out unless includeArchived. */
  includeInactive?: boolean;
  /** Identity checks that must not create a second row for someone already archived. */
  includeArchived?: boolean;
  /** The archive list only. */
  archivedOnly?: boolean;
};

/** SQL predicate: this client row is not archived. */
export function activeClientSql(alias = ""): string {
  const col = alias ? `${alias}.archived_at` : "archived_at";
  return `${col} IS NULL`;
}

/**
 * A campaign, send, or other row is not tied to an archived client.
 * A row with no client stays visible. Match on id when one is stored,
 * otherwise on the exact client name.
 */
export function rowOmitsArchivedClient(idExpr: string, nameExpr: string): string {
  return `NOT EXISTS (
    SELECT 1 FROM rev_clients AS _archived_client
    WHERE _archived_client.archived_at IS NOT NULL
      AND (
        (TRIM(IFNULL(${idExpr}, '')) != '' AND _archived_client.id = ${idExpr})
        OR (
          TRIM(IFNULL(${idExpr}, '')) = ''
          AND TRIM(IFNULL(${nameExpr}, '')) != ''
          AND LOWER(TRIM(_archived_client.name)) = LOWER(TRIM(${nameExpr}))
        )
      )
  )`;
}

export function isArchivedClient(
  client: { archived_at?: string | null } | null | undefined
): boolean {
  return Boolean(client?.archived_at);
}

export function queryClients(opts: ClientListOptions = {}): RevClient[] {
  const where: string[] = [];
  if (opts.archivedOnly) where.push("archived_at IS NOT NULL");
  else if (!opts.includeArchived) where.push(activeClientSql());
  if (!opts.includeInactive) where.push("active = 1");
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const order = opts.archivedOnly
    ? "ORDER BY archived_at DESC, name COLLATE NOCASE"
    : "ORDER BY name COLLATE NOCASE";
  return getDb().prepare(`SELECT * FROM rev_clients ${clause} ${order}`).all() as RevClient[];
}

/** Clients who are still with the agency. This is the default list. */
export function activeClients(includeInactive = false): RevClient[] {
  return queryClients({ includeInactive, includeArchived: false });
}

export function listArchivedClients(): RevClient[] {
  return queryClients({ includeInactive: true, archivedOnly: true });
}

export function hiddenClientKeys(): { ids: Set<string>; names: Set<string> } {
  const rows = getDb()
    .prepare(
      `SELECT id, name FROM rev_clients WHERE archived_at IS NOT NULL`
    )
    .all() as Array<{ id: string; name: string }>;
  return {
    ids: new Set(rows.map((row) => row.id)),
    names: new Set(
      rows.map((row) => row.name.trim().toLowerCase()).filter(Boolean)
    ),
  };
}

/** False when this id or (when the id is blank) this name is an archived client. */
export function recordShowsClient(
  clientId: string | null | undefined,
  clientName: string | null | undefined,
  hidden = hiddenClientKeys()
): boolean {
  const id = (clientId || "").trim();
  if (id && hidden.ids.has(id)) return false;
  if (!id) {
    const name = (clientName || "").trim().toLowerCase();
    if (name && hidden.names.has(name)) return false;
  }
  return true;
}

function readClient(id: string): RevClient | null {
  return (
    (getDb().prepare(`SELECT * FROM rev_clients WHERE id = ?`).get(id) as
      | RevClient
      | undefined) || null
  );
}

/** Hide the client everywhere active lists look. The row and its history stay. */
export function archiveClient(id: string, archivedBy: string): RevClient | null {
  const existing = readClient(id);
  if (!existing) return null;
  if (existing.archived_at) return existing;
  const ts = nowIso();
  getDb()
    .prepare(
      `UPDATE rev_clients
          SET archived_at = ?, archived_by = ?, updated_at = ?
        WHERE id = ?`
    )
    .run(ts, (archivedBy || "").trim(), ts, id);
  return readClient(id);
}

/** Put the client back on active lists. No other column is changed. */
export function unarchiveClient(id: string): RevClient | null {
  const existing = readClient(id);
  if (!existing) return null;
  if (!existing.archived_at) return existing;
  const ts = nowIso();
  getDb()
    .prepare(
      `UPDATE rev_clients
          SET archived_at = NULL, archived_by = '', updated_at = ?
        WHERE id = ?`
    )
    .run(ts, id);
  return readClient(id);
}
