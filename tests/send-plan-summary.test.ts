import assert from "node:assert/strict";
import test from "node:test";
import { sendPlanSummary } from "../src/lib/send-plan-summary";

test("send plan summary names the count, the Pacific range, and how many are scheduled", () => {
  const times = [
    "2026-10-20T16:00:00.000Z",
    "2026-12-01T20:00:00.000Z",
    null,
    "",
  ];
  // 16:00Z on Oct 20 is 9:00 AM Pacific the same day.
  // 20:00Z on Dec 1 is 12:00 PM Pacific the same day.
  assert.equal(
    sendPlanSummary([...times, ...Array(16).fill(null)]),
    "20 sends · Oct 20 – Dec 1, 2026 · Pacific · 2 of 20 scheduled"
  );
});

test("a fully scheduled plan says all scheduled, and a single day drops the range", () => {
  assert.equal(
    sendPlanSummary(["2026-10-20", "2026-10-20"]),
    "2 sends · Oct 20, 2026 · Pacific · all scheduled"
  );
});

test("nothing scheduled stays useful without inventing a date", () => {
  assert.equal(
    sendPlanSummary([null, undefined, ""]),
    "3 sends · none scheduled · Pacific"
  );
  assert.equal(sendPlanSummary(["2026-11-02T16:00:00.000Z"]), "1 send · Nov 2, 2026 · Pacific · all scheduled");
});

test("a range that crosses a year names both years", () => {
  assert.equal(
    sendPlanSummary(["2026-12-20", "2027-01-04", null]),
    "3 sends · Dec 20, 2026 – Jan 4, 2027 · Pacific · 2 of 3 scheduled"
  );
});
