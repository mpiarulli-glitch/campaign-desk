import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOKING_HOLD_MS,
  bookingHoldStorageKey,
  bookingHoldView,
  formatHoldClock,
  holdAnnouncement,
  readOrStartHold,
  type HoldStorage,
} from "../src/lib/booking-hold";

const START = 1_700_000_000_000;

function memoryStorage(initial: Record<string, string> = {}): HoldStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = value;
    },
  };
}

test("the hold lasts ten minutes, from one constant", () => {
  assert.equal(BOOKING_HOLD_MS, 10 * 60 * 1000);
  const fresh = bookingHoldView(START, START);
  assert.equal(fresh.expired, false);
  assert.equal(fresh.remainingMs, BOOKING_HOLD_MS);
  assert.equal(fresh.clock, "10:00");
  assert.equal(fresh.status, "Your spot is held for 10:00");
});

test("the clock ticks down by the second and stays non-negative", () => {
  assert.equal(formatHoldClock(BOOKING_HOLD_MS - 1000), "9:59");
  assert.equal(bookingHoldView(START, START + 1000).clock, "9:59");
  assert.equal(bookingHoldView(START, START + 90_000).clock, "8:30");
  assert.equal(bookingHoldView(START, START + 61_000).clock, "8:59");
  assert.equal(formatHoldClock(1), "0:01");
  assert.equal(formatHoldClock(0), "0:00");
  assert.equal(formatHoldClock(-5000), "0:00");
});

test("expiry is a gentle label and does not describe a block", () => {
  const atZero = bookingHoldView(START, START + BOOKING_HOLD_MS);
  assert.equal(atZero.expired, true);
  assert.equal(atZero.remainingMs, 0);
  assert.equal(atZero.clock, "0:00");
  assert.equal(atZero.status, "Hold expired, book now");
  assert.equal("blocked" in atZero, false);

  const after = bookingHoldView(START, START + BOOKING_HOLD_MS + 30_000);
  assert.equal(after.expired, true);
  assert.equal(after.remainingMs, 0);
  assert.equal(after.status, "Hold expired, book now");
});

test("the screen reader line changes by the minute, not every second", () => {
  assert.equal(holdAnnouncement(BOOKING_HOLD_MS), "Your spot is held for 10 minutes.");
  assert.equal(
    holdAnnouncement(BOOKING_HOLD_MS - 1000),
    "Your spot is held for 10 minutes."
  );
  assert.equal(holdAnnouncement(9 * 60 * 1000), "Your spot is held for 9 minutes.");
  assert.equal(holdAnnouncement(60_000), "Your spot is held for 1 minute.");
  assert.equal(holdAnnouncement(1), "Your spot is held for 1 minute.");
  assert.equal(holdAnnouncement(0), "Hold expired. You can still book now.");
  assert.equal(holdAnnouncement(-1), "Hold expired. You can still book now.");
});

test("a refresh keeps the original start instead of resetting the hold", () => {
  const key = bookingHoldStorageKey("/api/schedule/sample");
  const store = memoryStorage({ [key]: String(START) });
  const resumed = readOrStartHold(store, key, START + 90_000);
  assert.equal(resumed, START);
  assert.equal(store.data[key], String(START));
  assert.equal(bookingHoldView(resumed, START + 90_000).clock, "8:30");
});

test("an already-expired hold stays expired across a refresh", () => {
  const key = bookingHoldStorageKey("strategy-meeting:sample");
  const started = START - 11 * 60 * 1000;
  const store = memoryStorage({ [key]: String(started) });
  const resumed = readOrStartHold(store, key, START);
  assert.equal(resumed, started);
  const view = bookingHoldView(resumed, START);
  assert.equal(view.expired, true);
  assert.equal(view.status, "Hold expired, book now");
});

test("a missing, blank, or future timestamp starts the hold at now", () => {
  const key = bookingHoldStorageKey("new");
  const empty = memoryStorage();
  assert.equal(readOrStartHold(empty, key, START), START);
  assert.equal(empty.data[key], String(START));

  for (const bad of ["", "   ", "nope", "0", "-5", String(START + 5000)]) {
    const store = memoryStorage({ [key]: bad });
    assert.equal(readOrStartHold(store, key, START), START);
    assert.equal(store.data[key], String(START));
  }
});

test("storage failures still return a start time", () => {
  const broken: HoldStorage = {
    getItem() {
      throw new Error("sessionStorage blocked");
    },
    setItem() {
      throw new Error("sessionStorage blocked");
    },
  };
  assert.equal(readOrStartHold(broken, "k", START), START);
  assert.equal(readOrStartHold(null, "k", START), START);
});

test("storage keys stay scoped to the booking surface", () => {
  assert.equal(
    bookingHoldStorageKey("/api/schedule/sample"),
    "campaign-desk:booking-hold:/api/schedule/sample"
  );
  assert.notEqual(
    bookingHoldStorageKey("/api/schedule/sample"),
    bookingHoldStorageKey("/api/strategy-meeting/abc")
  );
});
