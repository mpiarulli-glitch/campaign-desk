import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BACKFILL_WEEK_COUNT,
  backfillColumns,
  backfillWeekRange,
  isPeriodAnchorWeek,
  resolveBackfillCell,
  type BackfillEntryMap,
} from "../src/lib/snapshot-backfill";
import { addWeeks } from "../src/lib/week";

test("backfillWeekRange returns 26 weeks ending at current week", () => {
  const end = "2026-08-24";
  const weeks = backfillWeekRange(end, BACKFILL_WEEK_COUNT);
  assert.equal(weeks.length, 26);
  assert.equal(weeks[weeks.length - 1], end);
  assert.equal(weeks[0], addWeeks(end, -25));
});

test("backfillColumns labels each week", () => {
  const weeks = ["2026-08-04", "2026-08-11"];
  const cols = backfillColumns(weeks);
  assert.equal(cols.length, 2);
  assert.equal(cols[0].week_start, "2026-08-04");
  assert.match(cols[0].label, /Aug/);
  assert.equal(cols[0].month_key, "2026-08");
});

test("isPeriodAnchorWeek respects cadence", () => {
  assert.equal(isPeriodAnchorWeek("recurring", "weekly", "2026-03-02", null, false), true);
  assert.equal(
    isPeriodAnchorWeek("recurring", "monthly", "2026-03-02", null, false),
    true,
    "first column is always an anchor"
  );
  assert.equal(
    isPeriodAnchorWeek("recurring", "monthly", "2026-03-09", "2026-03-02", false),
    false,
    "same month, not an anchor"
  );
  assert.equal(
    isPeriodAnchorWeek("recurring", "monthly", "2026-04-06", "2026-03-30", false),
    true,
    "new month is an anchor"
  );
  assert.equal(
    isPeriodAnchorWeek("one_time", "monthly", "2026-03-02", null, false),
    false,
    "one-time only editable on last week"
  );
  assert.equal(
    isPeriodAnchorWeek("one_time", "monthly", "2026-08-25", "2026-08-18", true),
    true
  );
});

test("resolveBackfillCell reads weekly, monthly, and one-time entries", () => {
  const entries: BackfillEntryMap = new Map([
    [
      "d-weekly",
      [
        {
          week_start: "2026-03-02",
          status: "completed",
          work_done: "Week one",
          next_steps: "",
          notes: "",
          logged_by: "meg",
          updated_at: "t1",
        },
      ],
    ],
    [
      "d-monthly",
      [
        {
          week_start: "2026-03-16",
          status: "in_progress",
          work_done: "March work",
          next_steps: "",
          notes: "",
          logged_by: "meg",
          updated_at: "t2",
        },
      ],
    ],
  ]);

  const weekly = resolveBackfillCell(
    "recurring",
    "weekly",
    "2026-03-02",
    entries,
    "d-weekly"
  );
  assert.equal(weekly.status, "completed");
  assert.equal(weekly.work_done, "Week one");

  const monthly = resolveBackfillCell(
    "recurring",
    "monthly",
    "2026-03-23",
    entries,
    "d-monthly"
  );
  assert.equal(monthly.status, "in_progress");
  assert.equal(monthly.work_done, "March work");

  const oneTime = resolveBackfillCell(
    "one_time",
    "monthly",
    "2026-03-02",
    entries,
    "d-onetime",
    {
      status: "approved",
      work_done: "Setup done",
      next_steps: "",
      notes: "",
      logged_by: "kyle",
      updated_at: "t3",
    }
  );
  assert.equal(oneTime.status, "approved");
});

test("backfillGridData and upsertEntry across past weeks", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-backfill-test-"));
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
    .run("c1", "Backfill Client", now, now);

  const weekly = snapshot.createDeliverable({
    clientId: "c1",
    category: "Email",
    name: "Weekly newsletter",
    cadence: "1 per week",
    cadenceUnit: "weekly",
  });
  const monthly = snapshot.createDeliverable({
    clientId: "c1",
    category: "SEO",
    name: "Blog post",
    cadence: "2 per month",
    cadenceUnit: "monthly",
  });

  const END = "2026-08-24";
  const OLD = addWeeks(END, -20);

  snapshot.upsertEntry({
    deliverableId: weekly.id,
    weekStart: OLD,
    status: "completed",
    workDone: "Old week",
  });
  snapshot.upsertEntry({
    deliverableId: monthly.id,
    weekStart: "2026-07-06",
    status: "completed",
    workDone: "July blog",
  });

  const grid = snapshot.backfillGridData("c1", { endWeek: END, weekCount: 26 });
  assert.equal(grid.weeks.length, 26);

  const wRow = grid.rows.find((r) => r.deliverable_id === weekly.id)!;
  const oldCell = wRow.cells.find((c) => c.week_start === OLD)!;
  assert.equal(oldCell.status, "completed");
  assert.equal(oldCell.work_done, "Old week");
  assert.equal(oldCell.editable, true);

  const mRow = grid.rows.find((r) => r.deliverable_id === monthly.id)!;
  const julyCells = mRow.cells.filter((c) => c.period_start === "2026-07-01");
  const julyAnchor = julyCells.find((c) => c.editable);
  const julyMirror = julyCells.find((c) => !c.editable);
  assert.ok(julyAnchor, "expected an editable July anchor cell");
  assert.equal(julyAnchor?.status, "completed");
  assert.ok(julyMirror, "expected a mirrored July cell");
  assert.equal(julyMirror?.status, "completed");

  const targetWeek = "2026-06-01";
  const d = snapshot.createDeliverable({
    clientId: "c1",
    category: "Email",
    name: "Weekly send",
    cadence: "1 per week",
    cadenceUnit: "weekly",
  });
  snapshot.upsertEntry({
    deliverableId: d.id,
    weekStart: targetWeek,
    loggedFor: targetWeek,
    status: "completed",
    workDone: "Backfilled",
  });

  const grid2 = snapshot.backfillGridData("c1", { endWeek: END, weekCount: 26 });
  const row = grid2.rows.find((r) => r.deliverable_id === d.id)!;
  const cell = row.cells.find((c) => c.week_start === targetWeek)!;
  assert.equal(cell.status, "completed");
  assert.equal(cell.work_done, "Backfilled");
});
