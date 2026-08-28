import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  defaultLoggedForDate,
  entryWeekStartForDate,
  loggedForTargetsOtherPeriod,
  periodStartFor,
} from "../src/lib/snapshot-entry-date";

test("entryWeekStartForDate maps calendar dates to storage keys", () => {
  assert.equal(
    entryWeekStartForDate("recurring", "weekly", "2026-08-15"),
    "2026-08-10",
    "mid-week Saturday → Monday of that week"
  );
  assert.equal(
    entryWeekStartForDate("recurring", "monthly", "2026-08-15"),
    "2026-08-01",
    "August date → August period"
  );
  assert.equal(
    entryWeekStartForDate("recurring", "quarterly", "2026-05-20"),
    "2026-04-01",
    "May date → Q2 start"
  );
  assert.equal(
    entryWeekStartForDate("one_time", "monthly", "2026-03-18"),
    "2026-03-16",
    "one-time uses week containing the date"
  );
});

test("defaultLoggedForDate prefers today inside the viewed week", () => {
  assert.equal(defaultLoggedForDate("2026-08-25", "2026-08-28"), "2026-08-28");
  assert.equal(defaultLoggedForDate("2026-08-04", "2026-08-28"), "2026-08-04");
});

test("loggedForTargetsOtherPeriod flags cross-period backdating", () => {
  assert.equal(
    loggedForTargetsOtherPeriod({
      kind: "recurring",
      cadence_unit: "monthly",
      viewWeek: "2026-08-25",
      loggedFor: "2026-07-10",
    }),
    true
  );
  assert.equal(
    loggedForTargetsOtherPeriod({
      kind: "recurring",
      cadence_unit: "monthly",
      viewWeek: "2026-08-25",
      loggedFor: "2026-08-20",
    }),
    false
  );
});

test("upsertEntry with loggedFor writes to the backdated period", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-backdate-test-"));
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
    .run("c1", "Client", now, now);

  const monthly = snapshot.createDeliverable({
    clientId: "c1",
    category: "Email",
    name: "Newsletter",
    cadence: "1/mo",
    cadenceUnit: "monthly",
  });
  const weekly = snapshot.createDeliverable({
    clientId: "c1",
    category: "Social",
    name: "Posts",
    cadence: "3/wk",
    cadenceUnit: "weekly",
  });

  const CURRENT_WEEK = "2026-08-25";

  snapshot.upsertEntry({
    deliverableId: monthly.id,
    weekStart: CURRENT_WEEK,
    loggedFor: "2026-07-14",
    status: "completed",
    workDone: "July send",
  });

  const julyPeriod = periodStartFor("monthly", "2026-07-14");
  const julyRow = getDb()
    .prepare(`SELECT week_start, status, work_done FROM snapshot_entries WHERE deliverable_id = ?`)
    .get(monthly.id) as { week_start: string; status: string; work_done: string };
  assert.equal(julyRow.week_start, julyPeriod);
  assert.equal(julyRow.status, "completed");
  assert.equal(julyRow.work_done, "July send");

  const augustView = snapshot.weekData("c1", CURRENT_WEEK).find((r) => r.deliverable_id === monthly.id)!;
  assert.equal(augustView.status, "not_started", "August period untouched on screen");

  snapshot.upsertEntry({
    deliverableId: weekly.id,
    weekStart: CURRENT_WEEK,
    loggedFor: "2026-08-13",
    status: "completed",
    workDone: "Wed posts",
  });

  const weekRow = getDb()
    .prepare(`SELECT week_start FROM snapshot_entries WHERE deliverable_id = ?`)
    .get(weekly.id) as { week_start: string };
  assert.equal(weekRow.week_start, "2026-08-10");

  const thatWeek = snapshot.weekData("c1", "2026-08-10").find((r) => r.deliverable_id === weekly.id)!;
  assert.equal(thatWeek.status, "completed");
  assert.equal(thatWeek.work_done, "Wed posts");
});
