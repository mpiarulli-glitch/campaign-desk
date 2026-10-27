import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Link-all attaches every active Basecamp project to a client. A confident
// name match fills a blank id. Otherwise one forecasting client is created.
// An existing link is left alone, and an ambiguous name is reported, not guessed.

test("link-all links, creates, and reports what it will not guess", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-link-all-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  const { closeDbForTests } = await import("../src/lib/db");
  closeDbForTests();

  t.after(() => {
    closeDbForTests();
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const { createRevClient, listRevClients, updateRevClient } = await import("../src/lib/revenue");
  const { getDb } = await import("../src/lib/db");
  const linkAll = await import("../src/lib/basecamp-link-all");

  const northwind = createRevClient({ name: "Northwind", businessModel: "b2b" });
  updateRevClient(northwind.id, { basecampProjectId: "1001" });
  const pinnacle = createRevClient({ name: "Pinnacle Roofing", businessModel: "home_service" });
  const acme = createRevClient({ name: "Acme", businessModel: "home_service" });
  const cedar = createRevClient({ name: "Cedar Lane", businessModel: "home_service" });
  const cedarLlc = createRevClient({ name: "Cedar Lane, LLC", businessModel: "home_service" });
  createRevClient({ name: "LMX Health", businessModel: "home_service" });
  createRevClient({
    name: "New Beginnings Recovery Inland Empire",
    businessModel: "home_service",
  });
  const oldShop = createRevClient({ name: "Old Shop", businessModel: "b2b" });
  updateRevClient(oldShop.id, { basecampProjectId: "555" });
  const goneShop = createRevClient({ name: "Gone Shop", businessModel: "b2b" });
  updateRevClient(goneShop.id, { basecampProjectId: "777" });

  const projects = [
    { id: "1001", name: "Wrong Name Growth OS" },
    { id: "3000", name: "Northwind - Marketing" },
    { id: "1002", name: "Pinnacle Roofing - Marketing" },
    { id: "1003", name: "Harbor Dental Growth OS" },
    { id: "1004", name: "Empire Leadership HQ" },
    { id: "1005", name: "Jack" },
    { id: "1006", name: "Acme Growth OS" },
    { id: "1007", name: "Acme - Marketing" },
    { id: "1008", name: "Cedar Lane Growth OS" },
  ];
  const archived = [{ id: "555", name: "Old Shop Growth OS" }];
  const before = listRevClients(true).length;

  const preview = await linkAll.linkAllBasecampProjects({
    dryRun: true,
    projects,
    archived,
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.dryRun, true);
  assert.equal(preview.skipped, false);
  assert.equal(listRevClients(true).length, before);
  assert.equal(linkAll.readLinkAllReport(), null);
  assert.equal(
    listRevClients(true).find((row) => row.id === northwind.id)?.basecamp_project_id,
    "1001"
  );

  const report = await linkAll.linkAllBasecampProjects({
    dryRun: false,
    projects,
    archived,
  });
  assert.equal(report.ok, true);
  assert.equal(report.dryRun, false);
  assert.equal(report.archivedCatalog, "ok");
  assert.deepEqual(
    report.linked.map((row) => row.client),
    ["Pinnacle Roofing"]
  );
  assert.equal(report.linked[0].projectId, "1002");
  assert.equal(report.linked[0].clientId, pinnacle.id);
  assert.deepEqual(
    report.created.map((row) => row.client),
    ["Harbor Dental"]
  );
  assert.equal(report.created[0].projectId, "1003");
  const harbor = listRevClients(true).find((row) => row.id === report.created[0].clientId);
  assert.equal(harbor?.basecamp_project_id, "1003");
  assert.equal(harbor?.production_enrolled, 0);
  assert.equal(listRevClients(true).length, before + 1);
  assert.equal(
    listRevClients(true).find((row) => row.id === northwind.id)?.basecamp_project_id,
    "1001"
  );

  const ambiguousKinds = report.ambiguous.map((row) => row.kind).sort();
  assert.deepEqual(ambiguousKinds, [
    "name-already-linked",
    "several-clients",
    "several-projects",
  ]);
  const severalProjects = report.ambiguous.find((row) => row.kind === "several-projects");
  assert.deepEqual(severalProjects?.clients, ["Acme"]);
  assert.equal(severalProjects?.projects.length, 2);
  const severalClients = report.ambiguous.find((row) => row.kind === "several-clients");
  assert.deepEqual(severalClients?.clients.slice().sort(), ["Cedar Lane", "Cedar Lane, LLC"]);
  assert.equal(
    listRevClients(true).find((row) => row.id === acme.id)?.basecamp_project_id,
    ""
  );
  assert.equal(
    listRevClients(true).find((row) => row.id === cedar.id)?.basecamp_project_id,
    ""
  );
  assert.equal(
    listRevClients(true).find((row) => row.id === cedarLlc.id)?.basecamp_project_id,
    ""
  );

  assert.deepEqual(
    report.clientsWithoutProject.map((row) => row.client),
    ["LMX Health", "New Beginnings Recovery Inland Empire"]
  );
  assert.deepEqual(
    report.staleProjectLinks.map((row) => ({ client: row.client, status: row.status, projectId: row.projectId })),
    [
      { client: "Gone Shop", status: "missing", projectId: "777" },
      { client: "Old Shop", status: "archived", projectId: "555" },
    ]
  );
  assert.ok(report.skippedInternal.some((name) => name === "Empire Leadership HQ"));
  assert.ok(report.skippedPeople.some((name) => name === "Jack"));
  assert.match(report.summary, /Linked 1\. Created 1\./);
  assert.match(report.summary, /LMX Health/);
  assert.match(report.summary, /New Beginnings Recovery Inland Empire/);
  assert.match(report.summary, /Ambiguous:/);

  const tasks = getDb().prepare(`SELECT COUNT(*) AS n FROM forecast_tasks`).get() as { n: number };
  assert.equal(tasks.n, 0);
  assert.equal(linkAll.readLinkAllReport()?.created[0]?.client, "Harbor Dental");

  const again = await linkAll.linkAllBasecampProjects({
    dryRun: false,
    projects,
    archived,
  });
  assert.equal(again.skipped, true);
  assert.equal(again.linked.length, 0);
  assert.equal(again.created.length, 0);
  assert.equal(listRevClients(true).length, before + 1);
  assert.match(again.summary, /Nothing new to link/);
  assert.equal(linkAll.readLinkAllReport()?.skipped, true);
});
