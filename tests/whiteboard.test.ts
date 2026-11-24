import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  ensureWhiteboardSharingSchema,
  legacyOwnerSlug,
} from "../src/lib/whiteboard-migrate";

function shape(
  id: string,
  version: number,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return { id, type: "rectangle", x: 10, y: 20, version, ...extra };
}

function png(id: string, dataURL = "data:image/png;base64,aaaa"): Record<string, unknown> {
  return { id, mimeType: "image/png", dataURL, created: 1 };
}

test("legacy boards become private and keep excalidraw elements", () => {
  assert.equal(legacyOwnerSlug("Roy"), "roy");
  assert.equal(legacyOwnerSlug("Lana Verrecchio"), "lana");
  assert.equal(legacyOwnerSlug("Michael"), "michael");
  assert.equal(legacyOwnerSlug("Team"), null);
  assert.equal(legacyOwnerSlug(""), null);
  assert.equal(legacyOwnerSlug("not a person"), null);

  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE whiteboard_boards (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
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
  db.prepare(
    `INSERT INTO whiteboard_boards (id, title, created_by, created_at, updated_at)
     VALUES ('b1', 'Old', 'Roy', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
  ).run();
  db.prepare(
    `INSERT INTO whiteboard_records (board_id, record_id, record_json, deleted, updated_at)
     VALUES ('b1', 'rect', ?, 0, '2026-01-01T00:00:00.000Z')`
  ).run(JSON.stringify(shape("rect", 3, { strokeColor: "#000" })));
  db.prepare(
    `INSERT INTO whiteboard_records (board_id, record_id, record_json, deleted, updated_at)
     VALUES ('b1', 'junk', ?, 0, '2026-01-02T00:00:00.000Z')`
  ).run(JSON.stringify({ id: "shape:1", typeName: "shape" }));

  ensureWhiteboardSharingSchema(db);
  const row = db.prepare(`SELECT owner_slug, scene_json FROM whiteboard_boards WHERE id = 'b1'`).get() as {
    owner_slug: string;
    scene_json: string;
  };
  assert.equal(row.owner_slug, "roy");
  const scene = JSON.parse(row.scene_json) as { elements: Array<{ id: string }> };
  assert.deepEqual(scene.elements.map((element) => element.id), ["rect"]);

  db.prepare(`UPDATE whiteboard_boards SET owner_slug = 'jack' WHERE id = 'b1'`).run();
  ensureWhiteboardSharingSchema(db);
  const again = db.prepare(`SELECT owner_slug FROM whiteboard_boards WHERE id = 'b1'`).get() as {
    owner_slug: string;
  };
  assert.equal(again.owner_slug, "jack");
  db.close();
});

test("boards the first backfill parked on the owner account are unowned again", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE whiteboard_boards (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT '',
      owner_slug TEXT NOT NULL DEFAULT '',
      scene_json TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('wb_private_scene_v1', '1', '2026-01-01T00:00:00.000Z');
  `);
  const insert = db.prepare(
    `INSERT INTO whiteboard_boards
      (id, title, created_by, owner_slug, scene_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, '', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
  );
  insert.run("team", "Shared sketch", "Team", "michael");
  insert.run("mystery", "No name", "Someone Else", "michael");
  insert.run("mine", "Michael's", "Michael", "michael");
  insert.run("roys", "Roy's", "Roy", "roy");

  ensureWhiteboardSharingSchema(db);

  const owners = Object.fromEntries(
    (db.prepare(`SELECT id, owner_slug FROM whiteboard_boards`).all() as Array<{
      id: string;
      owner_slug: string;
    }>).map((row) => [row.id, row.owner_slug])
  );
  assert.equal(owners.team, "");
  assert.equal(owners.mystery, "");
  assert.equal(owners.mine, "michael");
  assert.equal(owners.roys, "roy");

  db.prepare(`UPDATE whiteboard_boards SET owner_slug = 'michael' WHERE id = 'team'`).run();
  ensureWhiteboardSharingSchema(db);
  const again = db.prepare(`SELECT owner_slug FROM whiteboard_boards WHERE id = 'team'`).get() as {
    owner_slug: string;
  };
  assert.equal(again.owner_slug, "michael");
  db.close();
});

test("whiteboard access and scene merge", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-wb-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const { closeDbForTests, getDb } = await import("../src/lib/db");
  const boards = await import("../src/lib/whiteboard");

  t.after(() => {
    closeDbForTests();
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await t.test("a new board is visible only to its owner", () => {
    const board = boards.createBoard({ title: "  Launch plan  ", ownerSlug: "michael" });
    assert.equal(board.title, "Launch plan");
    assert.equal(board.owner_slug, "michael");

    const mine = boards.listBoardsFor("michael");
    assert.equal(mine.length, 1);
    assert.equal(mine[0].role, "owner");
    assert.equal(mine[0].unseen, false);
    assert.equal(boards.listBoardsFor("roy").length, 0);
    assert.equal(boards.readBoard(board.id, "roy"), null);
    assert.equal(boards.readBoard(board.id, "abel"), null);
    assert.equal(boards.changesSince(board.id, "abel", null), null);
    assert.deepEqual(boards.saveScene(board.id, "abel", { elements: [shape("x", 1)] }), {
      ok: false,
      error: "not_found",
    });
    assert.equal(boards.readBoard(board.id, "michael")?.scene.elements.length, 0);
  });

  await t.test("the owner can share editor and viewer, and strangers stay at not-found", () => {
    const board = boards.createBoard({ title: "Shared", ownerSlug: "michael" });
    assert.deepEqual(boards.inviteMember(board.id, "roy", "jack", "editor"), {
      ok: false,
      error: "not_found",
    });
    assert.deepEqual(boards.inviteMember(board.id, "michael", "nobody", "editor"), {
      ok: false,
      error: "invalid",
    });
    assert.deepEqual(boards.inviteMember(board.id, "michael", "michael", "editor"), {
      ok: false,
      error: "invalid",
    });
    assert.equal(boards.inviteMember(board.id, "michael", "roy", "editor").ok, true);
    assert.equal(boards.inviteMember(board.id, "michael", "jack", "viewer").ok, true);

    const roy = boards.listBoardsFor("roy").find((item) => item.id === board.id);
    const jack = boards.listBoardsFor("jack").find((item) => item.id === board.id);
    assert.equal(roy?.role, "editor");
    assert.equal(roy?.unseen, true);
    assert.equal(jack?.role, "viewer");
    assert.equal(jack?.unseen, true);
    assert.equal(boards.listBoardsFor("abel").some((item) => item.id === board.id), false);

    assert.equal(boards.readBoard(board.id, "roy")?.board.role, "editor");
    assert.equal(boards.listBoardsFor("roy").find((item) => item.id === board.id)?.unseen, false);

    assert.deepEqual(boards.renameBoard(board.id, "roy", "Stolen"), { ok: false, error: "forbidden" });
    assert.deepEqual(boards.deleteBoard(board.id, "jack"), { ok: false, error: "forbidden" });
    assert.deepEqual(boards.inviteMember(board.id, "roy", "abel", "viewer"), {
      ok: false,
      error: "forbidden",
    });
    assert.equal(boards.readBoard(board.id, "michael")?.board.title, "Shared");
  });

  await t.test("saves merge by element version and do not clobber a concurrent edit", () => {
    const board = boards.createBoard({ title: "Merge", ownerSlug: "michael" });
    boards.inviteMember(board.id, "michael", "roy", "editor");
    boards.inviteMember(board.id, "michael", "jack", "viewer");

    const mine = shape("a", 1, { text: "michael", updated: 10 });
    const theirs = shape("b", 1, { text: "roy", updated: 10 });
    const first = boards.saveScene(board.id, "michael", { elements: [mine], files: { f1: png("f1") } });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const second = boards.saveScene(board.id, "roy", {
      elements: [shape("a", 1, { text: "stale michael", updated: 1 }), theirs],
      files: { f2: png("f2", "data:image/png;base64,bbbb") },
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;

    const byId = new Map(second.scene.elements.map((element) => [element.id, element]));
    assert.equal(byId.get("a")?.text, "michael");
    assert.equal(byId.get("b")?.text, "roy");
    assert.equal(second.scene.files.f1?.dataURL, "data:image/png;base64,aaaa");
    assert.equal(second.scene.files.f2?.dataURL, "data:image/png;base64,bbbb");

    const newer = boards.saveScene(board.id, "michael", {
      elements: [shape("a", 2, { text: "rewritten", updated: 30, isDeleted: false })],
    });
    assert.equal(newer.ok, true);
    if (!newer.ok) return;
    assert.equal(newer.scene.elements.find((element) => element.id === "a")?.text, "rewritten");
    assert.equal(newer.scene.elements.some((element) => element.id === "b"), true);
    assert.ok(newer.scene.files.f1);

    const tombstone = boards.saveScene(board.id, "roy", {
      elements: [shape("b", 4, { isDeleted: true, updated: 40 })],
    });
    assert.equal(tombstone.ok, true);
    if (!tombstone.ok) return;
    assert.equal(tombstone.scene.elements.find((element) => element.id === "b")?.isDeleted, true);

    const resurrect = boards.saveScene(board.id, "michael", {
      elements: [shape("b", 2, { isDeleted: false, text: "back", updated: 99 })],
    });
    assert.equal(resurrect.ok, true);
    if (!resurrect.ok) return;
    assert.equal(resurrect.scene.elements.find((element) => element.id === "b")?.isDeleted, true);

    const sameVersion = boards.saveScene(board.id, "roy", {
      elements: [shape("a", 2, { text: "later clock", updated: 50 })],
    });
    assert.equal(sameVersion.ok, true);
    if (!sameVersion.ok) return;
    assert.equal(sameVersion.scene.elements.find((element) => element.id === "a")?.text, "later clock");

    assert.deepEqual(
      boards.saveScene(board.id, "jack", { elements: [shape("c", 1, { text: "nope" })] }),
      { ok: false, error: "forbidden" }
    );
    assert.equal(
      boards.readBoard(board.id, "michael")?.scene.elements.some((element) => element.id === "c"),
      false
    );

    const since = boards.changesSince(board.id, "jack", first.updatedAt);
    assert.ok(since);
    assert.equal(since?.full, true);
    assert.ok(since && since.scene.elements.length >= 2);
    const quiet = boards.changesSince(board.id, "roy", sameVersion.updatedAt);
    assert.equal(quiet?.full, false);
    assert.equal(quiet?.scene.elements.length, 0);

    const stored = getDb()
      .prepare(`SELECT scene_json FROM whiteboard_boards WHERE id = ?`)
      .get(board.id) as { scene_json: string };
    assert.equal(JSON.parse(stored.scene_json).elements.length, sameVersion.scene.elements.length);
  });

  await t.test("removing someone or changing their role takes effect on the next call", () => {
    const board = boards.createBoard({ title: "Roles", ownerSlug: "michael" });
    boards.inviteMember(board.id, "michael", "jack", "viewer");
    assert.equal(boards.setMemberRole(board.id, "michael", "jack", "editor").ok, true);
    assert.equal(
      boards.saveScene(board.id, "jack", { elements: [shape("j", 1)] }).ok,
      true
    );
    assert.equal(boards.removeMember(board.id, "michael", "jack").ok, true);
    assert.equal(boards.readBoard(board.id, "jack"), null);
    assert.deepEqual(boards.saveScene(board.id, "jack", { elements: [shape("j", 2)] }), {
      ok: false,
      error: "not_found",
    });
    assert.equal(boards.deleteBoard(board.id, "michael").ok, true);
    assert.equal(boards.readBoard(board.id, "michael"), null);
  });

  await t.test("viewers currently on the board show up, and stale ones drop off", () => {
    const board = boards.createBoard({ title: "Live", ownerSlug: "michael" });
    boards.inviteMember(board.id, "michael", "roy", "editor");
    const opened = boards.readBoard(board.id, "michael");
    assert.deepEqual(
      opened?.viewers.map((viewer) => viewer.slug),
      ["michael"]
    );
    const both = boards.readBoard(board.id, "roy");
    assert.deepEqual(
      both?.viewers.map((viewer) => viewer.slug).sort(),
      ["michael", "roy"]
    );
    getDb()
      .prepare(`UPDATE whiteboard_presence SET seen_at = ? WHERE board_id = ? AND user_slug = ?`)
      .run("2000-01-01T00:00:00.000Z", board.id, "michael");
    const left = boards.readBoard(board.id, "roy");
    assert.deepEqual(
      left?.viewers.map((viewer) => viewer.slug),
      ["roy"]
    );
  });

  await t.test("authorize matches the route matrix", () => {
    assert.equal(boards.authorize(null, "read"), "not_found");
    assert.equal(boards.authorize(null, "save"), "not_found");
    assert.equal(boards.authorize(null, "delete"), "not_found");
    assert.equal(boards.authorize("viewer", "read"), "ok");
    assert.equal(boards.authorize("viewer", "presence"), "ok");
    assert.equal(boards.authorize("viewer", "save"), "forbidden");
    assert.equal(boards.authorize("viewer", "share"), "forbidden");
    assert.equal(boards.authorize("viewer", "rename"), "forbidden");
    assert.equal(boards.authorize("viewer", "delete"), "forbidden");
    assert.equal(boards.authorize("editor", "save"), "ok");
    assert.equal(boards.authorize("editor", "delete"), "forbidden");
    assert.equal(boards.authorize("editor", "share"), "forbidden");
    assert.equal(boards.authorize("owner", "delete"), "ok");
    assert.equal(boards.authorize("owner", "share"), "ok");
    assert.equal(boards.authorize("owner", "rename"), "ok");
    assert.throws(() => boards.createBoard({ ownerSlug: "" }));
  });
});
