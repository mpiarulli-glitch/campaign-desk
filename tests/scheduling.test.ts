import assert from "node:assert/strict";
import test from "node:test";
import {
  appDateTime,
  nextWindow,
  productionWindowForDate,
} from "../src/lib/cadence";
import type { RevClient } from "../src/lib/db";
import {
  BOOKING_SLOTS,
  durationAllowsStart,
  slotHasPassed,
} from "../src/lib/scheduling-rules";
import { productionRequestedCampfireContent } from "../src/lib/notify";
import {
  dayOfWeek,
  isBasecampFollowupDay,
  isEmailFollowupDay,
  scheduleCardContent,
  scheduleNudgeContent,
} from "../src/lib/reminders";

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
    videographerName: "Cassidy Merideth",
    sendDate: "2026-08-04",
    sendTime: "10:00",
    duration: "half",
    detailsUrl:
      "https://campaign-desk.example/admin/production/production-123",
    note: "Use loading dock <B>",
  });

  assert.match(content, /Production requested/);
  assert.match(content, /Example &amp; Sons/);
  assert.match(content, /@Cassidy Merideth/);
  assert.match(content, /2026-08-04 at 10:00/);
  assert.match(content, /4 hours/);
  assert.match(content, /Use loading dock &lt;B&gt;/);
  assert.match(
    content,
    /https:\/\/campaign-desk\.example\/admin\/production\/production-123/
  );
});

test("a date maps back to the production window it belongs to", () => {
  // Red publishes in the 2nd full week of August 2026 (Aug 10), so the shoot
  // week is Aug 3-7. Every day in it resolves to the same window.
  for (const day of ["2026-08-03", "2026-08-05", "2026-08-07"]) {
    assert.deepEqual(productionWindowForDate("red", day), {
      start: "2026-08-03",
      end: "2026-08-07",
    });
  }
  // Days either side belong to a different window, never this one.
  assert.notDeepEqual(productionWindowForDate("red", "2026-08-10"), {
    start: "2026-08-03",
    end: "2026-08-07",
  });
  // Weekends are in no window at all.
  assert.equal(productionWindowForDate("red", "2026-08-08"), null);
});

test("purple's window sits in the month before the one it belongs to", () => {
  // Purple publishes in the first full week of August (Aug 3), so it shoots
  // Jul 27-31. A late-July date has to resolve forward into August's window,
  // which is why the lookup checks neighbouring months.
  assert.deepEqual(productionWindowForDate("purple", "2026-07-29"), {
    start: "2026-07-27",
    end: "2026-07-31",
  });
});

test("an unset color week has no window to map onto", () => {
  assert.equal(productionWindowForDate("", "2026-08-05"), null);
});

test("client follow-ups land twice a week and never on a weekend", () => {
  // Mon 2026-08-03 through Sun 2026-08-09.
  const week = [
    "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06",
    "2026-08-07", "2026-08-08", "2026-08-09",
  ];
  const sending = week.filter(isEmailFollowupDay);
  assert.deepEqual(sending, ["2026-08-03", "2026-08-06"]);
  assert.ok(sending.length <= 2, "no more than two client emails a week");
  for (const day of ["2026-08-08", "2026-08-09"]) {
    assert.equal(isEmailFollowupDay(day), false, `${day} is a weekend`);
  }
});

test("Basecamp follow-ups land three times a week and never on a weekend", () => {
  const week = [
    "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06",
    "2026-08-07", "2026-08-08", "2026-08-09",
  ];
  const nudging = week.filter(isBasecampFollowupDay);
  assert.deepEqual(nudging, ["2026-08-03", "2026-08-05", "2026-08-07"]);
  assert.ok(nudging.length <= 3, "no more than three Basecamp nudges a week");
  for (const day of ["2026-08-08", "2026-08-09"]) {
    assert.equal(isBasecampFollowupDay(day), false, `${day} is a weekend`);
  }
});

test("no follow-up day falls on a weekend across a full month", () => {
  // Guards against someone editing the weekday arrays and reintroducing
  // weekend sends.
  for (let day = 1; day <= 31; day++) {
    const ymd = `2026-08-${String(day).padStart(2, "0")}`;
    const dow = dayOfWeek(ymd);
    if (dow !== 0 && dow !== 6) continue;
    assert.equal(isEmailFollowupDay(ymd), false, `${ymd} email`);
    assert.equal(isBasecampFollowupDay(ymd), false, `${ymd} Basecamp`);
  }
});

test("the Basecamp card is written to the client, not about them", () => {
  const client = { name: "Example & Sons", contact_name: "Dana" } as RevClient;
  const w = { start: "2026-08-17", end: "2026-08-21" };
  const { title, body } = scheduleCardContent(client, w, "https://desk.test/schedule/tok");

  assert.match(title, /schedule your next production/i);
  assert.match(body, /Hi Dana,/);
  assert.match(body, /your window set for/i);
  assert.match(body, /Monday, August 17 to Friday, August 21/);
  assert.match(body, /leave a comment on this card/i);
  assert.match(body, /https:\/\/desk\.test\/schedule\/tok/);
  // Second person only. Naming the client in the body would mean writing about
  // them on a card they can read.
  assert.doesNotMatch(body, /Example/);
});

test("a client name with markup cannot break out of the card HTML", () => {
  const client = { name: "A & B", contact_name: "<b>Dana</b>" } as RevClient;
  const { body } = scheduleCardContent(
    client,
    { start: "2026-08-17", end: "2026-08-21" },
    ""
  );
  assert.match(body, /&lt;b&gt;Dana&lt;\/b&gt;/);
  assert.doesNotMatch(body, /<b>Dana<\/b>/);
});

test("no contact name still opens politely", () => {
  const { body } = scheduleCardContent(
    { name: "Acme", contact_name: "" } as RevClient,
    { start: "2026-08-17", end: "2026-08-21" },
    ""
  );
  assert.match(body, /Hi there,/);
});

test("the follow-up nudge speaks to the client too", () => {
  const client = { name: "Example & Sons", contact_name: "Dana" } as RevClient;
  const w = { start: "2026-08-17", end: "2026-08-21" };

  const ahead = scheduleNudgeContent(client, w, "https://desk.test/s/t", "2026-08-04");
  assert.match(ahead, /Your production window opens in 13 days/);
  assert.match(ahead, /leave a comment/i);
  // The old copy read "<client> still hasn't booked", on the client's own card.
  assert.doesNotMatch(ahead, /Example/);
  assert.doesNotMatch(ahead, /still hasn't booked/i);
  assert.doesNotMatch(ahead, /\bThey\b|\bTheir\b/);

  const open = scheduleNudgeContent(client, w, "https://desk.test/s/t", "2026-08-18");
  assert.match(open, /Your production window is open now/);

  const oneDay = scheduleNudgeContent(client, w, "https://desk.test/s/t", "2026-08-16");
  assert.match(oneDay, /opens in 1 day,/);
});
