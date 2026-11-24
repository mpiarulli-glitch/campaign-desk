import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

// The production database already had whiteboard_boards, without owner_slug,
// when private boards shipped. The schema blob indexes that column. This boots
// the real getDb() against that old table and checks the rest of the blob
// still runs, then the private-board rules.
test("an old whiteboard table boots cleanly and the private flow works", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-wb-boot-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  fs.mkdirSync(path.join(tmp, "data"));

  const raw = new Database(path.join(tmp, "data", "campaign-desk.db"));
  raw.exec(`
    CREATE TABLE whiteboard_folders (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled folder',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE whiteboard_boards (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Untitled board',
      folder_id TEXT,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE whiteboard_records (
      board_id TEXT NOT NULL,
      record_id TEXT NOT NULL,
      record_json TEXT NOT NULL DEFAULT '',
      deleted INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (board_id, record_id)
    );
  `);
  const insert = raw.prepare(
    `INSERT INTO whiteboard_boards (id, title, created_by, created_at, updated_at)
     VALUES (?, ?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
  );
  insert.run("roy-board", "Roy sketch", "Roy");
  insert.run("team-board", "Team sketch", "Team");
  insert.run("mystery", "Mystery", "Someone Else");
  raw
    .prepare(
      `INSERT INTO whiteboard_records (board_id, record_id, record_json, deleted, updated_at)
       VALUES ('roy-board', 'rect', ?, 0, '2026-01-01T00:00:00.000Z')`
    )
    .run(JSON.stringify({ id: "rect", type: "rectangle", x: 4, y: 8, version: 2 }));
  raw.close();

  const errors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map((part) => (part instanceof Error ? part.message : String(part))).join(" "));
  };

  const { closeDbForTests, getDb } = await import("../src/lib/db");
  const boards = await import("../src/lib/whiteboard");

  t.after(() => {
    console.error = originalError;
    closeDbForTests();
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const db = getDb();
  assert.equal(
    errors.some((line) => line.includes("Schema bootstrap failed")),
    false,
    errors.join("\n")
  );

  const cols = (db.prepare(`PRAGMA table_info(whiteboard_boards)`).all() as Array<{ name: string }>).map(
    (column) => column.name
  );
  assert.ok(cols.includes("owner_slug"));
  assert.ok(cols.includes("scene_json"));
  for (const name of [
    "whiteboard_members",
    "whiteboard_presence",
    "lifecycle_automations",
    "lifecycle_board_cards",
    "users",
    "social_batches",
    "personal_notes",
  ]) {
    const row = db.prepare(`SELECT name FROM sqlite_master WHERE name = ?`).get(name);
    assert.ok(row, `${name} was not created`);
  }
  assert.ok(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'idx_wb_boards_owner'`).get());

  const owners = Object.fromEntries(
    (db.prepare(`SELECT id, owner_slug FROM whiteboard_boards`).all() as Array<{
      id: string;
      owner_slug: string;
    }>).map((row) => [row.id, row.owner_slug])
  );
  assert.equal(owners["roy-board"], "roy");
  assert.equal(owners["team-board"], "");
  assert.equal(owners.mystery, "");

  const royView = boards.readBoard("roy-board", "roy");
  assert.equal(royView?.board.role, "owner");
  assert.equal(royView?.scene.elements[0]?.id, "rect");
  assert.equal(boards.readBoard("roy-board", "sylvia"), null);
  assert.equal(boards.readBoard("team-board", "roy"), null);
  assert.equal(boards.readBoard("mystery", "abel"), null);
  assert.equal(boards.listBoardsFor("roy").some((board) => board.id === "team-board"), false);

  const admin = boards.readBoard("team-board", "sylvia");
  assert.equal(admin?.board.role, "owner");
  assert.equal(boards.listBoardsFor("sylvia").some((board) => board.id === "team-board"), true);
  assert.equal(boards.listBoardsFor("sylvia").some((board) => board.id === "roy-board"), false);
  assert.equal(boards.listBoardsFor("michael").some((board) => board.id === "mystery"), true);

  assert.equal(boards.inviteMember("team-board", "sylvia", "roy", "editor").ok, true);
  assert.equal(boards.inviteMember("team-board", "sylvia", "jack", "viewer").ok, true);
  assert.equal(boards.listBoardsFor("roy").find((board) => board.id === "team-board")?.role, "editor");
  const saved = boards.saveScene("team-board", "roy", {
    elements: [{ id: "note", type: "text", version: 1, x: 1, y: 2, text: "from roy" }],
  });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.scene.elements.some((element) => element.id === "note"), true);
  assert.deepEqual(boards.saveScene("team-board", "jack", { elements: [{ id: "nope", version: 1 }] }), {
    ok: false,
    error: "forbidden",
  });
  assert.equal(boards.readBoard("team-board", "abel"), null);
  assert.equal(boards.deleteBoard("team-board", "roy").ok, false);

  closeDbForTests();
  errors.length = 0;
  const again = getDb();
  assert.equal(errors.some((line) => line.includes("Schema bootstrap failed")), false);
  assert.equal(boards.readBoard("roy-board", "roy")?.scene.elements[0]?.id, "rect");
  assert.equal(boards.readBoard("team-board", "jack")?.board.role, "viewer");
  assert.ok(again.prepare(`SELECT name FROM sqlite_master WHERE name = 'personal_notes'`).get());
});
