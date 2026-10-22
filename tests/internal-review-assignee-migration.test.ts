import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type Database from "better-sqlite3";

const STATUSES = [
  "draft",
  "internal_review",
  "needs_revisions_internal",
  "revisions_made",
  "in_review",
  "needs_changes",
  "approved",
  "scheduled",
  "sent",
  "live",
] as const;

const BACKFILL_KEY = "internal_review_assignee_backfill_v1";
const GHL_TOKENS = JSON.stringify({
  access_token: "ghl-access",
  refresh_token: "ghl-refresh",
  expires_at: "2026-01-01T00:00:00.000Z",
});
const BASECAMP_TOKENS = JSON.stringify({
  access_token: "bc-access",
  refresh_token: "bc-refresh",
  expires_at: 1730000000,
});

test("assignee backfill is one fast pass and leaves a pre-#75 database intact", async (t) => {
  const originalCwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-assignee-mig-"));
  const originalLog = console.log;
  const originalError = console.error;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const capture = () => {};
  console.log = capture;
  console.error = capture;
  console.info = capture;
  console.warn = capture;
  process.chdir(tmp);

  const { closeDbForTests, getDb } = await import("../src/lib/db");
  closeDbForTests();

  t.after(() => {
    console.log = originalLog;
    console.error = originalError;
    console.info = originalInfo;
    console.warn = originalWarn;
    closeDbForTests();
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // Bootstrap the current schema, then strip the #75 column and stamp so the
  // next open is a first boot against a pre-#75 file.
  getDb();
  stripAssigneeMigration(getDb());
  seedDesk(getDb());
  closeDbForTests();

  const first = getDb();
  assert.equal(assigneeOf(first, "camp_newest"), "new-am");
  assert.equal(assigneeOf(first, "camp-blank"), "");
  assert.equal(assigneeOf(first, "camp_manual"), "");
  assert.equal(assigneeOf(first, "ab_cd-12EF34"), "hyphen-am");
  assert.ok(setting(first, BACKFILL_KEY));
  assert.equal(setting(first, "ghl_tokens"), GHL_TOKENS);
  assert.equal(setting(first, "basecamp_tokens"), BASECAMP_TOKENS);
  for (const status of STATUSES) {
    assert.equal(statusOf(first, `status-${status}`), status);
  }

  // A campaign that already has an assignee (the failed production boot wrote
  // some) must not be overwritten when the stamp is missing.
  first
    .prepare(
      `UPDATE campaigns SET internal_review_assignee = ? WHERE id = ?`
    )
    .run("already-there", "camp-blank");
  first.prepare(`DELETE FROM app_settings WHERE key = ?`).run(BACKFILL_KEY);
  first
    .prepare(
      `INSERT INTO todos (id, title, notes, assignee, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'internal_review', ?, ?)`
    )
    .run(
      "todo-later",
      "Later review",
      noteFor("camp-blank"),
      "should-not-win",
      "2026-06-03T00:00:00.000Z",
      "2026-06-03T00:00:00.000Z"
    );
  closeDbForTests();
  const rerun = getDb();
  assert.equal(assigneeOf(rerun, "camp-blank"), "already-there");
  assert.equal(assigneeOf(rerun, "camp_newest"), "new-am");
  assert.ok(setting(rerun, BACKFILL_KEY));

  // Volume that made the old correlated LIKE miss Railway's 30s window.
  stripAssigneeMigration(rerun);
  const insertCampaign = rerun.prepare(
    `INSERT INTO campaigns (id, title, status, magic_token, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertTodo = rerun.prepare(
    `INSERT INTO todos (id, title, notes, assignee, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'internal_review', ?, ?)`
  );
  const seedLarge = rerun.transaction(() => {
    for (let i = 0; i < 3000; i++) {
      const status = STATUSES[i % STATUSES.length];
      insertCampaign.run(
        `bulk-${i}`,
        `Bulk ${i}`,
        status,
        `magic-bulk-${i}`,
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z"
      );
    }
    for (let i = 0; i < 6000; i++) {
      const campaignId = `bulk-${i % 3000}`;
      insertTodo.run(
        `bulk-todo-${i}`,
        "Review",
        noteFor(campaignId),
        i < 3000 ? "older-am" : "newer-am",
        i < 3000 ? "2026-01-01T00:00:00.000Z" : "2026-02-01T00:00:00.000Z",
        "2026-02-01T00:00:00.000Z"
      );
    }
  });
  seedLarge();
  closeDbForTests();

  const started = performance.now();
  const migrated = getDb();
  const elapsed = performance.now() - started;
  assert.ok(
    elapsed < 2000,
    `first boot that applies the assignee migration took ${elapsed.toFixed(0)}ms`
  );
  assert.equal(assigneeOf(migrated, "bulk-0"), "newer-am");
  assert.equal(assigneeOf(migrated, "bulk-2999"), "newer-am");
  assert.equal(statusOf(migrated, "status-revisions_made"), "revisions_made");
  assert.equal(setting(migrated, "ghl_tokens"), GHL_TOKENS);
  assert.equal(setting(migrated, "basecamp_tokens"), BASECAMP_TOKENS);
  assert.ok(setting(migrated, BACKFILL_KEY));

  closeDbForTests();
  const secondStarted = performance.now();
  const second = getDb();
  const secondElapsed = performance.now() - secondStarted;
  assert.ok(
    secondElapsed < 2000,
    `second boot took ${secondElapsed.toFixed(0)}ms`
  );
  assert.equal(assigneeOf(second, "bulk-0"), "newer-am");
  assert.equal(setting(second, "ghl_tokens"), GHL_TOKENS);
});

function stripAssigneeMigration(database: Database.Database) {
  const names = (
    database.prepare(`PRAGMA table_info(campaigns)`).all() as Array<{
      name: string;
    }>
  ).map((column) => column.name);
  if (names.includes("internal_review_assignee")) {
    database.exec(`ALTER TABLE campaigns DROP COLUMN internal_review_assignee`);
  }
  database.prepare(`DELETE FROM app_settings WHERE key = ?`).run(BACKFILL_KEY);
}

function seedDesk(database: Database.Database) {
  const insertCampaign = database.prepare(
    `INSERT INTO campaigns (id, title, status, magic_token, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const status of STATUSES) {
    insertCampaign.run(
      `status-${status}`,
      status,
      status,
      `magic-${status}`,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z"
    );
  }
  for (const id of ["camp_newest", "camp-blank", "camp_manual", "ab_cd-12EF34"]) {
    insertCampaign.run(
      id,
      id,
      "internal_review",
      `magic-${id}`,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z"
    );
  }

  const insertTodo = database.prepare(
    `INSERT INTO todos (id, title, notes, assignee, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  insertTodo.run(
    "todo-old",
    "Old review",
    noteFor("camp_newest"),
    "old-am",
    "internal_review",
    "2026-05-01T00:00:00.000Z",
    "2026-05-01T00:00:00.000Z"
  );
  insertTodo.run(
    "todo-new",
    "New review",
    noteFor("camp_newest"),
    "new-am",
    "internal_review",
    "2026-05-02T00:00:00.000Z",
    "2026-05-02T00:00:00.000Z"
  );
  insertTodo.run(
    "todo-blank",
    "Blank review",
    noteFor("camp-blank"),
    "",
    "internal_review",
    "2026-05-02T00:00:00.000Z",
    "2026-05-02T00:00:00.000Z"
  );
  insertTodo.run(
    "todo-manual",
    "Manual",
    noteFor("camp_manual"),
    "manual-person",
    "manual",
    "2026-05-02T00:00:00.000Z",
    "2026-05-02T00:00:00.000Z"
  );
  insertTodo.run(
    "todo-hyphen",
    "Hyphen id",
    noteFor("ab_cd-12EF34"),
    "hyphen-am",
    "internal_review",
    "2026-05-02T00:00:00.000Z",
    "2026-05-02T00:00:00.000Z"
  );

  const insertSetting = database.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );
  const now = "2026-01-01T00:00:00.000Z";
  insertSetting.run("ghl_tokens", GHL_TOKENS, now);
  insertSetting.run("basecamp_tokens", BASECAMP_TOKENS, now);
}

function noteFor(campaignId: string): string {
  return [
    "Internal review",
    "https://hub.example/review/token",
    `https://hub.example/admin/campaigns/${campaignId}`,
    "https://3.basecamp.com/1/buckets/2/todos/3",
  ].join("\n");
}

function assigneeOf(database: Database.Database, id: string): string {
  const row = database
    .prepare(`SELECT internal_review_assignee AS assignee FROM campaigns WHERE id = ?`)
    .get(id) as { assignee: string };
  return row.assignee;
}

function statusOf(database: Database.Database, id: string): string {
  const row = database
    .prepare(`SELECT status FROM campaigns WHERE id = ?`)
    .get(id) as { status: string };
  return row.status;
}

function setting(database: Database.Database, key: string): string | undefined {
  const row = database
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value;
}
