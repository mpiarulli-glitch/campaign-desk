import assert from "node:assert/strict";
import test from "node:test";
import { appDateTime, nextWindow } from "../src/lib/cadence";
import type { RevClient } from "../src/lib/db";
import {
  BOOKING_SLOTS,
  durationAllowsStart,
  slotHasPassed,
} from "../src/lib/scheduling-rules";
import { productionRequestedCampfireContent } from "../src/lib/notify";

test("Pacific business date does not roll over with UTC", () => {
  assert.deepEqual(appDateTime(new Date("2026-07-28T00:30:00.000Z")), {
    date: "2026-07-27",
    time: "17:30",
  });
});

test("past and current start times are unavailable", () => {
  assert.equal(
    slotHasPassed("2026-07-26", "13:00", "2026-07-27", "08:30"),
    true
  );
  assert.equal(
    slotHasPassed("2026-07-27", "09:00", "2026-07-27", "09:00"),
    true
  );
  assert.equal(
    slotHasPassed("2026-07-27", "10:00", "2026-07-27", "09:00"),
    false
  );
});

test("four-hour and full-day starts remain inside operating hours", () => {
  assert.deepEqual(BOOKING_SLOTS, [
    "09:00",
    "10:00",
    "11:00",
    "12:00",
    "13:00",
  ]);
  assert.equal(durationAllowsStart("half", "13:00"), true);
  assert.equal(durationAllowsStart("half", "14:00"), false);
  assert.equal(durationAllowsStart("full", "09:00"), true);
  assert.equal(durationAllowsStart("full", "10:00"), false);
});

test("cadence advances to the next non-expired production window", () => {
  const client = {
    id: "test-client",
    active: 1,
    color_week: "purple",
    production_cadence: "monthly",
    last_production_date: null,
  } as RevClient;

  assert.deepEqual(nextWindow(client, "2026-07-27"), {
    start: "2026-07-27",
    end: "2026-07-31",
  });
});

test("production Campfire message includes safe details and a direct link", () => {
  const content = productionRequestedCampfireContent({
    clientName: "Example & Sons",
    sendDate: "2026-08-04",
    sendTime: "10:00",
    duration: "half",
    detailsUrl:
      "https://campaign-desk.example/admin/production/production-123",
    note: "Use loading dock <B>",
  });

  assert.match(content, /Production requested/);
  assert.match(content, /Example &amp; Sons/);
  assert.match(content, /2026-08-04 at 10:00/);
  assert.match(content, /4 hours/);
  assert.match(content, /Use loading dock &lt;B&gt;/);
  assert.match(
    content,
    /https:\/\/campaign-desk\.example\/admin\/production\/production-123/
  );
});
