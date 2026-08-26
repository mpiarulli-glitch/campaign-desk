import assert from "node:assert/strict";
import test from "node:test";
import {
  blockHours,
  formatTracked,
  hasTimesheetDestination,
  hoursToOffer,
  isForecastMeeting,
  isRunning,
  meetingNeedsCalendar,
  runningSeconds,
  shouldAskToLogOnComplete,
  trackedHours,
  trackedSeconds,
} from "../src/lib/forecast-timer";

const START = "2026-08-21T17:00:00.000Z";
const startMs = Date.parse(START);

test("a stopped task counts only what it banked", () => {
  const task = { tracked_seconds: 900, timer_started_at: "" };
  assert.equal(isRunning(task), false);
  assert.equal(runningSeconds(task, startMs + 60_000), 0);
  assert.equal(trackedSeconds(task, startMs + 60_000), 900);
  assert.equal(trackedHours(task, startMs + 60_000), 0.25);
});

test("a running task adds the live segment to what it banked", () => {
  const task = { tracked_seconds: 900, timer_started_at: START };
  assert.equal(isRunning(task), true);
  assert.equal(trackedSeconds(task, startMs + 30 * 60_000), 900 + 1800);
  assert.equal(trackedHours(task, startMs + 30 * 60_000), 0.75);
});

test("a clock that has moved backwards never takes time off", () => {
  const task = { tracked_seconds: 600, timer_started_at: START };
  assert.equal(trackedSeconds(task, startMs - 60_000), 600);
});

test("an unparseable start is treated as nothing running", () => {
  const task = { tracked_seconds: 600, timer_started_at: "whenever" };
  assert.equal(trackedSeconds(task, startMs), 600);
});

test("a block grows past its estimate but never shrinks below it", () => {
  // Two hours planned, twenty minutes in: still draws as the two hours booked.
  const early = { hours: 2, tracked_seconds: 1200, timer_started_at: "" };
  assert.equal(blockHours(early, startMs), 2);
  // Two hours planned, three hours spent: draws as the three it took.
  const over = { hours: 2, tracked_seconds: 3600 * 3, timer_started_at: "" };
  assert.equal(blockHours(over, startMs), 3);
  // Still running, and already past the estimate.
  const running = { hours: 1, tracked_seconds: 3600, timer_started_at: START };
  assert.equal(blockHours(running, startMs + 30 * 60_000), 1.5);
});

test("the clock reads with seconds while running and without once stopped", () => {
  assert.equal(formatTracked(3849, true), "1:04:09");
  assert.equal(formatTracked(249, true), "4:09");
  assert.equal(formatTracked(3849, false), "1h 04m");
  assert.equal(formatTracked(3600, false), "1h");
  assert.equal(formatTracked(249, false), "4m");
  assert.equal(formatTracked(-5, false), "0m");
});

/* ------------------------------- what to offer when logging / when to ask */

const untimed = { tracked_seconds: 0, timer_started_at: "" };

test("an untimed task offers its estimate the first time", () => {
  assert.equal(
    hoursToOffer({ ...untimed, hours: 2, actual_hours: 0, basecamp_time_entry_id: "" }, startMs),
    "2"
  );
});

test("measured time beats the estimate once the timer has run", () => {
  // 45 minutes on the clock against a two-hour estimate: offer what it took.
  assert.equal(
    hoursToOffer(
      { tracked_seconds: 2700, timer_started_at: "", hours: 2, actual_hours: 0, basecamp_time_entry_id: "" },
      startMs
    ),
    "0.75"
  );
});

test("a running timer's live segment counts toward the offer", () => {
  assert.equal(
    hoursToOffer(
      { tracked_seconds: 0, timer_started_at: START, hours: 2, actual_hours: 0, basecamp_time_entry_id: "" },
      startMs + 30 * 60_000
    ),
    "0.5"
  );
});

test("hours already sent are subtracted, so a second log can't double-count", () => {
  // Two hours measured, half an hour already on the timesheet.
  assert.equal(
    hoursToOffer(
      { tracked_seconds: 7200, timer_started_at: "", hours: 3, actual_hours: 0.5, basecamp_time_entry_id: "te_1" },
      startMs
    ),
    "1.5"
  );
});

test("unlinked work still asks to log, even with no hours outstanding", () => {
  const unlinked = {
    ...untimed,
    hours: 1,
    actual_hours: 0,
    basecamp_time_entry_id: "",
    basecamp_todo_id: "",
    basecamp_event_id: "",
    basecamp_project_id: "",
  };
  assert.equal(hasTimesheetDestination(unlinked), false);
  assert.equal(shouldAskToLogOnComplete(unlinked, startMs), true);
  // Project-only is already a destination: a shadow todo can be created.
  assert.equal(
    hasTimesheetDestination({ ...unlinked, basecamp_project_id: "28110364" }),
    true
  );
  assert.equal(
    shouldAskToLogOnComplete(
      { ...unlinked, basecamp_project_id: "28110364" },
      startMs
    ),
    true
  );
  // Linked and already sent: do not nag.
  assert.equal(
    shouldAskToLogOnComplete(
      {
        ...untimed,
        hours: 1,
        actual_hours: 1,
        basecamp_time_entry_id: "te_1",
        basecamp_todo_id: "todo_1",
        basecamp_event_id: "",
        basecamp_project_id: "28110364",
      },
      startMs
    ),
    false
  );
});

