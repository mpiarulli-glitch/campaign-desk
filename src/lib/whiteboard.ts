import { nanoid } from "nanoid";
import { getDb, nowIso, type WhiteboardBoard } from "./db";

export type { WhiteboardBoard };

// One tldraw record as it travels over the wire: the record id plus the record.
export interface WireRecord {
  id: string;
  data: unknown;
}

// Earlier iterations of this feature stored data in incompatible shapes (a whole
// "__doc__" snapshot row, and orphaned shape rows without their page). Those
// would poison the per-record loader, so wipe whiteboard_records exactly once
// when this version first runs. Board names are kept; boards just start empty.
let cleaned = false;
function ensureCleanSlate() {
  if (cleaned) return;
  const db = getDb();
  const row = db
    .prepare(`SELECT value FROM app_settings WHERE key = 'wb_records_reset_v5'`)
    .get() as { value: string } | undefined;
  if (!row) {
    db.prepare(`DELETE FROM whiteboard_records`).run();
    db.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('wb_records_reset_v5', '1', ?)
       ON CONFLICT (key) DO UPDATE SET value = '1', updated_at = excluded.updated_at`
    ).run(nowIso());
  }
  cleaned = true;
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

// All live records for a board — the initial client load.
export function getAllRecords(boardId: string): { records: WireRecord[]; now: string } {
  ensureCleanSlate();
  const now = nowIso();
  const rows = getDb()
    .prepare(
      `SELECT record_id, record_json FROM whiteboard_records
       WHERE board_id = ? AND deleted = 0`
    )
    .all(boardId) as Array<{ record_id: string; record_json: string }>;
  const records: WireRecord[] = [];
  for (const r of rows) {
    try {
      records.push({ id: r.record_id, data: JSON.parse(r.record_json) });
    } catch {
      /* skip a corrupt row rather than fail the whole load */
    }
  }
  return { records, now };
}

export interface ChangeSet {
  put: WireRecord[];
  remove: string[];
  now: string;
}

// Records changed after `sinceIso`. Deleted rows come back as removals.
export function getChangesSince(boardId: string, sinceIso: string): ChangeSet {
  ensureCleanSlate();
  const now = nowIso();
  const rows = getDb()
    .prepare(
      `SELECT record_id, record_json, deleted FROM whiteboard_records
       WHERE board_id = ? AND updated_at > ?`
    )
    .all(boardId, sinceIso) as Array<{
    record_id: string;
    record_json: string;
    deleted: number;
  }>;
  const put: WireRecord[] = [];
  const remove: string[] = [];
  for (const r of rows) {
    if (r.deleted) {
      remove.push(r.record_id);
    } else {
      try {
        put.push({ id: r.record_id, data: JSON.parse(r.record_json) });
      } catch {
        /* skip corrupt */
      }
    }
  }
  return { put, remove, now };
}

// Merge a client's own changed records into the board. Each client only ever
// writes the records it changed, so concurrent editors never overwrite each
// other's work.
export function applyChanges(
  boardId: string,
  changes: { put?: WireRecord[]; remove?: string[] }
): void {
  ensureCleanSlate();
  const db = getDb();
  const ts = nowIso();
  const put = (changes.put || []).filter(
    (r): r is WireRecord => !!r && typeof r.id === "string"
  );
  const remove = (changes.remove || []).filter(
    (x): x is string => typeof x === "string"
  );

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
    for (const rec of put) upsert.run(boardId, rec.id, JSON.stringify(rec.data), ts);
    for (const id of remove) tombstone.run(boardId, id, ts);
    touchBoard.run(ts, boardId);
  });
  run();
}
