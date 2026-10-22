import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import type Database from "better-sqlite3";

const BACKFILL_KEY = "internal_revision_authors_backfill_v1";

describe("account manager campaign visibility", { concurrency: 1 }, () => {
test("leaving revisions records the account manager and keeps the campaign visible", async (t) => {
  const originalCwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-am-visibility-"));
  process.chdir(tmp);

  const { closeDbForTests } = await import("../src/lib/db");
  const campaigns = await import("../src/lib/campaigns");
  const {
    campaignVisibleToAccountManager,
    campaignsVisibleToViewer,
  } = await import("../src/lib/campaign-review-queue");

  t.after(() => {
    closeDbForTests();
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const assigned = campaigns.createCampaign({
    title: "Sent to Cassidy",
    clientName: "Northwind",
    htmlContent: "<p>Hello</p>",
  });
  campaigns.recordInternalReviewTodo(assigned.id, { assignee: "cassidy" });
  campaigns.applyOperatorCampaignStatus(assigned.id, "internal_review");

  const revised = campaigns.createCampaign({
    title: "Cassidy left notes",
    clientName: "Fabrikam",
    htmlContent: "<p>Offer</p>",
  });
  campaigns.recordInternalReviewTodo(revised.id, { assignee: "kyle_morris" });
  campaigns.applyOperatorCampaignStatus(revised.id, "internal_review");
  campaigns.addComment({
    campaignId: revised.id,
    body: "Change the headline.",
    type: "general",
    channel: "internal",
    authorSlug: "cassidy",
    authorName: "Cassidy",
  });

  const luisOnly = campaigns.createCampaign({
    title: "Luis only",
    clientName: "Contoso",
    htmlContent: "<p>Other</p>",
  });
  campaigns.recordInternalReviewTodo(luisOnly.id, { assignee: "luis_romero" });
  campaigns.applyOperatorCampaignStatus(luisOnly.id, "revisions_made");

  const untouched = campaigns.createCampaign({
    title: "Nobody's",
    clientName: "Adventure",
    htmlContent: "<p>Draft</p>",
  });

  const cassidySees = (rows: typeof assigned[]) =>
    campaignsVisibleToViewer(rows, { role: "admin", person: "cassidy" }).map((row) => row.id);

  let all = [assigned, revised, luisOnly, untouched].map(
    (row) => campaigns.getCampaignById(row.id)!
  );
  assert.deepEqual(cassidySees(all).sort(), [assigned.id, revised.id].sort());
  assert.equal(
    campaigns.getCampaignById(revised.id)!.internal_revision_authors,
    "cassidy"
  );
  assert.equal(campaigns.getCampaignById(revised.id)!.status, "needs_revisions_internal");

  campaigns.markRevisionDone(revised.id);
  campaigns.applyOperatorCampaignStatus(revised.id, "approved_internally", "Michael");
  campaigns.applyOperatorCampaignStatus(revised.id, "in_review");
  const followed = campaigns.getCampaignById(revised.id)!;
  assert.equal(followed.internal_revision_authors, "cassidy");
  assert.equal(followed.status, "in_review");
  assert.equal(campaignVisibleToAccountManager(followed, "cassidy"), true);
  assert.equal(campaignVisibleToAccountManager(followed, "kyle_morris"), true);

  all = [assigned, revised, luisOnly, untouched].map(
    (row) => campaigns.getCampaignById(row.id)!
  );
  assert.deepEqual(cassidySees(all).sort(), [assigned.id, revised.id].sort());
  assert.deepEqual(
    campaignsVisibleToViewer(all, { role: "admin", person: "kyle_morris" }).map((row) => row.id),
    [revised.id]
  );
  assert.deepEqual(
    campaignsVisibleToViewer(all, { role: "admin", person: "luis_romero" }).map((row) => row.id),
    [luisOnly.id]
  );
  assert.deepEqual(
    campaignsVisibleToViewer(all, { role: "admin", person: null }).map((row) => row.id).sort(),
    all.map((row) => row.id).sort()
  );

  const movedByLuis = campaigns.createCampaign({
    title: "Luis moved it",
    clientName: "Wide World",
    htmlContent: "<p>Move</p>",
  });
  campaigns.applyOperatorCampaignStatus(
    movedByLuis.id,
    "needs_revisions_internal",
    "Luis Romero",
    "luis_romero"
  );
  assert.equal(
    campaigns.getCampaignById(movedByLuis.id)!.internal_revision_authors,
    "luis_romero"
  );
  campaigns.applyOperatorCampaignStatus(
    movedByLuis.id,
    "approved_internally",
    "Michael",
    "michael"
  );
  const afterApproval = campaigns.getCampaignById(movedByLuis.id)!;
  assert.equal(afterApproval.status, "approved");
  assert.equal(afterApproval.approved_channel, "internal");
  assert.equal(afterApproval.internal_revision_authors, "luis_romero");
  assert.equal(campaignVisibleToAccountManager(afterApproval, "luis_romero"), true);
  assert.equal(campaignVisibleToAccountManager(afterApproval, "cassidy"), false);

  const michaelMove = campaigns.createCampaign({
    title: "Michael moved it",
    clientName: "Alpine",
    htmlContent: "<p>Admin</p>",
  });
  campaigns.applyOperatorCampaignStatus(
    michaelMove.id,
    "needs_revisions_internal",
    "Michael",
    "michael"
  );
  assert.equal(campaigns.getCampaignById(michaelMove.id)!.internal_revision_authors, "");

  campaigns.applyOperatorCampaignStatus(assigned.id, "internal_review");
  campaigns.addComment({
    campaignId: assigned.id,
    body: "Client note",
    type: "general",
    channel: "external",
    authorSlug: "cassidy",
    authorName: "Cassidy",
  });
  assert.equal(campaigns.getCampaignById(assigned.id)!.status, "needs_changes");
  assert.equal(campaigns.getCampaignById(assigned.id)!.internal_revision_authors, "");

  const route = fs.readFileSync(
    path.join(originalCwd, "src/app/api/campaigns/route.ts"),
    "utf8"
  );
  assert.match(route, /campaignsVisibleToViewer\(source, session\)/);
  const search = fs.readFileSync(
    path.join(originalCwd, "src/app/api/search/route.ts"),
    "utf8"
  );
  assert.match(search, /campaignVisibleToAccountManager/);
});

test("revision-author backfill is one fast pass", async (t) => {
  const originalCwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-revision-backfill-"));
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

  getDb();
  closeDbForTests();
  const seeded = getDb();
  seedHistory(seeded);
  seeded.prepare(`DELETE FROM app_settings WHERE key = ?`).run(BACKFILL_KEY);
  seeded.exec(`ALTER TABLE campaigns DROP COLUMN internal_revision_authors`);
  const preserved = "keep-this";
  seeded
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)`
    )
    .run("ghl_tokens", preserved, "2026-01-01T00:00:00.000Z");
  closeDbForTests();

  const started = performance.now();
  const migrated = getDb();
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 2000, `revision-author backfill took ${elapsed.toFixed(0)}ms`);
  assert.equal(authorsOf(migrated, "named"), "cassidy,kyle_morris");
  assert.equal(authorsOf(migrated, "reply-only"), "luis_romero");
  assert.equal(authorsOf(migrated, "bare-kyle"), "");
  assert.equal(authorsOf(migrated, "external"), "");
  assert.equal(authorsOf(migrated, "already"), "cassidy");
  assert.equal(setting(migrated, BACKFILL_KEY) != null, true);
  assert.equal(setting(migrated, "ghl_tokens"), preserved);

  // A slug already stored is kept, and the comment history is merged in.
  migrated
    .prepare(`UPDATE campaigns SET internal_revision_authors = ? WHERE id = ?`)
    .run("kyle_morris", "already");
  migrated.prepare(`DELETE FROM app_settings WHERE key = ?`).run(BACKFILL_KEY);
  closeDbForTests();
  const merged = getDb();
  assert.equal(authorsOf(merged, "already"), "kyle_morris,cassidy");
  assert.equal(setting(merged, BACKFILL_KEY) != null, true);

  merged
    .prepare(
      `INSERT INTO comments
        (id, campaign_id, author_name, body, type, resolved, channel, created_at)
       VALUES (?, ?, ?, ?, 'general', 0, 'internal', ?)`
    )
    .run(
      "comment-after",
      "bare-kyle",
      "Cassidy Merideth",
      "Too late for the backfill",
      "2026-04-01T00:00:00.000Z"
    );
  closeDbForTests();
  const secondStarted = performance.now();
  const second = getDb();
  const secondElapsed = performance.now() - secondStarted;
  assert.ok(secondElapsed < 2000, `second boot took ${secondElapsed.toFixed(0)}ms`);
  assert.equal(authorsOf(second, "bare-kyle"), "");
  assert.equal(authorsOf(second, "named"), "cassidy,kyle_morris");
  assert.equal(authorsOf(second, "already"), "kyle_morris,cassidy");
});
});

function seedHistory(database: Database.Database) {
  const insertCampaign = database.prepare(
    `INSERT INTO campaigns (id, title, status, magic_token, created_at, updated_at)
     VALUES (?, ?, 'internal_review', ?, ?, ?)`
  );
  const insertComment = database.prepare(
    `INSERT INTO comments
      (id, campaign_id, author_name, body, type, resolved, channel, created_at)
     VALUES (?, ?, ?, 'notes', 'general', 0, ?, ?)`
  );
  const now = "2026-03-01T00:00:00.000Z";
  const ids = ["named", "reply-only", "bare-kyle", "external", "already"];
  for (const id of ids) {
    insertCampaign.run(id, id, `magic-${id}`, now, now);
  }
  insertComment.run("c1", "named", "Cassidy Merideth", "internal", now);
  insertComment.run("c2", "named", "Morris Kyle", "internal", now);
  insertComment.run("c3", "named", "Reviewer", "internal", now);
  insertComment.run("c4", "bare-kyle", "Kyle", "internal", now);
  insertComment.run("c5", "external", "Luis Romero", "external", now);
  insertComment.run("c6", "already", "Cassidy", "internal", now);

  const commentId = "parent-reply";
  insertComment.run(commentId, "reply-only", "Reviewer", "internal", now);
  database
    .prepare(
      `INSERT INTO comment_replies
        (id, comment_id, campaign_id, author_name, body, is_admin, created_at)
       VALUES (?, ?, ?, ?, 'more notes', 0, ?)`
    )
    .run("reply-1", commentId, "reply-only", "Luis Romero", now);

  const insertBulkCampaign = database.prepare(
    `INSERT INTO campaigns (id, title, status, magic_token, created_at, updated_at)
     VALUES (?, ?, 'draft', ?, ?, ?)`
  );
  const insertBulkComment = database.prepare(
    `INSERT INTO comments
      (id, campaign_id, author_name, body, type, resolved, channel, created_at)
     VALUES (?, ?, ?, 'notes', 'general', 0, 'internal', ?)`
  );
  const bulk = database.transaction(() => {
    for (let i = 0; i < 3000; i++) {
      insertBulkCampaign.run(`bulk-${i}`, `Bulk ${i}`, `magic-bulk-${i}`, now, now);
    }
    for (let i = 0; i < 8000; i++) {
      const author = i % 5 === 0 ? "Cassidy" : i % 5 === 1 ? "Kyle Morris" : "Reviewer";
      insertBulkComment.run(
        `bulk-comment-${i}`,
        `bulk-${i % 3000}`,
        author,
        now
      );
    }
  });
  bulk();
}

function authorsOf(database: Database.Database, id: string): string {
  const row = database
    .prepare(
      `SELECT internal_revision_authors AS authors FROM campaigns WHERE id = ?`
    )
    .get(id) as { authors: string };
  return row.authors;
}

function setting(database: Database.Database, key: string): string | undefined {
  const row = database
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value;
}
