import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Same cwd trick as tests/users.test.ts: db.ts resolves its file at import time,
// so point it at a throwaway directory first. One top-level test because tsx
// compiles to CJS here, where top-level await is unavailable.

test("booking a Basecamp meeting into the forecast", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-meet-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const events = await import("../src/lib/basecamp-events");
  const forecast = await import("../src/lib/forecast");
  const { getDb, nowIso } = await import("../src/lib/db");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // Two meetings on the same day: one listing Michael, one not.
  const insert = getDb().prepare(
    `INSERT INTO basecamp_events
       (id, project_id, client_id, client_name, project_name, title, event_date,
        starts_at, ends_at, all_day, participants, app_url, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insert.run("e1", "111", null, "", "MEG Internal", "Monday standup", "2026-08-03",
    "2026-08-03T16:00:00.000Z", "2026-08-03T16:30:00.000Z", 0,
    "Piarulli Michael, Jack Smith", "https://bc/e1", nowIso());
  insert.run("e2", "222", "cl_1", "Humble Somm", "Humble Somm", "Client check-in", "2026-08-03",
    "2026-08-03T18:00:00.000Z", "2026-08-03T19:30:00.000Z", 0,
    "Randi Jones", "https://bc/e2", nowIso());
  insert.run("e3", "111", null, "", "MEG Internal", "Company offsite", "2026-08-03",
    "2026-08-03", "2026-08-03", 1, "Piarulli Michael", "https://bc/e3", nowIso());

  await t.test("duration comes out in quarter hours", () => {
    const day = events.listEventsForDay("2026-08-03", ["Michael"]);
    const standup = [...day.mine, ...day.others].find((e) => e.id === "e1")!;
    const checkin = [...day.mine, ...day.others].find((e) => e.id === "e2")!;
    assert.equal(events.eventHours(standup), 0.5);
    assert.equal(events.eventHours(checkin), 1.5);
  });

  await t.test("all-day entries have no usable duration", () => {
    const day = events.listEventsForDay("2026-08-03", ["Michael"]);
    const offsite = [...day.mine, ...day.others].find((e) => e.id === "e3")!;
    assert.equal(events.eventHours(offsite), 0);
  });

  await t.test("a person's own meetings are split from everyone else's", () => {
    const day = events.listEventsForDay("2026-08-03", ["Michael", "michael"]);
    assert.deepEqual(day.mine.map((e) => e.id).sort(), ["e1", "e3"]);
    assert.deepEqual(day.others.map((e) => e.id), ["e2"]);
  });

  await t.test("participant matching handles full names and slugs", () => {
    const day = events.listEventsForDay("2026-08-03", ["Randi"]);
    assert.deepEqual(day.mine.map((e) => e.id), ["e2"]);

    // A slug with an underscore still matches the surname in Basecamp.
    const bySlug = events.listEventsForDay("2026-08-03", ["mike_smith"]);
    assert.ok(bySlug.mine.some((e) => e.id === "e1"), "should match Jack Smith's surname");
  });

  await t.test("short fragments don't match everything", () => {
    // Two-letter noise must not sweep in every meeting.
    const day = events.listEventsForDay("2026-08-03", ["jo"]);
    assert.equal(day.mine.length, 0);
  });

  await t.test("another day returns nothing", () => {
    const day = events.listEventsForDay("2026-08-04", ["Michael"]);
    assert.equal(day.mine.length + day.others.length, 0);
  });

  await t.test("a meeting task stores the event and never a todo", () => {
    const task = forecast.createTask({
      person: "michael",
      taskDate: "2026-08-03",
      notes: "Monday standup",
      hours: 0.5,
      startTime: "09:00",
      basecampEventId: "e1",
    });
    assert.equal(task.basecamp_event_id, "e1");
    assert.equal(task.basecamp_todo_id, "");
    assert.equal(task.start_time, "09:00");
    // No client is required for an internal meeting.
    assert.equal(task.client, "");
  });

  await t.test("given both, the meeting wins and the todo link is dropped", () => {
    // Otherwise ticking off a meeting could close an unrelated Basecamp todo.
    const task = forecast.createTask({
      person: "michael",
      taskDate: "2026-08-03",
      notes: "Ambiguous row",
      hours: 1,
      startTime: "10:00",
      basecampEventId: "e1",
      basecampTodoId: "should-be-ignored",
    });
    assert.equal(task.basecamp_event_id, "e1");
    assert.equal(task.basecamp_todo_id, "");
  });

  await t.test("a normal work task is unaffected", () => {
    const task = forecast.createTask({
      person: "michael",
      taskDate: "2026-08-03",
      client: "Humble Somm",
      notes: "Build the August email",
      hours: 3,
      startTime: "13:00",
      basecampTodoId: "todo_9",
      basecampProjectId: "222",
    });
    assert.equal(task.basecamp_todo_id, "todo_9");
    assert.equal(task.basecamp_event_id, "");
  });

  await t.test("a task can be created without a start time", () => {
    const task = forecast.createTask({
      person: "michael",
      taskDate: "2026-08-03",
      client: "Humble Somm",
      notes: "No clock time yet",
      hours: 1,
      startTime: "",
    });
    assert.equal(task.start_time, "");
  });

  await t.test("clearing a start time unschedules the task", () => {
    const task = forecast.createTask({
      person: "michael",
      taskDate: "2026-08-03",
      client: "Humble Somm",
      notes: "Later",
      hours: 1,
      startTime: "09:00",
    });
    const updated = forecast.updateTask(task.id, { startTime: "" });
    assert.equal(updated?.start_time, "");
  });
});
