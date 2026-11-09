import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultAllowed, subjectFor } from "../src/lib/access";
import { parseWebsiteCsv } from "../src/lib/website-ops-import";
import { WEBSITE_OPS_SCHEMA_SQL, ensureWebsiteOpsSchema } from "../src/lib/website-ops-schema";
import {
  inRestLane,
  inWeekLane,
  isClientWait,
  isOverdue,
  isWaiting,
  canonicalStage,
  matchClientId,
  matchesPerson,
  ownerNames,
  overduePhrase,
  summarize,
  todayColumn,
  waitingBreakdown,
  waitingKind,
  weekBounds,
  type WebsiteProject,
} from "../src/lib/website-ops-model";
import { OWNER_SLUG, hasWebsiteOpsAccess } from "../src/lib/people";

const TODAY = "2026-11-09";

test("website ops is the web team by default, and grantable to everyone else", () => {
  const on = ["roy", "saqib", "luis_romero", "carlos", "jerald", "sylvia", "kyle_morris"];
  const off = ["cassidy", "jack", "abel", "randi", "lana", "paula", "mike_hines", "kyle_onstott"];
  for (const slug of on) {
    assert.equal(hasWebsiteOpsAccess(slug), true, slug);
    assert.equal(defaultAllowed("page.website", subjectFor(slug)), true, slug);
  }
  for (const slug of off) {
    assert.equal(hasWebsiteOpsAccess(slug), false, slug);
    assert.equal(defaultAllowed("page.website", subjectFor(slug)), false, slug);
  }
  assert.equal(defaultAllowed("page.website", subjectFor(OWNER_SLUG)), true);
  assert.equal(hasWebsiteOpsAccess(OWNER_SLUG), true);
});

test("the website migration only adds a table", () => {
  assert.match(WEBSITE_OPS_SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS website_projects/);
  assert.doesNotMatch(WEBSITE_OPS_SCHEMA_SQL, /DROP\s/i);
  assert.doesNotMatch(WEBSITE_OPS_SCHEMA_SQL, /DELETE\s+FROM/i);
});

test("this week is Mon Nov 9 through Sun Nov 15, 2026", () => {
  assert.deepEqual(weekBounds(TODAY), { start: "2026-11-09", end: "2026-11-15" });
});

test("client links are exact, and internal work stays unlinked", () => {
  const clients = [
    { id: "volt", name: "12 Volt Power" },
    { id: "floor", name: "FloorCo" },
    { id: "floor2", name: "FloorCo Design" },
    { id: "meg", name: "MEG Marketing" },
  ];
  assert.equal(matchClientId("12 Volt Power", clients), "volt");
  assert.equal(matchClientId("12 Volt — Veterans week", clients), "volt");
  assert.equal(matchClientId("FloorCo", clients), "floor");
  assert.equal(matchClientId("MEG Website", clients), null);
  assert.equal(matchClientId("EMPIRE Analytics", clients), null);
  assert.equal(matchClientId("InFrame App", clients), null);
});

test("retired stages fold into the shorter list", () => {
  assert.equal(canonicalStage("website", "final_qa"), "qa");
  assert.equal(canonicalStage("website", "discovery"), "briefing");
  assert.equal(canonicalStage("landing", "unknown"), "needs_information");
  assert.equal(canonicalStage("website", "design"), "design");
});

test("owners are people, and a late date says how many days", () => {
  assert.deepEqual(ownerNames("Roy/Client"), ["Roy"]);
  assert.deepEqual(ownerNames("Roy/Saqib/Morris"), ["Roy", "Saqib", "Morris"]);
  assert.deepEqual(ownerNames("Client"), []);
  assert.equal(overduePhrase("2026-10-30", "2026-11-09"), "10 days overdue");
  assert.equal(overduePhrase("2026-11-06", "2026-11-09"), "3 days overdue");
  assert.equal(overduePhrase("2026-11-08", "2026-11-09"), "1 day overdue");
});

test("waiting on a client is not the same as waiting on a teammate", () => {
  assert.equal(waitingKind("Client"), "client");
  assert.equal(waitingKind("Cindy / Mark"), "client");
  assert.equal(waitingKind("Jesus, Piarulli"), "client");
  assert.equal(waitingKind("Luis"), "team");
  assert.equal(waitingKind("Morris"), "team");
  assert.equal(waitingKind(""), "none");
});

