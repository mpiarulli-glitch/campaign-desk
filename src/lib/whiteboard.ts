import { nanoid } from "nanoid";
import {
  getDb,
  nowIso,
  type WhiteboardBoard,
  type WhiteboardRecord,
} from "./db";

export type { WhiteboardBoard, WhiteboardRecord };

// A single tldraw record as it travels over the wire. `id` is the tldraw
// record id (e.g. "shape:abc"); the rest of the record lives in `data`.
export interface WireRecord {
  id: string;
  data: unknown;
}

export function listBoards(): WhiteboardBoard[] {
  return getDb()
    .prepare(`SELECT * FROM whiteboard_boards ORDER BY updated_at DESC`)
    .all() as WhiteboardBoard[];
}

export function getBoard(id: string): WhiteboardBoard | undefined {
  return getDb()
    .prepare(`SELECT * FROM whiteboard_boards WHERE id = ?`)
    .get(id) as WhiteboardBoard | undefined;
}

export function createBoard(input: {
  title?: string;
  createdBy?: string;
}): WhiteboardBoard {
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  db.prepare(
    `INSERT INTO whiteboard_boards (id, title, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    id,
    (input.title || "").trim() || "Untitled board",
    (input.createdBy || "").trim(),
    ts,
    ts
  );
  return getBoard(id)!;
}

// All live (non-deleted) records for a board — used for the initial client load.
export function getAllRecords(boardId: string): WireRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT record_id, record_json FROM whiteboard_records
       WHERE board_id = ? AND deleted = 0`
    )
    .all(boardId) as Array<Pick<WhiteboardRecord, "record_id" | "record_json">>;
  return rows.map((r) => ({ id: r.record_id, data: JSON.parse(r.record_json) }));
}

export interface ChangeSet {
  // Records added or updated since the caller's `since` timestamp.
  put: WireRecord[];
  // Record ids that were removed since `since`.
  remove: string[];
  // Server clock at read time — the caller passes this back as its next `since`.
  now: string;
}

// Records changed strictly after `sinceIso`. Deleted rows come back as removals
// so pollers learn about deletions through the same call.
export function getChangesSince(boardId: string, sinceIso: string): ChangeSet {
  const now = nowIso();
  const rows = getDb()
    .prepare(
      `SELECT record_id, record_json, deleted FROM whiteboard_records
       WHERE board_id = ? AND updated_at > ?`
    )
    .all(boardId, sinceIso) as Array<
    Pick<WhiteboardRecord, "record_id" | "record_json" | "deleted">
  >;
  const put: WireRecord[] = [];
  const remove: string[] = [];
  for (const r of rows) {
    if (r.deleted) remove.push(r.record_id);
    else put.push({ id: r.record_id, data: JSON.parse(r.record_json) });
  }
  return { put, remove, now };
}

// Upsert changed records and tombstone removed ones. Runs in a transaction and
// bumps the board's updated_at so the board list re-sorts to the top.
export function applyChanges(
  boardId: string,
  changes: { put?: WireRecord[]; remove?: string[] }
): void {
  const db = getDb();
  const ts = nowIso();
  const put = changes.put || [];
  const remove = changes.remove || [];

  const upsert = db.prepare(
    `INSERT INTO whiteboard_records (board_id, record_id, record_json, deleted, updated_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT (board_id, record_id)
     DO UPDATE SET record_json = excluded.record_json, deleted = 0, updated_at = excluded.updated_at`
  );
  const tombstone = db.prepare(
    `INSERT INTO whiteboard_records (board_id, record_id, record_json, deleted, updated_at)
     VALUES (?, ?, '', 1, ?)
     ON CONFLICT (board_id, record_id)
     DO UPDATE SET deleted = 1, updated_at = excluded.updated_at`
  );
  const touchBoard = db.prepare(
    `UPDATE whiteboard_boards SET updated_at = ? WHERE id = ?`
  );

  const run = db.transaction(() => {
    for (const rec of put) {
      upsert.run(boardId, rec.id, JSON.stringify(rec.data), ts);
    }
    for (const id of remove) {
      tombstone.run(boardId, id, ts);
    }
    touchBoard.run(ts, boardId);
  });
  run();
}
