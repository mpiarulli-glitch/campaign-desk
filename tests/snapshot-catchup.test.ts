import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  catchUpPeriodLabel,
  catchUpPeriods,
  catchUpSummary,
  firstDayMonthsBack,
} from "../src/lib/snapshot-catchup";

test("firstDayMonthsBack counts the current month", () => {
  assert.equal(firstDayMonthsBack(4, "2026-09-10"), "2026-06-01");
  assert.equal(firstDayMonthsBack(1, "2026-09-10"), "2026-09-01");
  assert.equal(firstDayMonthsBack(3, "2026-02-03"), "2025-12-01");
});

test("monthly catch-up is one period per month, not per meeting", () => {
  const periods = catchUpPeriods({
    kind: "recurring",
    unit: "monthly",
    fromYmd: "2026-06-01",
    toYmd: "2026-09-10",
    today: "2026-09-10",
  });
  assert.deepEqual(
    periods.map((p) => p.periodStart),
    ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"]
  );
  assert.match(catchUpSummary("monthly", periods), /4 months/);
});

test("weekly catch-up lists each due week", () => {
  const periods = catchUpPeriods({
    kind: "recurring",
    unit: "weekly",
    fromYmd: "2026-08-10",
    toYmd: "2026-08-28",
    today: "2026-08-28",
  });
  assert.deepEqual(
    periods.map((p) => p.periodStart),
    ["2026-08-10", "2026-08-17", "2026-08-24"]
  );
});

test("one-time has no catch-up periods", () => {
  assert.deepEqual(
    catchUpPeriods({
      kind: "one_time",
      unit: "monthly",
      fromYmd: "2026-06-01",
      toYmd: "2026-09-10",
    }),
    []
  );
});

test("catchUpPeriodLabel", () => {
  assert.equal(catchUpPeriodLabel("monthly", "2026-07-01"), "Jul 2026");
  assert.equal(catchUpPeriodLabel("quarterly", "2026-04-01"), "Q2 2026");
});

test("catchUpDeliverable fills missing months and skips already done", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-catchup-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const snapshot = await import("../src/lib/snapshot");
  const { getDb, nowIso } = await import("../src/lib/db");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const now = nowIso();
  getDb()
    .prepare(`INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run("c1", "HR Innovators", now, now);

  const meetings = snapshot.createDeliverable({
    clientId: "c1",
    category: "Paid ads",
    name: "Month ad meetings",
    cadence: "4 meetings / month",
    kind: "recurring",
    cadenceUnit: "monthly",
  });

  snapshot.upsertEntry({
    deliverableId: meetings.id,
    weekStart: "2026-07-06",
    loggedFor: "2026-07-06",
    status: "completed",
    workDone: "July meetings",
  });

  const result = snapshot.catchUpDeliverable({
    deliverableId: meetings.id,
    from: "2026-06-01",
    to: "2026-09-10",
    today: "2026-09-10",
    loggedBy: "michael",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.marked, 3, "Jun, Aug, Sep");
  assert.equal(result.skipped, 1, "July already complete");

  const rows = getDb()
    .prepare(
      `SELECT week_start, status FROM snapshot_entries WHERE deliverable_id = ? ORDER BY week_start`
    )
    .all(meetings.id) as Array<{ week_start: string; status: string }>;
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => r.status === "completed"));

  const oneOff = snapshot.createDeliverable({
    clientId: "c1",
    category: "Setup",
    name: "CRM",
    cadence: "One-time",
    kind: "one_time",
  });
  const blocked = snapshot.catchUpDeliverable({
    deliverableId: oneOff.id,
    from: "2026-06-01",
    to: "2026-09-10",
    today: "2026-09-10",
  });
  assert.deepEqual(blocked, { ok: false, error: "one_time" });
});
