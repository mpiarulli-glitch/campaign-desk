import { nanoid } from "nanoid";
import { getDb, nowIso, type WhiteboardBoard } from "./db";

export type { WhiteboardBoard };

// Each board stores its whole tldraw document as a single snapshot row in
// whiteboard_records, keyed by this sentinel record id. Snapshot sync (rather
// than per-record diffing) keeps the document always self-consistent, so a
// loading client can never hit an orphaned record and crash the canvas.
const DOC_ID = "__doc__";

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

export interface BoardDoc {
  // Monotonic revision; bumped on every save so pollers know when to reload.
  rev: number;
  // Serialized tldraw document snapshot (JSON string), or "" for a new board.
  snapshot: string;
}

// Read the stored document + revision. The row wraps both in a small JSON
// envelope so we don't need a schema change to carry the revision.
export function getDoc(boardId: string): BoardDoc {
  const row = getDb()
    .prepare(
      `SELECT record_json FROM whiteboard_records
       WHERE board_id = ? AND record_id = ?`
    )
    .get(boardId, DOC_ID) as { record_json: string } | undefined;
  if (!row) return { rev: 0, snapshot: "" };
  try {
    const parsed = JSON.parse(row.record_json) as {
      rev?: number;
      snapshot?: string;
    };
    return {
      rev: typeof parsed.rev === "number" ? parsed.rev : 0,
      snapshot: typeof parsed.snapshot === "string" ? parsed.snapshot : "",
    };
  } catch {
    return { rev: 0, snapshot: "" };
  }
}

// Lightweight poll target: just the current revision.
export function getRev(boardId: string): number {
  return getDoc(boardId).rev;
}

// Store a new document snapshot, bumping the revision. Last write wins.
export function saveDoc(boardId: string, snapshot: string): number {
  const db = getDb();
  const rev = getDoc(boardId).rev + 1;
  const ts = nowIso();
  db.prepare(
    `INSERT INTO whiteboard_records (board_id, record_id, record_json, deleted, updated_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT (board_id, record_id)
     DO UPDATE SET record_json = excluded.record_json, updated_at = excluded.updated_at`
  ).run(boardId, DOC_ID, JSON.stringify({ rev, snapshot }), ts);
  db.prepare(`UPDATE whiteboard_boards SET updated_at = ? WHERE id = ?`).run(
    ts,
    boardId
  );
  return rev;
}
