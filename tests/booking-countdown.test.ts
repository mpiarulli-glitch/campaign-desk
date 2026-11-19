import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOKING_HOLD_MS,
  countdownAllowsBooking,
  formatCountdownClock,
  parseDeadline,
  readHoldStartedAt,
  resolveBookingCountdown,
} from "../src/lib/booking-countdown";

const START = 5_000_000;

test("the hold duration is one ten-minute constant", () => {
  assert.equal(BOOKING_HOLD_MS, 10 * 60 * 1000);
});

test("a fresh hold starts at 10:00 and remembers when it started", () => {
  const snap = resolveBookingCountdown({ now: START, storedStartedAt: null });
  assert.equal(snap.mode, "hold");
  assert.equal(snap.clock, "10:00");
  assert.equal(snap.expired, false);
  assert.equal(snap.remainingMs, BOOKING_HOLD_MS);
  assert.equal(snap.persistStartedAt, START);
  assert.equal(snap.label, "Your spot is held for");
  assert.equal(snap.announcement, "Your spot is held for 10 minutes.");
});

test("a refresh continues the same hold instead of starting over", () => {
  const first = resolveBookingCountdown({ now: START, storedStartedAt: null });
  const later = resolveBookingCountdown({
    now: START + 90_000,
    storedStartedAt: first.persistStartedAt,
  });
  assert.equal(later.clock, "8:30");
  assert.equal(later.persistStartedAt, START);
  assert.equal(later.expired, false);
  assert.equal(later.announcement, "Your spot is held for 9 minutes.");
});

test("the spoken minute stays put while the visible seconds move", () => {
  const at = (elapsed: number) =>
    resolveBookingCountdown({ now: START + elapsed, storedStartedAt: START });
  assert.equal(at(1_000).clock, "9:59");
  assert.equal(at(30_000).clock, "9:30");
  assert.equal(at(1_000).announcement, at(30_000).announcement);
  assert.equal(at(1_000).announcement, "Your spot is held for 10 minutes.");
  assert.notEqual(at(1_000).clock, at(30_000).clock);
  assert.equal(at(60_000).clock, "9:00");
  assert.equal(at(60_000).announcement, "Your spot is held for 9 minutes.");
});

test("zero shows the expired hold and does not hand out a new one", () => {
  const done = resolveBookingCountdown({
    now: START + BOOKING_HOLD_MS,
    storedStartedAt: START,
  });
  assert.equal(done.expired, true);
  assert.equal(done.clock, "0:00");
  assert.equal(done.remainingMs, 0);
  assert.equal(done.announcement, "This hold has ended. You can still book.");
  assert.equal(countdownAllowsBooking(done), true);

  const after = resolveBookingCountdown({
    now: START + BOOKING_HOLD_MS + 60_000,
    storedStartedAt: START,
  });
  assert.equal(after.expired, true);
  assert.equal(after.persistStartedAt, START);
  assert.equal(countdownAllowsBooking(after), true);
});

test("a stored start in the future or garbage does not extend the hold", () => {
  const future = resolveBookingCountdown({ now: START, storedStartedAt: START + 60_000 });
  assert.equal(future.startedAt, START);
  assert.equal(future.clock, "10:00");
  assert.equal(future.persistStartedAt, START);

  assert.equal(readHoldStartedAt(null), null);
  assert.equal(readHoldStartedAt(""), null);
  assert.equal(readHoldStartedAt("nope"), null);
  assert.equal(readHoldStartedAt("0"), null);
  assert.equal(readHoldStartedAt(String(START)), START);

  const fresh = resolveBookingCountdown({
    now: START,
    storedStartedAt: readHoldStartedAt("nope"),
  });
  assert.equal(fresh.persistStartedAt, START);
  assert.equal(fresh.clock, "10:00");
});

test("a real deadline wins over a stored hold", () => {
  const deadline = Date.parse("2026-11-17T20:00:00.000Z");
  const now = deadline - 90_000;
  const snap = resolveBookingCountdown({
    now,
    deadlineAt: deadline,
    storedStartedAt: now - 60_000,
  });
  assert.equal(snap.mode, "deadline");
  assert.equal(snap.clock, "1:30");
  assert.equal(snap.persistStartedAt, null);
  assert.equal(snap.label, "Booking closes in");
  assert.equal(snap.announcement, "Booking closes in 2 minutes.");
  assert.equal(snap.expired, false);
});

test("a deadline that has passed expires without blocking booking", () => {
  const now = Date.parse("2026-11-17T20:00:00.000Z");
  const snap = resolveBookingCountdown({ now, deadlineAt: now - 1 });
  assert.equal(snap.expired, true);
  assert.equal(snap.clock, "0:00");
  assert.equal(snap.announcement, "This deadline has passed. You can still book.");
  assert.equal(countdownAllowsBooking(snap), true);
});

test("deadline copy changes by the minute or hour, not every second", () => {
  const day = 2 * 86_400_000 + 3 * 3_600_000 + 4 * 60_000 + 5_000;
  const long = resolveBookingCountdown({ now: 0, deadlineAt: day });
  assert.equal(long.clock, "2d 3h 04m");
  assert.equal(long.announcement, "Booking closes in 2 days and 3 hours.");
  const still = resolveBookingCountdown({ now: 5_000, deadlineAt: day });
  assert.equal(still.announcement, long.announcement);

  const hour = resolveBookingCountdown({ now: 0, deadlineAt: 3_600_000 });
  assert.equal(hour.clock, "1:00:00");
  assert.equal(hour.announcement, "Booking closes in 1 hour.");
  const hourAndMin = resolveBookingCountdown({ now: 0, deadlineAt: 3_600_000 + 5 * 60_000 });
  assert.equal(hourAndMin.announcement, "Booking closes in 1 hour and 5 minutes.");
});

test("unparseable deadlines fall back to the hold", () => {
  assert.equal(parseDeadline(null), null);
  assert.equal(parseDeadline(""), null);
  assert.equal(parseDeadline("next tuesday"), null);
  assert.equal(parseDeadline(Number.NaN), null);
  assert.equal(parseDeadline(START), START);
  const iso = "2026-11-17T20:00:00.000Z";
  assert.equal(parseDeadline(iso), Date.parse(iso));

  const snap = resolveBookingCountdown({
    now: START,
    deadlineAt: parseDeadline("next tuesday"),
  });
  assert.equal(snap.mode, "hold");
  assert.equal(snap.clock, "10:00");
});

test("the clock formats leftover days, hours, and a bare minute:second", () => {
  assert.equal(formatCountdownClock(0), "0:00");
  assert.equal(formatCountdownClock(9_000), "0:09");
  assert.equal(formatCountdownClock(599_000), "9:59");
  assert.equal(formatCountdownClock(3_600_000 + 5_000), "1:00:05");
  assert.equal(formatCountdownClock(86_400_000), "1d 0h 00m");
});
