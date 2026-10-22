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
  assert.match(route, /attachClientAccountManager\(source, managers\)/);
  assert.match(route, /campaignsVisibleToViewer\(/);
  assert.match(route, /params\.get\("approved"\) === "mine"/);
  const page = fs.readFileSync(
    path.join(originalCwd, "src/app/admin/campaigns/page.tsx"),
    "utf8"
  );
  assert.match(page, /Approved by me/);
  assert.match(page, /params\.set\("approved", "mine"\)/);
  assert.match(page, /viewerIsAccountManager \?/);
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

test("internal approval is filed under the account manager who approved it", async (t) => {
  const originalCwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-am-approved-"));
  process.chdir(tmp);

  const { closeDbForTests, getDb } = await import("../src/lib/db");
  const campaigns = await import("../src/lib/campaigns");
  const {
    campaignApprovedByAccountManager,
    campaignOnAccountManagerMainList,
    campaignsVisibleToViewer,
  } = await import("../src/lib/campaign-review-queue");

  t.after(() => {
    closeDbForTests();
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const cassidyReview = campaigns.createCampaign({
    title: "Cassidy approves",
    clientName: "Northwind",
    htmlContent: "<p>Hello</p>",
  });
  campaigns.recordInternalReviewTodo(cassidyReview.id, { assignee: "cassidy" });
  campaigns.applyOperatorCampaignStatus(cassidyReview.id, "internal_review");
  campaigns.addComment({
    campaignId: cassidyReview.id,
    body: "Tighten the offer.",
    type: "general",
    channel: "internal",
    authorSlug: "kyle_morris",
    authorName: "Kyle Morris",
  });

  const approved = campaigns.applyOperatorCampaignStatus(
    cassidyReview.id,
    "approved_internally",
    "Cassidy Merideth",
    "cassidy"
  )!;
  assert.equal(approved.status, "approved");
  assert.equal(approved.approved_channel, "internal");
  assert.equal(approved.internal_approved_by, "cassidy");
  assert.ok(approved.internal_approved_at);
  assert.equal(campaignOnAccountManagerMainList(approved, "cassidy"), false);
  assert.equal(campaignApprovedByAccountManager(approved, "cassidy"), true);
  // Kyle left revisions and did not approve, so he still follows it.
  assert.equal(campaignOnAccountManagerMainList(approved, "kyle_morris"), true);
  assert.equal(campaignApprovedByAccountManager(approved, "kyle_morris"), false);

  const sent = campaigns.applyOperatorCampaignStatus(cassidyReview.id, "sent")!;
  assert.equal(sent.internal_approved_by, "cassidy");
  assert.equal(sent.approved_by, null);
  assert.equal(campaignOnAccountManagerMainList(sent, "cassidy"), false);
  assert.equal(campaignApprovedByAccountManager(sent, "cassidy"), true);

  campaigns.applyOperatorCampaignStatus(cassidyReview.id, "internal_review");
  campaigns.recordInternalReviewTodo(cassidyReview.id, { assignee: "cassidy" });
  const returned = campaigns.getCampaignById(cassidyReview.id)!;
  assert.equal(returned.status, "internal_review");
  assert.equal(returned.internal_review_assignee, "cassidy");
  assert.equal(campaignOnAccountManagerMainList(returned, "cassidy"), true);
  assert.equal(campaignApprovedByAccountManager(returned, "cassidy"), false);

  const again = campaigns.applyOperatorCampaignStatus(
    cassidyReview.id,
    "approved_internally",
    "Cassidy Merideth",
    "cassidy"
  )!;
  assert.equal(again.internal_approved_by, "cassidy");
  assert.equal(campaignApprovedByAccountManager(again, "cassidy"), true);
  assert.equal(campaignOnAccountManagerMainList(again, "cassidy"), false);

  campaigns.applyOperatorCampaignStatus(cassidyReview.id, "internal_review");
  campaigns.recordInternalReviewTodo(cassidyReview.id, { assignee: "kyle_morris" });
  const forKyle = campaigns.getCampaignById(cassidyReview.id)!;
  assert.equal(campaignOnAccountManagerMainList(forKyle, "cassidy"), false);
  assert.equal(campaignApprovedByAccountManager(forKyle, "cassidy"), true);
  assert.equal(campaignOnAccountManagerMainList(forKyle, "kyle_morris"), true);
  assert.equal(campaignApprovedByAccountManager(forKyle, "kyle_morris"), false);

  const ids = (scope: "main" | "approved", person: string | null) =>
    campaignsVisibleToViewer(
      [campaigns.getCampaignById(cassidyReview.id)!],
      { role: "admin", person },
      scope
    ).map((row) => row.id);
  assert.deepEqual(ids("main", "cassidy"), []);
  assert.deepEqual(ids("approved", "cassidy"), [cassidyReview.id]);
  assert.deepEqual(ids("main", null), [cassidyReview.id]);
  assert.deepEqual(ids("approved", null), [cassidyReview.id]);
  assert.deepEqual(ids("approved", "carlos"), [cassidyReview.id]);

  const byMichael = campaigns.createCampaign({
    title: "Michael approves",
    clientName: "Fabrikam",
    htmlContent: "<p>Admin</p>",
  });
  campaigns.recordInternalReviewTodo(byMichael.id, { assignee: "luis_romero" });
  const michaelApproved = campaigns.applyOperatorCampaignStatus(
    byMichael.id,
    "approved_internally",
    "Michael",
    "michael"
  )!;
  assert.equal(michaelApproved.internal_approved_by, "");
  assert.equal(campaignOnAccountManagerMainList(michaelApproved, "luis_romero"), true);
  assert.equal(campaignApprovedByAccountManager(michaelApproved, "luis_romero"), false);

  const clientApproved = campaigns.markApproved(
    byMichael.id,
    "Cassidy Merideth",
    "client",
    "cassidy"
  )!;
  assert.equal(clientApproved.approved_channel, "client");
  assert.equal(clientApproved.internal_approved_by, "");

  const fromReviewLink = campaigns.createCampaign({
    title: "Review link",
    clientName: "Contoso",
    htmlContent: "<p>Link</p>",
  });
  campaigns.recordInternalReviewTodo(fromReviewLink.id, { assignee: "luis_romero" });
  const named = campaigns.markApproved(
    fromReviewLink.id,
    "Luis Romero",
    "internal",
    "luis_romero"
  )!;
  assert.equal(named.internal_approved_by, "luis_romero");
  campaigns.markApproved(fromReviewLink.id, "Luis Romero", "internal", "michael");
  assert.equal(campaigns.getCampaignById(fromReviewLink.id)!.internal_approved_by, "luis_romero");
  campaigns.markApproved(
    fromReviewLink.id,
    "Cassidy Merideth",
    "internal",
    "cassidy"
  );
  assert.equal(
    campaigns.getCampaignById(fromReviewLink.id)!.internal_approved_by,
    "luis_romero,cassidy"
  );

  campaigns.unapproveCampaign(fromReviewLink.id);
  const undone = campaigns.getCampaignById(fromReviewLink.id)!;
  assert.equal(undone.internal_approved_by, "");
  assert.equal(campaignApprovedByAccountManager(undone, "luis_romero"), false);
  assert.equal(campaignOnAccountManagerMainList(undone, "luis_romero"), true);

  closeDbForTests();
  const seeded = getDb();
  const now = "2026-04-01T00:00:00.000Z";
  seeded
    .prepare(
      `INSERT INTO campaigns
        (id, title, status, magic_token, approved_by, approved_channel, approved_at,
         internal_approved_by, created_at, updated_at)
       VALUES (?, ?, 'approved', ?, ?, ?, ?, '', ?, ?)`
    )
    .run("still-internal", "Still internal", "magic-still", "Cassidy Merideth", "internal", now, now, now);
  seeded
    .prepare(
      `INSERT INTO campaigns
        (id, title, status, magic_token, approved_by, approved_channel, approved_at,
         internal_approved_by, created_at, updated_at)
       VALUES (?, ?, 'approved', ?, ?, ?, ?, 'kyle_morris', ?, ?)`
    )
    .run("merge-name", "Merge", "magic-merge", "Cassidy", "internal", now, now, now);
  seeded
    .prepare(
      `INSERT INTO campaigns
        (id, title, status, magic_token, approved_by, approved_channel, approved_at,
         internal_approved_by, created_at, updated_at)
       VALUES (?, ?, 'approved', ?, ?, ?, ?, '', ?, ?)`
    )
    .run("bare-kyle", "Bare Kyle", "magic-bare", "Kyle", "internal", now, now, now);
  seeded
    .prepare(
      `INSERT INTO campaigns
        (id, title, status, magic_token, approved_by, approved_channel, approved_at,
         internal_approved_by, created_at, updated_at)
       VALUES (?, ?, 'approved', ?, ?, ?, ?, '', ?, ?)`
    )
    .run("client-ok", "Client", "magic-client", "Luis Romero", "client", now, now, now);
  seeded.prepare(`DELETE FROM app_settings WHERE key = ?`).run("internal_approved_by_backfill_v1");
  closeDbForTests();

  const migrated = getDb();
  const approver = (id: string) =>
    (
      migrated
        .prepare(`SELECT internal_approved_by AS slug FROM campaigns WHERE id = ?`)
        .get(id) as { slug: string }
    ).slug;
  assert.equal(approver("still-internal"), "cassidy");
  assert.equal(approver("merge-name"), "kyle_morris,cassidy");
  assert.equal(approver("bare-kyle"), "");
  assert.equal(approver("client-ok"), "");
  const stamped = migrated
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get("internal_approved_by_backfill_v1") as { value: string } | undefined;
  assert.ok(stamped?.value);

  migrated
    .prepare(
      `INSERT INTO campaigns
        (id, title, status, magic_token, approved_by, approved_channel, approved_at,
         internal_approved_by, created_at, updated_at)
       VALUES (?, ?, 'approved', ?, ?, 'internal', ?, '', ?, ?)`
    )
    .run("after-stamp", "Too late", "magic-late", "Luis Romero", now, now, now);
  closeDbForTests();
  const second = getDb();
  const late = second
    .prepare(`SELECT internal_approved_by AS slug FROM campaigns WHERE id = ?`)
    .get("after-stamp") as { slug: string };
  assert.equal(late.slug, "");
});

test("revisions made with no recorded reviewer still belongs to the client owner", async (t) => {
  const originalCwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-revisions-made-owner-"));
  process.chdir(tmp);

  const { closeDbForTests, getDb } = await import("../src/lib/db");
  const {
    campaignInAccountManagerQueue,
    campaignOnAccountManagerMainList,
  } = await import("../src/lib/campaign-review-queue");

  t.after(() => {
    closeDbForTests();
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  getDb();
  closeDbForTests();
  const seeded = getDb();
  const now = "2026-04-01T00:00:00.000Z";
  seeded
    .prepare(`INSERT INTO rev_clients (id, name, account_manager, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run("client-cassidy", "Northwind Revisions", "Cassidy", now, now);
  seeded
    .prepare(`INSERT INTO rev_clients (id, name, account_manager, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run("client-kyle", "Other", "Kyle", now, now);
  const insertCampaign = seeded.prepare(
    `INSERT INTO campaigns
      (id, title, status, client_id, magic_token, internal_review_assignee, internal_revision_authors, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // Michael marked the revisions done. The notes were saved as Reviewer, and
  // no internal-review assignee was stored. Owner on the client is Cassidy.
  insertCampaign.run(
    "made",
    "Revisions made for Cassidy",
    "revisions_made",
    "client-cassidy",
    "magic-made",
    "",
    "",
    now,
    now
  );
  insertCampaign.run(
    "left",
    "Needs revisions for Cassidy",
    "needs_revisions_internal",
    "client-cassidy",
    "magic-left",
    "",
    "",
    now,
    now
  );
  insertCampaign.run(
    "named",
    "Assignee stored as a name",
    "revisions_made",
    "client-kyle",
    "magic-named",
    "Cassidy Merideth",
    "",
    now,
    now
  );
  insertCampaign.run(
    "kyle-assigned",
    "Sent to Kyle",
    "revisions_made",
    "client-cassidy",
    "magic-kyle",
    "kyle_morris",
    "",
    now,
    now
  );
  insertCampaign.run(
    "review-link",
    "Only a review link",
    "internal_review",
    "",
    "magic-review-link",
    "",
    "",
    now,
    now
  );
  seeded
    .prepare(
      `INSERT INTO comments
        (id, campaign_id, author_name, body, type, resolved, channel, created_at)
       VALUES (?, ?, ?, 'Please change the headline', 'general', 0, 'internal', ?)`
    )
    .run("note-reviewer", "made", "Reviewer", now);
  seeded
    .prepare(
      `INSERT INTO comments
        (id, campaign_id, author_name, body, type, resolved, channel, created_at)
       VALUES (?, ?, ?, 'Done on my side', 'general', 0, 'internal', ?)`
    )
    .run("note-michael", "made", "Michael", now);
  seeded
    .prepare(
      `INSERT INTO todos (id, title, notes, assignee, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'internal_review', ?, ?)`
    )
    .run(
      "todo-review",
      "Review",
      "https://hub.example/review/magic-review-link",
      "Cassidy",
      now,
      now
    );
  seeded.prepare(`DELETE FROM app_settings WHERE key = ?`).run("internal_review_visibility_backfill_v2");
  closeDbForTests();

  const migrated = getDb();
  const assignee = (id: string) =>
    (
      migrated
        .prepare(`SELECT internal_review_assignee AS slug FROM campaigns WHERE id = ?`)
        .get(id) as { slug: string }
    ).slug;
  const authors = (id: string) =>
    (
      migrated
        .prepare(`SELECT internal_revision_authors AS authors FROM campaigns WHERE id = ?`)
        .get(id) as { authors: string }
    ).authors;
  assert.equal(assignee("made"), "cassidy");
  assert.equal(authors("made"), "");
  assert.equal(assignee("left"), "cassidy");
  assert.equal(assignee("named"), "cassidy");
  assert.equal(assignee("kyle-assigned"), "kyle_morris");
  assert.equal(assignee("review-link"), "cassidy");

  const made = {
    status: "revisions_made",
    internal_review_assignee: assignee("made"),
    internal_revision_authors: authors("made"),
    client_account_manager: "Cassidy",
  };
  assert.equal(campaignOnAccountManagerMainList(made, "cassidy"), true);
  assert.equal(campaignInAccountManagerQueue(made, "cassidy"), true);
  assert.equal(campaignOnAccountManagerMainList(made, "kyle_morris"), false);
  assert.equal(
    campaignInAccountManagerQueue(
      { ...made, status: "needs_revisions_internal", internal_review_assignee: assignee("left") },
      "cassidy"
    ),
    true
  );

  const stamped = migrated
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get("internal_review_visibility_backfill_v2") as { value: string } | undefined;
  assert.ok(stamped?.value);

  migrated
    .prepare(`UPDATE campaigns SET internal_review_assignee = '' WHERE id = ?`)
    .run("made");
  migrated
    .prepare(`UPDATE rev_clients SET account_manager = ? WHERE id = ?`)
    .run("Luis", "client-cassidy");
  closeDbForTests();
  const secondStarted = performance.now();
  const second = getDb();
  const secondElapsed = performance.now() - secondStarted;
  assert.ok(secondElapsed < 2000, `second boot took ${secondElapsed.toFixed(0)}ms`);
  const kept = second
    .prepare(`SELECT internal_review_assignee AS slug FROM campaigns WHERE id = ?`)
    .get("made") as { slug: string };
  assert.equal(kept.slug, "");

  // A fresh stamp-less pass over a few thousand internal-loop rows stays fast.
  second.prepare(`DELETE FROM app_settings WHERE key = ?`).run("internal_review_visibility_backfill_v2");
  const insertBulk = second.prepare(
    `INSERT INTO campaigns
      (id, title, status, client_id, magic_token, internal_review_assignee, internal_revision_authors, created_at, updated_at)
     VALUES (?, ?, 'revisions_made', ?, ?, '', '', ?, ?)`
  );
  const bulk = second.transaction(() => {
    for (let i = 0; i < 3000; i++) {
      insertBulk.run(`bulk-made-${i}`, `Bulk ${i}`, "client-cassidy", `magic-bulk-made-${i}`, now, now);
    }
  });
  bulk();
  closeDbForTests();
  const started = performance.now();
  const filled = getDb();
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 2000, `visibility backfill took ${elapsed.toFixed(0)}ms`);
  const sample = filled
    .prepare(`SELECT internal_review_assignee AS slug FROM campaigns WHERE id = ?`)
    .get("bulk-made-0") as { slug: string };
  // The client owner was changed to Luis before this pass, and the stamp was cleared.
  assert.equal(sample.slug, "luis_romero");
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