test("a production CSV previews without being a special case for quotes", () => {
  const csv = [
    "Tiers,Start Date,Project Name,Platform,Deliverables,Project Stage,Outsource,Internal Support,Target Launch Date,Last Touchpoint,Priority,Notes / Blockers",
    "Web,6/5/2026,Renaissance,Wix Studio,New website,Briefing,,Luis,11/20/2026,8/11/2026,Medium,https://app.basecamp.com/x",
    "Custom Projects",
    'T1,5/19/2026,MEG Website,WordPress,Redesign,Development,,Roy/Saqib,"11/01/2026",10/5/2026,High,"Blocked on copy, still"',
  ].join("\n");
  const preview = parseWebsiteCsv(csv);
  assert.equal(preview.format, "production");
  assert.equal(preview.rows.length, 2);
  assert.equal(preview.rows[0].draft.name, "Renaissance");
  assert.equal(preview.rows[0].draft.targetOn, "2026-11-20");
  assert.equal(preview.rows[0].draft.basecampUrl, "https://app.basecamp.com/x");
  assert.equal(preview.rows[1].draft.projectGroup, "custom");
  assert.equal(preview.rows[1].draft.blockers, "Blocked on copy, still");
  assert.equal(preview.rows[1].draft.owners, "Roy/Saqib");
});

