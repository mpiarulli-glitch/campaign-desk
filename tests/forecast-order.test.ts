import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Same cwd trick as the other db-backed suites: db.ts resolves its file at
// import time, so point it at a throwaway directory first.

test("forecast task order", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-forecast-order-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const forecast = await import("../src/lib/forecast");
  const { getDb, nowIso } = await import("../src/lib/db");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await t.test("new tasks append in the order they were added", () => {
    const first = forecast.createTask({
      person: "michael",
      taskDate: "2026-08-24",
      notes: "First",
      hours: 1,
      startTime: "14:00",
    });
    const second = forecast.createTask({
      person: "michael",
      taskDate: "2026-08-24",
      notes: "Second",
      hours: 1,
      startTime: "09:00",
    });
    const listed = forecast.listTasksForPersonWeek("michael", "2026-08-24");
    assert.deepEqual(
      listed.map((row) => row.notes),
      ["First", "Second"]
    );
    assert.ok(first.sort_order < second.sort_order);
  });

  await t.test("existing rows with the same sort_order still sort by start time", () => {
    const db = getDb();
    const ts = nowIso();
    db.prepare(
      `INSERT INTO forecast_tasks
         (id, person, task_date, client, notes, hours, start_time, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, '', ?, 1, ?, 0, ?, ?)`
    ).run("late", "jack", "2026-08-24", "Later start", "15:00", ts, ts);
    db.prepare(
      `INSERT INTO forecast_tasks
         (id, person, task_date, client, notes, hours, start_time, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, '', ?, 1, ?, 0, ?, ?)`
    ).run("early", "jack", "2026-08-24", "Earlier start", "09:00", ts, ts);

    const listed = forecast.listTasksForPersonWeek("jack", "2026-08-24");
    assert.deepEqual(
      listed.map((row) => row.notes),
      ["Earlier start", "Later start"]
    );
  });

  await t.test("reorderDayTasks keeps a custom order even when start times disagree", () => {
    const a = forecast.createTask({
      person: "paula",
      taskDate: "2026-08-25",
      notes: "A",
      hours: 1,
      startTime: "09:00",
    });
    const b = forecast.createTask({
      person: "paula",
      taskDate: "2026-08-25",
      notes: "B",
      hours: 1,
      startTime: "10:00",
    });
    const c = forecast.createTask({
      person: "paula",
      taskDate: "2026-08-25",
      notes: "C",
      hours: 1,
      startTime: "11:00",
    });

    assert.equal(forecast.reorderDayTasks("paula", "2026-08-25", [c.id, a.id, b.id]), true);
    const listed = forecast.listTasksForPersonWeek("paula", "2026-08-25");
    assert.deepEqual(
      listed.map((row) => row.notes),
      ["C", "A", "B"]
    );
  });

  await t.test("reorderDayTasks can move a task onto another day at a position", () => {
    const monday = forecast.createTask({
      person: "roy",
      taskDate: "2026-08-24",
      notes: "Monday only",
      hours: 1,
    });
    const tueFirst = forecast.createTask({
      person: "roy",
      taskDate: "2026-08-25",
      notes: "Tue first",
      hours: 1,
    });
    const tueSecond = forecast.createTask({
      person: "roy",
      taskDate: "2026-08-25",
      notes: "Tue second",
      hours: 1,
    });

    assert.equal(
      forecast.reorderDayTasks("roy", "2026-08-25", [tueFirst.id, monday.id, tueSecond.id]),
      true
    );
    const week = forecast.listTasksForPersonWeek("roy", "2026-08-24");
    assert.equal(week.find((row) => row.id === monday.id)?.task_date, "2026-08-25");
    assert.deepEqual(
      week.filter((row) => row.task_date === "2026-08-25").map((row) => row.notes),
      ["Tue first", "Monday only", "Tue second"]
    );
  });

  await t.test("reorderDayTasks refuses another person's task", () => {
    const mine = forecast.createTask({
      person: "lana",
      taskDate: "2026-08-24",
      notes: "Lana",
      hours: 1,
    });
    const theirs = forecast.createTask({
      person: "abel",
      taskDate: "2026-08-24",
      notes: "Abel",
      hours: 1,
    });
    assert.equal(forecast.reorderDayTasks("lana", "2026-08-24", [theirs.id, mine.id]), false);
  });
});
