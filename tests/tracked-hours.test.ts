import assert from "node:assert/strict";
import test from "node:test";
import {
  formatTrackedHours,
  trackedHoursFromForecast,
  trackedHoursSentence,
} from "../src/lib/tracked-hours";

test("tracked hours are the timesheet total plus SEO Ops actuals, once", () => {
  assert.equal(
    trackedHoursFromForecast({
      loggedByDate: { "2026-10-13": 3.25, "2026-10-14": 1 },
      syncTrackedHours: 0.5,
    }),
    4.75
  );
  assert.equal(formatTrackedHours(4.75), "4.8");
  assert.equal(formatTrackedHours(8), "8");
  assert.equal(formatTrackedHours(0), "0");
  assert.equal(formatTrackedHours(2.04), "2");
});

test("a week with no rows still counts as zero tracked hours", () => {
  assert.equal(trackedHoursFromForecast({ loggedByDate: {}, syncTrackedHours: 0 }), 0);
  assert.equal(trackedHoursSentence(0), "You've tracked 0 hours this week.");
  assert.equal(trackedHoursSentence(1), "You've tracked 1 hour this week.");
  assert.equal(trackedHoursSentence(12.5), "You've tracked 12.5 hours this week.");
});

test("missing forecast payload does not invent a total", () => {
  assert.equal(trackedHoursFromForecast(null), null);
});