test("a typed meeting is not a timesheet destination until it is on the calendar", () => {
  const typed = {
    ...untimed,
    hours: 0.5,
    actual_hours: 0,
    basecamp_time_entry_id: "",
    kind: "meeting" as const,
    basecamp_todo_id: "",
    basecamp_event_id: "",
    basecamp_project_id: "28110364",
  };
  assert.equal(isForecastMeeting(typed), true);
  assert.equal(meetingNeedsCalendar(typed), true);
  // Project id alone would otherwise invent a shadow todo. Completing has to
  // ask for the client and write a calendar entry instead.
  assert.equal(hasTimesheetDestination(typed), false);
  assert.equal(shouldAskToLogOnComplete(typed, startMs), true);

  const booked = { ...typed, basecamp_event_id: "e1" };
  assert.equal(meetingNeedsCalendar(booked), false);
  assert.equal(hasTimesheetDestination(booked), true);
});

test("nothing outstanding offers nothing, which is also the signal not to ask", () => {
  // Everything measured has been sent.
  assert.equal(
    hoursToOffer(
      { tracked_seconds: 3600, timer_started_at: "", hours: 1, actual_hours: 1, basecamp_time_entry_id: "te_1" },
      startMs
    ),
    ""
  );
  // Never timed, but hours were logged by hand — asking again would be a nag.
  assert.equal(
    hoursToOffer({ ...untimed, hours: 2, actual_hours: 2, basecamp_time_entry_id: "te_1" }, startMs),
    ""
  );
});

/* -------------------------------- two timers at once, not unlimited */

test("up to two timers can run at once for the same person", async (t) => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-forecast-timer-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const forecast = await import("../src/lib/forecast");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function task(person: string, notes: string) {
    return forecast.createTask({
      person,
      taskDate: "2026-08-24",
      notes,
      hours: 1,
    });
  }

  const t0 = Date.parse("2026-08-24T17:00:00.000Z");

  await t.test("starting a second timer leaves the first running", () => {
    const a = task("michael", "First");
    const b = task("michael", "Second");
    const first = forecast.startTimer("michael", a.id, t0);
    const second = forecast.startTimer("michael", b.id, t0 + 60_000);

    assert.equal(second.stopped, null);
    const running = forecast.runningTasksForPerson("michael");
    assert.equal(running.length, 2);
    assert.ok(running.some((row) => row.id === a.id && row.timer_started_at));
    assert.ok(running.some((row) => row.id === b.id && row.timer_started_at));
    assert.equal(forecast.getTask(a.id)?.tracked_seconds, 0);
    assert.ok(first.task?.timer_started_at);
  });

  await t.test("starting a third banks the oldest and starts the new one", () => {
    const c = task("michael", "Third");
    const third = forecast.startTimer("michael", c.id, t0 + 5 * 60_000);

    assert.equal(third.stopped?.notes, "First");
    assert.equal(third.stopped?.timer_started_at, "");
    // Five minutes on the first timer, then it was banked.
    assert.equal(third.stopped?.tracked_seconds, 300);

    const running = forecast.runningTasksForPerson("michael");
    assert.equal(running.length, 2);
    assert.deepEqual(
      running.map((row) => row.notes).sort(),
      ["Second", "Third"]
    );
    assert.equal(forecast.getTask(c.id)?.timer_started_at, new Date(t0 + 5 * 60_000).toISOString());
  });

  await t.test("another person's timers are a separate pair", () => {
    const other = task("paula", "Paula's task");
    const started = forecast.startTimer("paula", other.id, t0);
    assert.equal(started.stopped, null);
    assert.equal(forecast.runningTasksForPerson("paula").length, 1);
    assert.equal(forecast.runningTasksForPerson("michael").length, 2);
  });

  await t.test("stopping one of two leaves the other running", () => {
    const before = forecast.runningTasksForPerson("michael");
    const keep = before.find((row) => row.notes === "Third");
    const stop = before.find((row) => row.notes === "Second");
    assert.ok(keep && stop);
    forecast.stopTimer(stop.id, t0 + 6 * 60_000);
    const running = forecast.runningTasksForPerson("michael");
    assert.equal(running.length, 1);
    assert.equal(running[0].id, keep.id);
  });
});
