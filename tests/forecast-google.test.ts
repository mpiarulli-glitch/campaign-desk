import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-secret-for-token-encryption";
process.env.FORECAST_GOOGLE_CALENDAR = process.env.FORECAST_GOOGLE_CALENDAR || "1";
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "test-google-client-secret";
process.env.APP_TIME_ZONE = "America/Los_Angeles";

import {
  googleEventHasOtherAttendees,
  googleEventsAtSlot,
  mapGoogleEventToMeeting,
  shouldImportGoogleEvent,
  shouldPushToGoogle,
} from "../src/lib/forecast-google";
import type { GoogleCalendarEvent } from "../src/lib/google-calendar";

const CLIENTS = ["Humble Somm", "Krak Boba"];
const SELF = "michael@meg.example";

function timed(partial: Partial<GoogleCalendarEvent> & { id: string }): GoogleCalendarEvent {
  return {
    status: "confirmed",
    summary: "Client check-in",
    start: { dateTime: "2026-08-26T18:00:00.000Z" },
    end: { dateTime: "2026-08-26T18:30:00.000Z" },
    attendees: [
      { email: SELF, self: true, responseStatus: "accepted" },
      { email: "client@humble.example", responseStatus: "accepted" },
    ],
    ...partial,
  };
}

test("Google event → forecast mapping", () => {
  const opts = { selfEmail: SELF, clientNames: CLIENTS, timeZone: "America/Los_Angeles" };

  const imported = mapGoogleEventToMeeting(timed({ id: "g1" }), opts);
  assert.ok(imported);
  assert.equal(imported.googleEventId, "g1");
  assert.equal(imported.taskDate, "2026-08-26");
  assert.equal(imported.startTime, "11:00");
  assert.equal(imported.hours, 0.5);
  assert.equal(imported.notes, "Client check-in");

  assert.equal(
    shouldImportGoogleEvent(
      timed({
        id: "ooo",
        eventType: "outOfOffice",
        summary: "OOO",
      }),
      opts
    ),
    false
  );
  assert.equal(
    shouldImportGoogleEvent(
      timed({
        id: "allday",
        start: { date: "2026-08-26" },
        end: { date: "2026-08-27" },
      }),
      opts
    ),
    false
  );
  assert.equal(
    shouldImportGoogleEvent(
      timed({
        id: "declined",
        attendees: [
          { email: SELF, self: true, responseStatus: "declined" },
          { email: "client@humble.example" },
        ],
      }),
      opts
    ),
    false
  );
  assert.equal(
    shouldImportGoogleEvent(
      timed({
        id: "solo",
        summary: "Focus notes",
        attendees: [{ email: SELF, self: true, responseStatus: "accepted" }],
      }),
      opts
    ),
    false
  );
  const named = mapGoogleEventToMeeting(
    timed({
      id: "named",
      summary: "Humble Somm kickoff",
      attendees: [{ email: SELF, self: true }],
    }),
    opts
  );
  assert.ok(named);
  assert.equal(named.client, "Humble Somm");

  assert.equal(googleEventHasOtherAttendees(timed({ id: "g1" }), SELF), true);
  assert.equal(
    shouldPushToGoogle({
      kind: "meeting",
      from_google: 1,
      start_time: "11:00",
    }).ok,
    false
  );
  assert.equal(
    (shouldPushToGoogle({
      kind: "meeting",
      from_google: 1,
      start_time: "11:00",
    }) as { reason: string }).reason,
    "from-google"
  );
  assert.equal(shouldPushToGoogle({ kind: "work", start_time: "11:00" }).ok, false);
  assert.equal(shouldPushToGoogle({ kind: "meeting", start_time: "" }).ok, false);
  assert.equal(shouldPushToGoogle({ kind: "meeting", start_time: "11:00" }).ok, true);

  const hits = googleEventsAtSlot(
    [
      timed({ id: "g1" }),
      timed({ id: "g2", start: { dateTime: "2026-08-26T19:00:00.000Z" } }),
    ],
    "2026-08-26T18:00:00.000Z"
  );
  assert.deepEqual(hits.map((e) => e.id), ["g1"]);
});