test("website desk storage", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-website-ops-"));
  const original = process.cwd();
  process.chdir(tmp);
  const ops = await import("../src/lib/website-ops");
  const fixtures = await import("../src/lib/website-ops-fixtures");
  const access = await import("../src/lib/access");
  const { getDb } = await import("../src/lib/db");

  t.after(() => {
    process.chdir(original);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const db = getDb();
  const campaignsBefore = (
    db.prepare(`SELECT COUNT(*) AS n FROM campaigns`).get() as { n: number }
  ).n;
  assert.equal(
    (db.prepare(`SELECT COUNT(*) AS n FROM website_projects`).get() as { n: number }).n,
    0
  );

  await t.test("opening the database does not load the sample", () => {
    assert.equal(ops.listWebsiteProjects().length, 0);
  });

  await t.test("the sample matches the week of Nov 9", () => {
    const inserted = fixtures.insertWebsiteOpsFixtures("", TODAY);
    assert.equal(inserted, 29);
    assert.equal(fixtures.insertWebsiteOpsFixtures("", TODAY), 0);
    db.prepare(
      `INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES ('volt', '12 Volt Power', '2026-11-09', '2026-11-09')`
    ).run();
    // The client row has to exist before a link is stored. Re-link by updating
    // the one landing page whose name starts with the client.
    const page = ops.listWebsiteProjects().find((project) => project.name.startsWith("12 Volt"));
    assert.ok(page);
    const linked = ops.updateWebsiteProject(page!.id, { clientId: "volt" }, "roy", TODAY);
    assert.equal(linked.ok, true);
    if (linked.ok) assert.equal(linked.project.clientId, "volt");

    const projects = ops.listWebsiteProjects();
    const summary = summarize(projects, TODAY);
    assert.equal(summary.overdue, 7);
    assert.equal(summary.dueThisWeek, 7);
    assert.equal(summary.waiting, 12);
    assert.equal(summary.launched, 4);
    assert.equal(summary.paused, 1);
    assert.equal(summary.nonResponsive, 2);
    assert.deepEqual(waitingBreakdown(projects), { client: 7, team: 5 });

    const roy = projects.filter((project) => matchesPerson(project, "Roy"));
    assert.equal(roy.filter((project) => isOverdue(project, TODAY)).length, 5);
    assert.equal(roy.filter((project) => inWeekLane(project, TODAY)).length, 2);
    assert.equal(roy.filter(isWaiting).length, 3);
    assert.equal(roy.filter(isClientWait).length, 3);
    assert.equal(roy.filter((project) => inRestLane(project, TODAY)).length, 1);
    // This week shows each open project in one column: overdue, then waiting, then due, then the rest.
    const royColumns = { overdue: 0, waiting: 0, week: 0, rest: 0 };
    for (const project of roy) {
      const column = todayColumn(project, TODAY);
      if (column) royColumns[column] += 1;
    }
    assert.deepEqual(royColumns, { overdue: 5, waiting: 2, week: 0, rest: 1 });
    db.prepare(`UPDATE website_projects SET stage = 'final_qa' WHERE name = 'InFrame App'`).run();
    ensureWebsiteOpsSchema(db);
    const raw = db.prepare(`SELECT stage FROM website_projects WHERE name = 'InFrame App'`).get() as {
      stage: string;
    };
    assert.equal(raw.stage, "qa");

    const seen = new Set<string>();
    for (const project of projects) {
      const column = todayColumn(project, TODAY);
      if (!column) continue;
      assert.equal(seen.has(project.id), false);
      seen.add(project.id);
    }

    const saqib = projects.filter((project) => matchesPerson(project, "Saqib"));
    assert.equal(saqib.filter((project) => isOverdue(project, TODAY)).length, 3);
    assert.equal(saqib.filter((project) => inWeekLane(project, TODAY)).length, 2);

    const none = projects.filter((project) => matchesPerson(project, "__none") && project.disposition === "active");
    assert.equal(none.length, 3);
  });

  await t.test("moving to launched stamps the launch, and moving back reopens it", () => {
    const created = ops.createWebsiteProject(
      { name: "Move me", board: "website", stage: "design", owners: "Roy" },
      "roy",
      TODAY
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const launched = ops.updateWebsiteProject(created.project.id, { stage: "launched" }, "roy", TODAY);
    assert.equal(launched.ok, true);
    if (!launched.ok) return;
    assert.equal(launched.project.disposition, "launched");
    assert.equal(launched.project.launchOn, TODAY);
    const reopened = ops.updateWebsiteProject(created.project.id, { stage: "development" }, "roy", TODAY);
    assert.equal(reopened.ok, true);
    if (!reopened.ok) return;
    assert.equal(reopened.project.disposition, "active");
    assert.equal(reopened.project.stage, "development");
  });

  await t.test("a bad stage and a bad link are refused", () => {
    const stage = ops.createWebsiteProject({ name: "Nope", board: "website", stage: "done" }, "roy", TODAY);
    assert.equal(stage.ok, false);
    const missing = ops.updateWebsiteProject("missing", { name: "Nope" }, "roy", TODAY);
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.status, 404);
  });

  await t.test("import preview writes nothing, and commit skips duplicates", () => {
    const before = ops.listWebsiteProjects().length;
    const csv = [
      "Client Account,Landing Page / Task,Dates (PT),Status,Link,Pending On",
      "FloorCo,Spring page,11/18/2026,In progress,https://app.basecamp.com/z,Luis",
    ].join("\n");
    const preview = parseWebsiteCsv(csv);
    assert.equal(preview.rows.length, 1);
    assert.equal(ops.listWebsiteProjects().length, before);
    const first = ops.commitWebsiteImport(preview.rows.map((row) => row.draft), "roy", TODAY);
    assert.equal(first.created, 1);
    assert.equal(first.skipped, 0);
    const second = ops.commitWebsiteImport(preview.rows.map((row) => row.draft), "roy", TODAY);
    assert.equal(second.created, 0);
    assert.equal(second.skipped, 1);
  });

  await t.test("the owner can grant the desk to someone who does not have it", () => {
    const cassidy = access.subjectFor("cassidy");
    assert.equal(access.allows(cassidy, "page.website"), false);
    access.setOverride("cassidy", "page.website", true, "michael");
    assert.equal(access.allows(cassidy, "page.website"), true);
    access.clearOverrides("cassidy");
    assert.equal(access.allows(cassidy, "page.website"), false);
  });

  await t.test("existing campaign rows are left alone", () => {
    const campaignsAfter = (
      db.prepare(`SELECT COUNT(*) AS n FROM campaigns`).get() as { n: number }
    ).n;
    assert.equal(campaignsAfter, campaignsBefore);
  });

  // Silence an unused-type lint in editors that don't see the assertion helper.
  const _sample: WebsiteProject | undefined = ops.listWebsiteProjects()[0];
  assert.ok(_sample);
});
