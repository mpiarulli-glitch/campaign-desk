import type Database from "better-sqlite3";
import { ADMIN_PEOPLE } from "./admin-people";
import { OWNER_SLUG, PEOPLE } from "./people";

const BACKFILL_KEY = "wb_private_scene_v1";

/**
 * Private boards + one scene JSON document per board.
 *
 * Existing databases already have whiteboard_boards from the shared-canvas
 * version, so CREATE TABLE in the bootstrap is a no-op for them. New columns,
 * the member and presence tables, and the one-time copy of per-element rows
 * into scene_json live here, next to the other ALTER migrations.
 */
export function ensureWhiteboardSharingSchema(database: Database.Database): void {
  const cols = tableColumns(database, "whiteboard_boards");
  if (!cols.length) return;

  if (!cols.includes("owner_slug")) {
    database.exec(
      `ALTER TABLE whiteboard_boards ADD COLUMN owner_slug TEXT NOT NULL DEFAULT ''`
    );
  }
  if (!cols.includes("scene_json")) {
    database.exec(
      `ALTER TABLE whiteboard_boards ADD COLUMN scene_json TEXT NOT NULL DEFAULT ''`
    );
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS whiteboard_members (
      board_id TEXT NOT NULL,
      user_slug TEXT NOT NULL,
      role TEXT NOT NULL,
      seen_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (board_id, user_slug),
      FOREIGN KEY (board_id) REFERENCES whiteboard_boards(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_wb_members_user ON whiteboard_members(user_slug);

    CREATE TABLE IF NOT EXISTS whiteboard_presence (
      board_id TEXT NOT NULL,
      user_slug TEXT NOT NULL,
      seen_at TEXT NOT NULL,
      PRIMARY KEY (board_id, user_slug),
      FOREIGN KEY (board_id) REFERENCES whiteboard_boards(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_wb_boards_owner ON whiteboard_boards(owner_slug);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
  `);

  const done = database
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(BACKFILL_KEY) as { value: string } | undefined;
  if (done?.value) return;

  const boards = database
    .prepare(`SELECT id, created_by, owner_slug, scene_json FROM whiteboard_boards`)
    .all() as Array<{
    id: string;
    created_by: string;
    owner_slug: string;
    scene_json: string;
  }>;

  const setOwner = database.prepare(
    `UPDATE whiteboard_boards SET owner_slug = ? WHERE id = ? AND owner_slug = ''`
  );
  const setScene = database.prepare(
    `UPDATE whiteboard_boards SET scene_json = ? WHERE id = ? AND (scene_json IS NULL OR scene_json = '')`
  );

  const recordCols = tableColumns(database, "whiteboard_records");
  const canReadRecords =
    recordCols.includes("board_id") &&
    recordCols.includes("record_json") &&
    recordCols.includes("deleted");

  const readRecords = canReadRecords
    ? database.prepare(
        `SELECT record_json FROM whiteboard_records
          WHERE board_id = ? AND deleted = 0
          ORDER BY updated_at ASC`
      )
    : null;

  const apply = database.transaction(() => {
    for (const board of boards) {
      if (!board.owner_slug) {
        setOwner.run(legacyOwnerSlug(board.created_by), board.id);
      }
      if (!board.scene_json && readRecords) {
        const rows = readRecords.all(board.id) as Array<{ record_json: string }>;
        const elements = rows
          .map((row) => parseExcalidrawElement(row.record_json))
          .filter((el): el is Record<string, unknown> => !!el);
        if (elements.length) {
          setScene.run(JSON.stringify({ elements, files: {} }), board.id);
        }
      }
    }
    const stamp = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, '1', ?)
         ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = excluded.updated_at`
      )
      .run(BACKFILL_KEY, stamp);
  });
  apply();
}

/**
 * Who keeps a board that existed before boards were private.
 *
 * created_by was a display name ("Roy", "Lana Verrecchio") or the fallback
 * "Team" when the session had no person. A matched name becomes that person's
 * private board. Anything we cannot match stays with the owner so the drawing
 * is not orphaned.
 */
export function legacyOwnerSlug(createdBy: string): string {
  const value = createdBy.trim().toLowerCase();
  if (!value || value === "team") return OWNER_SLUG;
  const people = [...PEOPLE, ...ADMIN_PEOPLE];
  for (const person of people) {
    if (person.slug === value || person.label.toLowerCase() === value) {
      return person.slug;
    }
  }
  return OWNER_SLUG;
}

function parseExcalidrawElement(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (typeof value.id !== "string" || typeof value.type !== "string") return null;
    if (typeof value.version !== "number" || !Number.isFinite(value.version)) return null;
    if (typeof value.x !== "number" || typeof value.y !== "number") return null;
    return value;
  } catch {
    return null;
  }
}

function tableColumns(database: Database.Database, table: string): string[] {
  const exists = database
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table);
  if (!exists) return [];
  return (
    database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  ).map((column) => column.name);
}
