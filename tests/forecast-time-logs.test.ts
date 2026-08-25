import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Same cwd trick as the other db-backed suites: db.ts resolves its file at
// import time, so point it at a throwaway directory first.

test("forecast time logs stay on the day they were written", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-forecast-logs-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const forecast = await import("../src/lib/forecast");
  const { backfillForecastTimeLogs, getDb, nowIso } = await import("../src/lib/db");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await t.test("log on Monday, move to Tuesday: Monday still has the hours", () => {
    const task = forecast.createTask({
      person: "michael",
      taskDate: "2026-08-24",
      notes: "Unfinished outreach",
      hours: 2,
      startTime: "09:00",
    });
    const updated = forecast.recordTimeEntry(task.id, 1.5, "te_mon", "2026-08-24");
    assert.ok(updated);
    assert.equal(updated!.actual_hours, 1.5);
    assert.equal(updated!.basecamp_time_entry_id, "te_mon");

    forecast.updateTask(task.id, { taskDate: "2026-08-25" });

    assert.equal(forecast.loggedHoursOnDate("michael", "2026-08-24"), 1.5);
    assert.equal(forecast.loggedHoursOnDate("michael", "2026-08-25"), 0);
    assert.equal(forecast.loggedHoursForWeek("michael", "2026-08-24"), 1.5);

    const tuesday = forecast.listTasksForPersonWeek("michael", "2026-08-24");
    const moved = tuesday.find((row) => row.id === task.id);
    assert.ok(moved);
    assert.equal(moved!.task_date, "2026-08-25");
    assert.equal(moved!.actual_hours, 1.5);
    assert.equal(
      tuesday
        .filter((row) => row.task_date === "2026-08-25")
        .reduce((s, row) => s + row.hours, 0),
      2
    );
  });

  await t.test("a Tuesday log on the moved task counts on Tuesday, not Monday", () => {
    const task = forecast.createTask({
      person: "jack",
      taskDate: "2026-08-24",
      notes: "Two-day write",
      hours: 3,
      startTime: "10:00",
    });
    forecast.recordTimeEntry(task.id, 1, "te_a", "2026-08-24");
    forecast.updateTask(task.id, { taskDate: "2026-08-25" });
    forecast.recordTimeEntry(task.id, 2, "te_b", "2026-08-25");

    assert.equal(forecast.loggedHoursOnDate("jack", "2026-08-24"), 1);
    assert.equal(forecast.loggedHoursOnDate("jack", "2026-08-25"), 2);
    assert.equal(forecast.getTask(task.id)!.actual_hours, 3);
  });

  await t.test("hours logged this week stay in this week after a move to next week", () => {
    const task = forecast.createTask({
      person: "paula",
      taskDate: "2026-08-28",
      notes: "Friday leftover",
      hours: 1,
      startTime: "15:00",
    });
    forecast.recordTimeEntry(task.id, 1, "te_fri", "2026-08-28");
    forecast.updateTask(task.id, { taskDate: "2026-08-31" });

    assert.equal(forecast.loggedHoursForWeek("paula", "2026-08-24"), 1);
    assert.equal(forecast.loggedHoursForWeek("paula", "2026-08-31"), 0);
    assert.equal(forecast.loggedHoursOnDate("paula", "2026-08-28"), 1);
    assert.equal(forecast.loggedHoursOnDate("paula", "2026-08-31"), 0);
    assert.equal(forecast.listTasksForPersonWeek("paula", "2026-08-24").length, 0);
    assert.equal(forecast.listTasksForPersonWeek("paula", "2026-08-31")[0].id, task.id);
  });

  await t.test("backfill puts leftover actual_hours on the current task_date", () => {
    const db = getDb();
    const ts = nowIso();
    const task = forecast.createTask({
      person: "cassidy",
      taskDate: "2026-08-24",
      notes: "Already logged before the table existed",
      hours: 2,
      startTime: "11:00",
    });
    db.prepare(
      `UPDATE forecast_tasks SET actual_hours = ?, basecamp_time_entry_id = ?, updated_at = ? WHERE id = ?`
    ).run(2, "te_old", ts, task.id);

    assert.equal(forecast.loggedHoursOnDate("cassidy", "2026-08-24"), 0);

    const filled = backfillForecastTimeLogs(db);
    assert.equal(filled, 1);
    assert.equal(forecast.loggedHoursOnDate("cassidy", "2026-08-24"), 2);
    assert.equal(backfillForecastTimeLogs(db), 0);

    forecast.updateTask(task.id, { taskDate: "2026-08-25" });
    assert.equal(forecast.loggedHoursOnDate("cassidy", "2026-08-24"), 2);
    assert.equal(forecast.loggedHoursOnDate("cassidy", "2026-08-25"), 0);

    forecast.recordTimeEntry(task.id, 0.5, "te_new", "2026-08-25");
    assert.equal(forecast.loggedHoursOnDate("cassidy", "2026-08-24"), 2);
    assert.equal(forecast.loggedHoursOnDate("cassidy", "2026-08-25"), 0.5);
    assert.equal(forecast.getTask(task.id)!.actual_hours, 2.5);
  });

  await t.test("already-moved work without logs backfills onto the current date", () => {
    const db = getDb();
    const ts = nowIso();
    const task = forecast.createTask({
      person: "roy",
      taskDate: "2026-08-24",
      notes: "Moved before the fix",
      hours: 1,
      startTime: "13:00",
    });
    db.prepare(
      `UPDATE forecast_tasks SET actual_hours = ?, basecamp_time_entry_id = ?, updated_at = ? WHERE id = ?`
    ).run(1, "te_pre", ts, task.id);
    forecast.updateTask(task.id, { taskDate: "2026-08-25" });

    backfillForecastTimeLogs(db);
    assert.equal(forecast.loggedHoursOnDate("roy", "2026-08-24"), 0);
    assert.equal(forecast.loggedHoursOnDate("roy", "2026-08-25"), 1);
  });
});
