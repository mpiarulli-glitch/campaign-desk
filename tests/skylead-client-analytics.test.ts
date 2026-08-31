import assert from "node:assert/strict";
import test from "node:test";
import {
  activityBetween,
  isLinkedInPreset,
  resolveLinkedInRange,
} from "../src/lib/skylead-client-analytics";

test("LinkedIn presets resolve to 30/60/90-day windows", () => {
  assert.equal(isLinkedInPreset("30d"), true);
  assert.equal(isLinkedInPreset("all"), true);
  assert.equal(isLinkedInPreset("1m"), false);

  const now = new Date("2026-08-31T15:00:00.000Z");
  assert.deepEqual(resolveLinkedInRange("30d", now), {
    days: 30,
    start: "2026-08-01",
    end: "2026-08-31",
  });
  assert.deepEqual(resolveLinkedInRange("60d", now), {
    days: 60,
    start: "2026-07-02",
    end: "2026-08-31",
  });
  assert.deepEqual(resolveLinkedInRange("90d", now), {
    days: 90,
    start: "2026-06-02",
    end: "2026-08-31",
  });
  assert.deepEqual(resolveLinkedInRange("all", now), {
    days: null,
    start: null,
    end: "2026-08-31",
  });
});

test("window activity subtracts cumulative Skylead snapshots", () => {
  const end = {
    captured_on: "2026-08-31",
    connections_requested: 500,
    accepted: 120,
    messages_sent: 200,
    replies: 40,
    acceptance_rate: 24,
    response_rate: 20,
  };
  const start = {
    captured_on: "2026-08-01",
    connections_requested: 400,
    accepted: 100,
    messages_sent: 150,
    replies: 30,
    acceptance_rate: 25,
    response_rate: 20,
  };

  const delta = activityBetween(end, start);
  assert.equal(delta.windowComplete, true);
  assert.equal(delta.connectionsRequested, 100);
  assert.equal(delta.accepted, 20);
  assert.equal(delta.messagesSent, 50);
  assert.equal(delta.replies, 10);
  assert.equal(delta.acceptanceRate, 20);
  assert.equal(delta.responseRate, 20);
  assert.equal(delta.baselineOn, "2026-08-01");
});

test("missing baseline falls back to lifetime counters", () => {
  const end = {
    captured_on: "2026-08-31",
    connections_requested: 500,
    accepted: 120,
    messages_sent: 200,
    replies: 40,
    acceptance_rate: 24,
    response_rate: 20,
  };
  const fallback = activityBetween(end, null);
  assert.equal(fallback.windowComplete, false);
  assert.equal(fallback.connectionsRequested, 500);
  assert.equal(fallback.accepted, 120);
  assert.equal(fallback.baselineOn, null);
});
