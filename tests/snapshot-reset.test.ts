import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mondayOf } from "../src/lib/week";

test("snapshot progress reset", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-snap-reset-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const { closeDbForTests } = await import("../src/lib/db");
  closeDbForTests();

  const snapshot = await import("../src/lib/snapshot");
  const { getDb, nowIso } = await import("../src/lib/db");

  t.after(() => {
    closeDbForTests();
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const now = nowIso();
  const week = mondayOf(new Date("2026-08-26"));
  const db = getDb();

  db.prepare(
    `INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`
  ).run("c_allow", "Guardian Plumbers", now, now);
  db.prepare(
    `INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`
  ).run("c_other", "Sierra Sprinkler", now, now);

  const allowDeliverable = snapshot.createDeliverable({
    clientId: "c_allow",
    category: "Email",
    name: "Newsletter",
    cadence: "Weekly",
    cadenceUnit: "weekly",
  });
  const otherDeliverable = snapshot.createDeliverable({
    clientId: "c_other",
    category: "SEO",
    name: "Blog posts",
    cadence: "Monthly",
    cadenceUnit: "monthly",
  });

  snapshot.upsertEntry({
    deliverableId: allowDeliverable.id,
    weekStart: week,
    status: "completed",
    workDone: "Sent",
    loggedBy: "michael",
  });
  snapshot.addWin({ clientId: "c_allow", body: "Big launch" });
  snapshot.addLead({
    clientId: "c_allow",
    firstName: "Pat",
    receivedOn: "2026-08-26",
  });
  snapshot.upsertMetric({
    clientId: "c_allow",
    metric: "Revenue",
    period: "2026-08",
    value: 1200,
  });
  snapshot.upsertRevenueReport({
    clientId: "c_allow",
    month: "2026-07",
    amount: 9000,
  });
  db.prepare(
    `INSERT INTO snapshot_outreach
       (id, client_id, client_name, week_start, month, channel, am_slug, am_label,
        sent_to, provider_message_id, sent_at, delivered_at, opened_at, bounced_at,
        detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "out_1",
    "c_allow",
    "Guardian Plumbers",
    week,
    "2026-07",
    "email",
    "cassidy",
    "Cassidy",
    "owner@example.com",
    null,
    now,
    null,
    null,
    null,
    "Weekly snapshot ask",
    now
  );

  await t.test("clearSnapshotFillProgress dry run leaves rows intact", () => {
    const dry = snapshot.clearSnapshotFillProgress({ clientId: "c_allow", dryRun: true });
    assert.equal(dry.entries, 1);
    assert.equal(dry.revenueReports, 1);
    assert.equal(dry.outreach, 1);
    assert.equal(dry.deliverablesKept, 1);
    assert.equal(
      snapshot.weekData("c_allow", week).find((r) => r.deliverable_id === allowDeliverable.id)!
        .status,
      "completed"
    );
  });

  await t.test("clearSnapshotFillProgress wipes one account only", () => {
    const cleared = snapshot.clearSnapshotFillProgress({ clientId: "c_allow" });
    assert.equal(cleared.entries, 1);
    assert.equal(cleared.wins, 1);
    assert.equal(cleared.leads, 1);
    assert.equal(cleared.metrics, 1);
    assert.equal(cleared.revenueReports, 1);
    assert.equal(cleared.outreach, 1);

    const row = snapshot.weekData("c_allow", week).find(
      (r) => r.deliverable_id === allowDeliverable.id
    )!;
    assert.equal(row.status, "not_started");
    assert.equal(row.work_done, "");
    assert.equal(snapshot.listDeliverables("c_allow").length, 1);
    assert.equal(snapshot.listDeliverables("c_other").length, 1);
  });

  await t.test("resetSnapshotProgress defaults to allowlisted accounts", () => {
    snapshot.upsertEntry({
      deliverableId: otherDeliverable.id,
      weekStart: week,
      status: "in_progress",
      workDone: "Drafted",
      loggedBy: "michael",
    });

    const preview = snapshot.resetSnapshotProgress({ dryRun: true });
    assert.equal(preview.clients.length, 1);
    assert.equal(preview.clients[0]?.id, "c_allow");
    assert.equal(preview.deleted.entries, 0);

    const result = snapshot.resetSnapshotProgress();
    assert.equal(result.clients.length, 1);
    assert.equal(result.deleted.entries, 0);
    assert.equal(
      snapshot.weekData("c_other", week).find((r) => r.deliverable_id === otherDeliverable.id)!
        .work_done,
      "Drafted"
    );
  });

  await t.test("resetSnapshotProgress can target explicit client ids", () => {
    const result = snapshot.resetSnapshotProgress({
      allowlistedOnly: false,
      clientIds: ["c_other"],
    });
    assert.equal(result.clients.length, 1);
    assert.equal(result.deleted.entries, 1);
    assert.equal(
      snapshot.weekData("c_other", week).find((r) => r.deliverable_id === otherDeliverable.id)!
        .work_done,
      ""
    );
  });
});