test("Google Calendar pull, push skip, and disconnect", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-gcal-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const forecast = await import("../src/lib/forecast");
  const google = await import("../src/lib/forecast-google");
  const identity = await import("../src/lib/google-identity");
  const { getDb, nowIso } = await import("../src/lib/db");
  const { scheduleEntryTimes } = await import("../src/lib/forecast-time");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  identity.saveConnection({
    person: "michael",
    googleEmail: SELF,
    googleName: "Michael",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresIn: 3600,
  });

  getDb()
    .prepare(
      `INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`
    )
    .run("cl_1", "Humble Somm", nowIso(), nowIso());

  const listed: GoogleCalendarEvent[] = [
    timed({ id: "g-meet", summary: "Humble Somm weekly" }),
    timed({
      id: "g-dentist",
      summary: "Dentist",
      start: { dateTime: "2026-08-26T20:00:00.000Z" },
      end: { dateTime: "2026-08-26T20:30:00.000Z" },
      attendees: [
        { email: SELF, self: true, responseStatus: "accepted" },
        { email: "office@dentist.example" },
      ],
    }),
  ];

  let createdBodies: unknown[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || "GET").toUpperCase();
    if (url.includes("/calendars/primary/events") && method === "GET") {
      return new Response(JSON.stringify({ items: listed }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/calendars/primary/events") && method === "POST") {
      createdBodies.push(JSON.parse(String(init?.body || "{}")));
      return new Response(JSON.stringify({ id: "g-created" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/calendars/primary/events/") && method === "PATCH") {
      return new Response(JSON.stringify({ id: "g-created" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/calendars/primary/events/") && method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    return new Response("not mocked " + url, { status: 500 });
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = realFetch;
  });

  await t.test("a pull creates overlay rows and a second pull does not duplicate", async () => {
    const first = await google.pullGoogleMeetings("michael", "2026-08-24", "2026-08-31", {
      force: true,
    });
    assert.equal(first.ok, true);
    assert.equal(first.created, 2);
    const week = forecast.listTasksForPersonWeek("michael", "2026-08-24");
    const meet = week.find((r) => r.google_event_id === "g-meet");
    assert.ok(meet);
    assert.equal(meet.kind, "meeting");
    assert.equal(meet.from_google, 1);
    assert.equal(meet.google_managed, 0);
    assert.equal(meet.notes, "Humble Somm weekly");
    assert.equal(meet.client, "Humble Somm");
    assert.equal(meet.start_time, "11:00");

    const second = await google.pullGoogleMeetings("michael", "2026-08-24", "2026-08-31", {
      force: true,
    });
    assert.equal(second.ok, true);
    assert.equal(second.created, 0);
    assert.equal(
      forecast.listTasksForPersonWeek("michael", "2026-08-24").filter((r) => r.google_event_id)
        .length,
      2
    );
  });

  await t.test("an existing Forecast meeting at that slot is linked, not duplicated", async () => {
    const slot = forecast.createTask({
      person: "michael",
      taskDate: "2026-08-27",
      notes: "Ad hoc client call",
      hours: 0.5,
      startTime: "10:00",
      kind: "meeting",
    });
    listed.push(
      timed({
        id: "g-slot",
        summary: "Ad hoc client call",
        start: { dateTime: "2026-08-27T17:00:00.000Z" },
        end: { dateTime: "2026-08-27T17:30:00.000Z" },
      })
    );
    const pulled = await google.pullGoogleMeetings("michael", "2026-08-24", "2026-08-31", {
      force: true,
    });
    assert.ok(pulled.linked >= 1);
    const linked = forecast.getTask(slot.id);
    assert.equal(linked?.google_event_id, "g-slot");
    assert.equal(linked?.from_google, 0);
    assert.equal(
      forecast
        .listTasksForPersonWeek("michael", "2026-08-24")
        .filter((r) => r.google_event_id === "g-slot").length,
      1
    );
  });

  await t.test("push skips overlay rows that came from Google", async () => {
    createdBodies = [];
    const overlay = forecast
      .listTasksForPersonWeek("michael", "2026-08-24")
      .find((r) => r.google_event_id === "g-meet")!;
    const result = await google.pushForecastMeetingToGoogle(overlay);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.skipped, "from-google");
    assert.equal(createdBodies.length, 0);
  });

  await t.test("push skips work blocks and blank start times", async () => {
    const work = forecast.createTask({
      person: "michael",
      taskDate: "2026-08-26",
      notes: "Write this email",
      hours: 2,
      startTime: "13:00",
      kind: "work",
    });
    const blank = forecast.createTask({
      person: "michael",
      taskDate: "2026-08-26",
      notes: "Call later",
      hours: 0.5,
      startTime: "",
      kind: "meeting",
    });
    createdBodies = [];
    const workResult = await google.pushForecastMeetingToGoogle(work);
    const blankResult = await google.pushForecastMeetingToGoogle(blank);
    assert.equal(workResult.ok, true);
    if (workResult.ok) assert.equal(workResult.skipped, "not-a-meeting");
    assert.equal(blankResult.ok, true);
    if (blankResult.ok) assert.equal(blankResult.skipped, "blank-start");
    assert.equal(createdBodies.length, 0);
  });

  await t.test("push links an existing Google invite at that slot instead of creating", async () => {
    const times = scheduleEntryTimes({
      date: "2026-08-28",
      startTime: "14:00",
      hours: 0.5,
      timeZone: "America/Los_Angeles",
    });
    listed.push(
      timed({
        id: "g-already",
        summary: "Already on Google",
        start: { dateTime: times.startsAt },
        end: { dateTime: times.endsAt },
      })
    );
    const meeting = forecast.createTask({
      person: "michael",
      taskDate: "2026-08-28",
      notes: "Already on Google",
      hours: 0.5,
      startTime: "14:00",
      kind: "meeting",
    });
    createdBodies = [];
    const result = await google.pushForecastMeetingToGoogle(meeting);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.skipped, "existing-slot");
      assert.equal(result.eventId, "g-already");
    }
    assert.equal(createdBodies.length, 0);
    assert.equal(forecast.getTask(meeting.id)?.google_event_id, "g-already");
    assert.equal(forecast.getTask(meeting.id)?.google_managed, 0);
  });

  await t.test("push creates a Google event for a typed Forecast meeting", async () => {
    const meeting = forecast.createTask({
      person: "michael",
      taskDate: "2026-08-28",
      notes: "New Forecast call",
      hours: 1,
      startTime: "15:00",
      kind: "meeting",
    });
    createdBodies = [];
    const result = await google.pushForecastMeetingToGoogle(meeting);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.skipped, undefined);
      assert.equal(result.eventId, "g-created");
    }
    assert.equal(createdBodies.length, 1);
    const body = createdBodies[0] as { summary: string };
    assert.equal(body.summary, "New Forecast call");
    const saved = forecast.getTask(meeting.id);
    assert.equal(saved?.google_event_id, "g-created");
    assert.equal(saved?.google_managed, 1);
    assert.equal(saved?.from_google, 0);
  });

  await t.test("disconnect drops the Google connection", () => {
    assert.equal(identity.hasGoogleConnection("michael"), true);
    identity.disconnectGoogle("michael");
    assert.equal(identity.hasGoogleConnection("michael"), false);
    assert.equal(identity.getGoogleConnection("michael"), null);
  });

  await t.test("the Forecast page exposes Connect Google Calendar", () => {
    const src = fs.readFileSync(
      path.join(originalCwd, "src/app/admin/forecast/[person]/page.tsx"),
      "utf8"
    );
    assert.match(src, /Connect Google Calendar/);
    assert.match(src, /Refresh Google/);
    assert.match(src, /isGoogleOverlay/);
    assert.match(src, /next=forecast/);
  });
});

test("OAuth state binds a Google code to the person who started the flow", async () => {
  const { makeState, readState } = await import("../src/lib/google-oauth");
  const state = makeState("jack", "forecast");
  assert.deepEqual(readState(state), { person: "jack", returnTo: "forecast" });
  const forged = ["michael", ...state.split(".").slice(1)].join(".");
  assert.equal(readState(forged), null);
  assert.equal(readState(""), null);
  assert.equal(readState("a.b.c.d"), null);
});
