import assert from "node:assert/strict";
import test from "node:test";
import { resolveMissedAllocatedWindow } from "../src/lib/missed-production-window";

test("an expired extra invite is the missed window", () => {
  const missed = resolveMissedAllocatedWindow({
    today: "2026-08-18",
    openExtras: [{ start: "2026-08-10", end: "2026-08-14" }],
    askedWindows: [],
    bookedWindowStarts: [],
  });
  assert.deepEqual(missed, { start: "2026-08-10", end: "2026-08-14" });
});

test("a live extra invite is not treated as missed", () => {
  const missed = resolveMissedAllocatedWindow({
    today: "2026-08-12",
    openExtras: [{ start: "2026-08-10", end: "2026-08-14" }],
    askedWindows: [{ start: "2026-07-27", end: "2026-07-31" }],
    bookedWindowStarts: [],
  });
  assert.equal(missed, null);
});

test("a cadence ask whose week has ended without a booking is missed", () => {
  const missed = resolveMissedAllocatedWindow({
    today: "2026-08-18",
    openExtras: [],
    askedWindows: [{ start: "2026-08-10", end: "2026-08-14" }],
    bookedWindowStarts: [],
  });
  assert.deepEqual(missed, { start: "2026-08-10", end: "2026-08-14" });
});

test("a booked cadence window is not missed", () => {
  const missed = resolveMissedAllocatedWindow({
    today: "2026-08-18",
    openExtras: [],
    askedWindows: [{ start: "2026-08-10", end: "2026-08-14" }],
    bookedWindowStarts: ["2026-08-10"],
  });
  assert.equal(missed, null);
});
