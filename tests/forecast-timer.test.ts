import assert from "node:assert/strict";
import test from "node:test";
import {
  blockHours,
  formatTracked,
  hoursToOffer,
  isRunning,
  runningSeconds,
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
