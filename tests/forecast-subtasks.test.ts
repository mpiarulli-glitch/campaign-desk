import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Same cwd trick as tests/forecast-meetings.test.ts: db.ts resolves its file at
// import time, so point it at a throwaway directory first.

test("subtask rows and time logged as the work happens", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-subtask-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const forecast = await import("../src/lib/forecast");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await t.test("a subtask keeps its own id and its parent to-do's", () => {
    const task = forecast.createTask({
      person: "michael",
      taskDate: "2026-08-24",
      client: "Humble Somm",
      notes: "SMS Texting › Send a2p application",
      hours: 1,
      basecampTodoId: "todo_4",
      basecampStepId: "step_9",
      basecampProjectId: "p1",
    });
    // Ticking the row flips the step; hours go to the parent, because a step
    // takes no timesheet entry of its own.
    assert.equal(task.basecamp_step_id, "step_9");
    assert.equal(task.basecamp_todo_id, "todo_4");
  });

  await t.test("a step id alone is dropped, since nothing could log against it", () => {
    const task = forecast.createTask({
      person: "michael",
      taskDate: "2026-08-24",
      client: "Humble Somm",
      notes: "Orphan subtask",
      hours: 1,
      basecampStepId: "step_10",
      basecampProjectId: "p1",
    });
    assert.equal(task.basecamp_step_id, "");
  });

  await t.test("booking a meeting never carries a step id either", () => {
    const task = forecast.createTask({
      person: "michael",
      taskDate: "2026-08-24",
      notes: "Leadership sync",
      hours: 1,
      basecampTodoId: "todo_4",
      basecampStepId: "step_9",
      basecampEventId: "ev_1",
    });
    assert.equal(task.basecamp_event_id, "ev_1");
    assert.equal(task.basecamp_todo_id, "");
    assert.equal(task.basecamp_step_id, "");
  });

  await t.test("logging time twice adds up instead of replacing", () => {
    const task = forecast.createTask({
      person: "michael",
      taskDate: "2026-08-25",
      client: "Humble Somm",
      notes: "Build the email",
      hours: 4,
      basecampTodoId: "todo_7",
      basecampProjectId: "p1",
    });
    // Half an hour this morning, two more after lunch, and the task is still
    // open the whole time.
    const first = forecast.recordTimeEntry(task.id, 0.5, "te_1")!;
    assert.equal(first.actual_hours, 0.5);
    assert.equal(first.completed, 0);

    const second = forecast.recordTimeEntry(task.id, 2, "te_2")!;
    assert.equal(second.actual_hours, 2.5);
    // Every entry Basecamp accepted is remembered, so nothing sent is lost.
    assert.equal(second.basecamp_time_entry_id, "te_1,te_2");
  });

  await t.test("the same entry id is never recorded twice", () => {
    const task = forecast.createTask({
      person: "michael",
      taskDate: "2026-08-26",
      client: "Humble Somm",
      notes: "Retry after a hiccup",
      hours: 1,
      basecampTodoId: "todo_8",
      basecampProjectId: "p1",
    });
    forecast.recordTimeEntry(task.id, 1, "te_5");
    const again = forecast.recordTimeEntry(task.id, 1, "te_5")!;
    assert.equal(again.basecamp_time_entry_id, "te_5");
    assert.equal(again.actual_hours, 2);
  });

  await t.test("recording against a task that's gone answers null", () => {
    assert.equal(forecast.recordTimeEntry("nope", 1, "te_9"), null);
  });
});

test("one timer at a time, and it keeps what it measured", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-timer-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const forecast = await import("../src/lib/forecast");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function make(notes: string) {
    return forecast.createTask({
      person: "michael",
      taskDate: "2026-08-24",
      client: "Humble Somm",
      notes,
      hours: 2,
    });
  }

  const t0 = Date.parse("2026-08-24T16:00:00.000Z");
  const minute = 60_000;

  await t.test("stopping banks the elapsed time", () => {
    const task = make("Build the email");
    forecast.startTimer("michael", task.id, t0);
    const stopped = forecast.stopTimer(task.id, t0 + 25 * minute)!;
    assert.equal(stopped.tracked_seconds, 25 * 60);
    assert.equal(stopped.timer_started_at, "");
  });

  await t.test("starting again adds to the total rather than restarting it", () => {
    const task = make("Second pass");
    forecast.startTimer("michael", task.id, t0);
    forecast.stopTimer(task.id, t0 + 10 * minute);
    forecast.startTimer("michael", task.id, t0 + 60 * minute);
    const after = forecast.stopTimer(task.id, t0 + 75 * minute)!;
    assert.equal(after.tracked_seconds, 25 * 60);
  });

  await t.test("starting a second task stops the first and says which", () => {
    const first = make("Morning work");
    const second = make("Afternoon work");
    forecast.startTimer("michael", first.id, t0);
    const { task, stopped } = forecast.startTimer("michael", second.id, t0 + 40 * minute);
    assert.equal(stopped?.id, first.id);
    // The task that gave way keeps every second it ran for.
    assert.equal(stopped?.tracked_seconds, 40 * 60);
    assert.equal(stopped?.timer_started_at, "");
    assert.equal(Boolean(task?.timer_started_at), true);
    assert.equal(forecast.runningTaskForPerson("michael")?.id, second.id);
    forecast.stopTimer(second.id, t0 + 41 * minute);
  });

  await t.test("starting a timer that's already running changes nothing", () => {
    const task = make("Already going");
    const started = forecast.startTimer("michael", task.id, t0);
    const again = forecast.startTimer("michael", task.id, t0 + 5 * minute);
    assert.equal(again.stopped, null);
    assert.equal(again.task?.timer_started_at, started.task?.timer_started_at);
    forecast.stopTimer(task.id, t0 + 5 * minute);
  });

  await t.test("stopping a timer that isn't running is harmless", () => {
    const task = make("Never started");
    const stopped = forecast.stopTimer(task.id, t0)!;
    assert.equal(stopped.tracked_seconds, 0);
    assert.equal(stopped.timer_started_at, "");
  });

  await t.test("somebody else's task can't be timed", () => {
    const task = make("Not yours");
    assert.deepEqual(forecast.startTimer("jack", task.id, t0), {
      task: null,
      stopped: null,
    });
  });
});
