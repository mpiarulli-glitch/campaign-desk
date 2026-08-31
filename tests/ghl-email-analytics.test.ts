import assert from "node:assert/strict";
import test from "node:test";
import { resolveAnalyticsRange } from "../src/lib/ghl-email-analytics";

test("resolveAnalyticsRange maps presets from today", () => {
  const now = new Date("2026-08-31T15:00:00Z");
  assert.deepEqual(resolveAnalyticsRange("1m", null, null, now), {
    start: "2026-07-31",
    end: "2026-08-31",
  });
  assert.deepEqual(resolveAnalyticsRange("3m", null, null, now), {
    start: "2026-05-31",
    end: "2026-08-31",
  });
  assert.deepEqual(resolveAnalyticsRange("6m", null, null, now), {
    start: "2026-02-28",
    end: "2026-08-31",
  });
  assert.deepEqual(resolveAnalyticsRange("12m", null, null, now), {
    start: "2025-08-31",
    end: "2026-08-31",
  });
});

test("resolveAnalyticsRange accepts a custom inclusive window", () => {
  const now = new Date("2026-08-31T15:00:00Z");
  assert.deepEqual(resolveAnalyticsRange("custom", "2026-01-01", "2026-03-15", now), {
    start: "2026-01-01",
    end: "2026-03-15",
  });
  assert.throws(() => resolveAnalyticsRange("custom", "", "2026-03-15", now));
  assert.throws(() => resolveAnalyticsRange("custom", "2026-04-01", "2026-03-15", now));
});
