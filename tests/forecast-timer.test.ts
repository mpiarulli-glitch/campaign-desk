import assert from "node:assert/strict";
import test from "node:test";
import {
  blockHours,
  formatTracked,
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
