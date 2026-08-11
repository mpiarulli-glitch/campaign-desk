import assert from "node:assert/strict";
import test from "node:test";

// The board once labelled the 2026-08 page "July 2026" for anyone in a Pacific
// browser: the key is built from UTC midnight, and formatting it in local time
// walked back a day into the previous month. Removals then swept the month
// after the one on screen, because the label and the key had drifted apart.

import { currentPeriod, periodLabel, shiftPeriod } from "../src/lib/period";

test("a period key is labelled with its own month", () => {
  assert.equal(periodLabel("2026-08"), "August 2026");
  assert.equal(periodLabel("2026-01"), "January 2026");
  assert.equal(periodLabel("2026-12"), "December 2026");
});

test("this month is the business month, not the UTC one", () => {
  // 5pm Pacific on the last day of August. UTC has already turned over to
  // September; the team has not.
  assert.equal(currentPeriod(new Date("2026-09-01T00:00:00Z")), "2026-08");
  assert.equal(currentPeriod(new Date("2026-08-31T23:59:00Z")), "2026-08");
  // Mid-month is never in doubt.
  assert.equal(currentPeriod(new Date("2026-08-11T23:44:00Z")), "2026-08");
  // And Pacific midnight on the 1st does start the new month.
  assert.equal(currentPeriod(new Date("2026-09-01T07:00:00Z")), "2026-09");
});

test("shifting a period crosses years cleanly", () => {
  assert.equal(shiftPeriod("2026-08", 1), "2026-09");
  assert.equal(shiftPeriod("2026-12", 1), "2027-01");
  assert.equal(shiftPeriod("2026-01", -1), "2025-12");
});

test("the label round-trips every month of a year", () => {
  for (let m = 1; m <= 12; m++) {
    const key = `2026-${String(m).padStart(2, "0")}`;
    const label = periodLabel(key);
    assert.equal(
      new Date(`${label} 1 UTC`).getUTCMonth() + 1,
      m,
      `${key} labelled ${label}`
    );
  }
});
