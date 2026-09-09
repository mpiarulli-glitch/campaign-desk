import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("an expired extra ask closes when they book a later day", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-extra-req-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const extras = await import("../src/lib/extra-requests");
  const { getDb, nowIso } = await import("../src/lib/db");
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO rev_clients (id, name, active, monthly_email_quota, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?)`
    )
    .run("c1", "Test Co", 4, now, now);

  const created = extras.createExtraRequest({
    clientId: "c1",
    windowStart: "2026-08-10",
    windowEnd: "2026-08-14",
  });
  assert.equal(extras.listOpenExtraRequests("c1").length, 1);

  extras.fulfillMatchingExtraRequest("c1", "2026-08-20", "send-1");
  assert.equal(extras.listOpenExtraRequests("c1").length, 1);

  extras.fulfillExpiredOpenExtraRequest("c1", "2026-08-18", "send-1");
  assert.equal(extras.listOpenExtraRequests("c1").length, 0);
  const closed = extras.getExtraRequest(created.id);
  assert.equal(closed?.fulfilled_send_id, "send-1");
});

test("a live database missing extra-request columns still opens a window", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-extra-mig-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  fs.mkdirSync("data");

  const Database = (await import("better-sqlite3")).default;
  const raw = new Database(path.join("data", "campaign-desk.db"));
  raw.exec(`
    CREATE TABLE extra_production_requests (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      window_start TEXT NOT NULL,
      window_end TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      bc_card_id TEXT,
      bc_card_at TEXT,
      email_sent_at TEXT,
      fulfilled_send_id TEXT,
      fulfilled_at TEXT,
      cancelled_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE social_batches (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      client_name TEXT NOT NULL DEFAULT '',
      client_id TEXT,
      sprout_url TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      created_by TEXT NOT NULL DEFAULT '',
      qa_assignee TEXT NOT NULL DEFAULT '',
      qa_by TEXT,
      qa_at TEXT,
      qa_todo_id TEXT,
      qa_todo_url TEXT,
      qa_project_id TEXT,
      approved_at TEXT,
      approved_by TEXT,
      approved_by_slug TEXT,
      signoff_step_id TEXT,
      issue_tag TEXT NOT NULL DEFAULT '',
      issue_note TEXT NOT NULL DEFAULT '',
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  raw.close();

  const { closeDbForTests, getDb, nowIso } = await import("../src/lib/db");
  closeDbForTests();
  t.after(() => {
    closeDbForTests();
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const extras = await import("../src/lib/extra-requests");
  const db = getDb();
  const cols = (
    db.prepare(`PRAGMA table_info(extra_production_requests)`).all() as Array<{
      name: string;
    }>
  ).map((c) => c.name);
  assert.ok(cols.includes("kind"), `expected kind column, got ${cols.join(",")}`);

  const ts = nowIso();
  db.prepare(
    `INSERT INTO rev_clients (id, name, active, monthly_email_quota, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?, ?)`
  ).run("c-old", "Old Co", 4, ts, ts);

  const created = extras.createExtraRequest({
    clientId: "c-old",
    windowStart: "2026-09-14",
    windowEnd: "2026-09-18",
  });
  assert.equal(created.kind, "extra");
  assert.equal(created.window_start, "2026-09-14");
});
