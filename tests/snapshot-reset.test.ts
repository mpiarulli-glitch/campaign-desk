import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addWeeks, mondayOf } from "../src/lib/week";

test("clearSnapshotFillProgress", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-snap-reset-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const snapshot = await import("../src/lib/snapshot");
  const { getDb, nowIso } = await import("../src/lib/db");

  const now = nowIso();
  const week = mondayOf(new Date("2026-08-26"));

  getDb()
    .prepare(`INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run("c1", "Client One", now, now);
  getDb()
    .prepare(`INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run("c2", "Client Two", now, now);

  const d1 = snapshot.createDeliverable({
    clientId: "c1",
    category: "Email",
    name: "Newsletter",
    cadence: "Weekly",
    cadenceUnit: "weekly",
  });
  snapshot.createDeliverable({
    clientId: "c2",
    category: "SEO",
    name: "Blog posts",
    cadence: "Monthly",
    cadenceUnit: "monthly",
  });

  snapshot.upsertEntry({
    deliverableId: d1.id,
    weekStart: week,
    status: "completed",
    workDone: "Sent",
    loggedBy: "michael",
  });
  snapshot.addWin({ clientId: "c1", body: "Big launch" });
  snapshot.addLead({
    clientId: "c1",
    firstName: "Pat",
    receivedOn: "2026-08-26",
  });
  snapshot.upsertMetric({
    clientId: "c1",
    metric: "Revenue",
    period: "2026-08",
    value: 1200,
  });

  await t.test("dry run leaves rows intact", () => {
    const dry = snapshot.clearSnapshotFillProgress({ dryRun: true });
    assert.equal(dry.entries, 1);
    assert.equal(dry.deliverablesKept, 2);
    assert.equal(
      snapshot.weekData("c1", week).find((r) => r.deliverable_id === d1.id)!.status,
      "completed"
    );
  });

  await t.test("scoped clear wipes one account only", () => {
    const cleared = snapshot.clearSnapshotFillProgress({ clientId: "c1" });
    assert.equal(cleared.entries, 1);
    assert.equal(cleared.wins, 1);
    assert.equal(cleared.leads, 1);
    assert.equal(cleared.metrics, 1);
    assert.equal(cleared.deliverablesKept, 1);

    const row = snapshot.weekData("c1", week).find((r) => r.deliverable_id === d1.id)!;
    assert.equal(row.status, "not_started");
    assert.equal(row.work_done, "");
    assert.equal(snapshot.listWins("c1").length, 0);
    assert.equal(snapshot.listLeads("c1").length, 0);
    assert.equal(snapshot.listMetricsRaw("c1").length, 0);
    assert.equal(snapshot.listDeliverables("c1").length, 1);
    assert.equal(snapshot.listDeliverables("c2").length, 1);
  });

  await t.test("global clear removes remaining fill rows", () => {
    const d2 = snapshot.listDeliverables("c2")[0];
    snapshot.upsertEntry({
      deliverableId: d2.id,
      weekStart: week,
      status: "in_progress",
    });

    const result = snapshot.clearSnapshotFillProgress();
    assert.equal(result.entries, 1);
    assert.equal(result.deliverablesKept, 2);
    assert.equal(snapshot.weekData("c2", week)[0].status, "not_started");
  });
});
