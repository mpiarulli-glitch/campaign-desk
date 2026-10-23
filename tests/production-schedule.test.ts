import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zonedLocalToUtc } from "../src/lib/forecast-time";
import {
  SCHEDULE_TIME_ZONE,
  blockedSlotsForVideographer,
  buildProductionScheduleContent,
  isTimeOffTitle,
  parseScheduleEntry,
  type ProductionScheduleEntry,
  type ScheduleRecurrence,
} from "../src/lib/production-schedule";

const DATE = "2026-11-03";
const NEXT_TUESDAY = "2026-11-10";
const WEDNESDAY = "2026-11-04";

function at(date: string, time: string): string {
  const instant = zonedLocalToUtc(date, time, SCHEDULE_TIME_ZONE);
  if (!instant) throw new Error(`bad time ${date} ${time}`);
  return instant.toISOString();
}

function entry(partial: Partial<ProductionScheduleEntry> & Pick<ProductionScheduleEntry, "id" | "summary">): ProductionScheduleEntry {
  return {
    startsAt: at(DATE, "10:00"),
    endsAt: at(DATE, "12:00"),
    allDay: false,
    participantIds: [],
    participantNames: [],
    recurrence: null,
    ...partial,
  };
}

function allDay(summary: string, date = DATE, recurrence: ScheduleRecurrence | null = null): ProductionScheduleEntry {
  return entry({
    id: summary,
    summary,
    startsAt: date,
    endsAt: date,
    allDay: true,
    recurrence,
  });
}

function blocked(
  scheduleEntry: ProductionScheduleEntry,
  name: string,
  dates: string[],
  extras?: { personId?: number | null; allNames?: string[]; excludeEntryId?: string }
) {
  return blockedSlotsForVideographer({
    entries: [scheduleEntry],
    videographerName: name,
    personId: extras?.personId ?? null,
    allVideographerNames: extras?.allNames ?? [name],
    dates,
    excludeEntryId: extras?.excludeEntryId,
  });
}

function halfSlots(blocks: { blockedHalfSlots: string[] }, date: string): string[] {
  return blocks.blockedHalfSlots
    .filter((slot) => slot.startsWith(`${date}|`))
    .map((slot) => slot.slice(date.length + 1));
}

test("a timed shoot blocks overlapping half-day starts and the full day", () => {
  assert.equal(new Date(Date.UTC(2026, 10, 3)).getUTCDay(), 2);
  const shoot = entry({
    id: "shoot-1",
    summary: "Shaw Studio Shoot",
    participantIds: [42],
  });
  const blocks = blocked(shoot, "Alex Rivera", [DATE, WEDNESDAY], { personId: 42 });
  assert.deepEqual(halfSlots(blocks, DATE), ["09:00", "10:00", "11:00"]);
  assert.equal(blocks.blockedFullDays.includes(DATE), true);
  assert.deepEqual(halfSlots(blocks, WEDNESDAY), []);
  assert.equal(blocks.blockedFullDays.includes(WEDNESDAY), false);

  const byName = blocked(
    entry({
      id: "shoot-2",
      summary: "Shaw Studio Shoot",
      participantNames: ["Alex Rivera"],
    }),
    "Alex Rivera",
    [DATE]
  );
  assert.deepEqual(halfSlots(byName, DATE), ["09:00", "10:00", "11:00"]);

  const someoneElse = blocked(shoot, "Sam Cole", [DATE], { personId: 7 });
  assert.deepEqual(someoneElse.blockedHalfSlots, []);
  assert.deepEqual(someoneElse.blockedFullDays, []);

  const ownEntry = blocked(shoot, "Alex Rivera", [DATE], {
    personId: 42,
    excludeEntryId: "shoot-1",
  });
  assert.deepEqual(ownEntry.blockedHalfSlots, []);
});

test("all-day time off blocks that day only", () => {
  const ooo = allDay("Alex OOO", DATE);
  const blocks = blocked(ooo, "Alex Rivera", [DATE, WEDNESDAY], {
    allNames: ["Alex Rivera", "Sam Cole"],
  });
  assert.deepEqual(halfSlots(blocks, DATE), ["09:00", "10:00", "11:00", "12:00", "13:00"]);
  assert.deepEqual(blocks.blockedFullDays, [DATE]);
  assert.deepEqual(halfSlots(blocks, WEDNESDAY), []);
});

test("time-off titles name the videographer and ignore off-site shoots", () => {
  assert.equal(isTimeOffTitle("OOO"), true);
  assert.equal(isTimeOffTitle("PTO - Alex"), true);
  assert.equal(isTimeOffTitle("Sam - Off"), true);
  assert.equal(isTimeOffTitle("Dates Off - Alex"), true);
  assert.equal(isTimeOffTitle("out of office"), true);
  assert.equal(isTimeOffTitle("time off"), true);
  assert.equal(isTimeOffTitle("Alex off-site shoot"), false);
  assert.equal(isTimeOffTitle("Alex in the office"), false);

  const names = ["Alex Rivera", "Sam Cole", "Chris Millon", "Chris Other"];
  const on = (summary: string, name: string) =>
    blocked(allDay(summary), name, [DATE], { allNames: names }).blockedFullDays.includes(DATE);

  assert.equal(on("Alex OOO", "Alex Rivera"), true);
  assert.equal(on("PTO - Alex", "Alex Rivera"), true);
  assert.equal(on("Sam - Off", "Sam Cole"), true);
  assert.equal(on("Dates Off - Alex", "Alex Rivera"), true);
  assert.equal(on("Sam - Off", "Alex Rivera"), false);
  assert.equal(on("Alex off-site shoot", "Alex Rivera"), false);
  assert.equal(on("Shaw Studio Shoot", "Alex Rivera"), false);
  assert.equal(on("Chris Millon OOO", "Chris Millon"), true);
  assert.equal(on("Chris Millon OOO", "Chris Other"), false);
  assert.equal(on("Chris OOO", "Chris Millon"), true);
  assert.equal(on("Chris OOO", "Chris Other"), true);
});

test("a weekly series blocks later occurrences, including a custom weekday set", () => {
  const weekly = allDay("Alex OOO", DATE, {
    frequency: "every_week",
    days: [2],
    hour: null,
    minute: null,
    weekInstance: null,
    weekInterval: null,
    monthInterval: null,
    startDate: DATE,
    endDate: null,
  });
  const blocks = blocked(weekly, "Alex Rivera", [DATE, WEDNESDAY, NEXT_TUESDAY]);
  assert.equal(blocks.blockedFullDays.includes(DATE), true);
  assert.equal(blocks.blockedFullDays.includes(WEDNESDAY), false);
  assert.equal(blocks.blockedFullDays.includes(NEXT_TUESDAY), true);

  const parsed = parseScheduleEntry({
    id: 88,
    summary: "Alex OOO",
    starts_at: DATE,
    ends_at: DATE,
    all_day: true,
    participants: [],
    recurrence_schedule: {
      frequency: "every_week",
      days: [2],
      start_date: DATE,
      end_date: null,
    },
  });
  assert.ok(parsed?.recurrence);
  assert.equal(parsed?.recurrence?.frequency, "every_week");

  const bothDays = allDay("Alex OOO", DATE, {
    frequency: "every_other_week",
    days: [2, 4],
    hour: null,
    minute: null,
    weekInstance: null,
    weekInterval: null,
    monthInterval: null,
    startDate: DATE,
    endDate: null,
  });
  const fortnight = blocked(bothDays, "Alex Rivera", [DATE, "2026-11-05", "2026-11-12", NEXT_TUESDAY]);
  assert.equal(fortnight.blockedFullDays.includes(DATE), true);
  assert.equal(fortnight.blockedFullDays.includes("2026-11-05"), true);
  assert.equal(fortnight.blockedFullDays.includes(NEXT_TUESDAY), false);
  assert.equal(fortnight.blockedFullDays.includes("2026-11-12"), false);

  const repeatingShoot = entry({
    id: "weekly-shoot",
    summary: "Standing shoot",
    participantIds: [42],
    recurrence: {
      frequency: "every_week",
      days: [],
      hour: 10,
      minute: 0,
      weekInstance: null,
      weekInterval: null,
      monthInterval: null,
      startDate: DATE,
      endDate: null,
    },
  });
  const shootBlocks = blocked(repeatingShoot, "Alex Rivera", [NEXT_TUESDAY], { personId: 42 });
  assert.deepEqual(halfSlots(shootBlocks, NEXT_TUESDAY), ["09:00", "10:00", "11:00"]);

  const unknown = entry({
    id: "odd",
    summary: "Alex OOO",
    startsAt: DATE,
    endsAt: DATE,
    allDay: true,
    recurrence: {
      frequency: "every_fortnight",
      days: [],
      hour: null,
      minute: null,
      weekInstance: null,
      weekInterval: null,
      monthInterval: null,
      startDate: DATE,
      endDate: null,
    },
  });
  const unknownBlocks = blocked(unknown, "Alex Rivera", [DATE, NEXT_TUESDAY]);
  assert.deepEqual(unknownBlocks.blockedFullDays, [DATE]);
});

test("a production entry names the client, the length, the place, and a link back", () => {
  const content = buildProductionScheduleContent({
    clientName: "Shaw Studio",
    duration: "half",
    location: "123 Main St",
    date: DATE,
    time: "10:00",
    productionUrl: "https://hub.example/admin/production/send-1",
    campaignUrl: "https://hub.example/admin/campaigns/camp-1",
    campaignTitle: "November shoot",
    videographerNames: ["Alex Rivera"],
  });
  assert.equal(content.summary, "Shaw Studio — Half day");
  assert.equal(content.allDay, false);
  assert.equal(content.startsAt, at(DATE, "10:00"));
  assert.equal(content.endsAt, at(DATE, "14:00"));
  assert.match(content.description, /123 Main St/);
  assert.match(content.description, /Alex Rivera/);
  assert.match(content.description, /Open this production in Campaign Desk/);
  assert.match(content.description, /admin\/production\/send-1/);
  assert.match(content.description, /November shoot/);

  const full = buildProductionScheduleContent({
    clientName: "Shaw Studio",
    duration: "full",
    location: "",
    date: DATE,
    time: "",
    productionUrl: "https://hub.example/admin/production/send-1",
  });
  assert.equal(full.summary, "Shaw Studio — Full day");
  assert.equal(full.startsAt, at(DATE, "09:00"));
  assert.equal(full.endsAt, at(DATE, "17:30"));
});

test("schedule sync creates, updates, trashes, and refuses a busy or unread calendar", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-prod-sched-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  const { closeDbForTests } = await import("../src/lib/db");
  closeDbForTests();

  const sync = await import("../src/lib/production-schedule-sync");
  const { createVideographer } = await import("../src/lib/videographers");
  const revenue = await import("../src/lib/revenue");
  const calendar = await import("../src/lib/calendar");
  const { recordOutOfCycleProduction } = await import("../src/lib/scheduling");
  const { appDateTime } = await import("../src/lib/cadence");
  const failures = await import("../src/lib/failures");

  t.after(() => {
    sync.resetProductionScheduleForTests();
    closeDbForTests();
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const today = appDateTime().date;
  const future = addDays(today, 21);
  const later = addDays(today, 28);
  const created: { id: string; body: { summary: string; participantIds?: number[]; description?: string; startsAt: string } }[] = [];
  const updated: { id: string; body: { startsAt: string } }[] = [];
  const trashed: string[] = [];
  let entries: unknown[] = [];
  let listCalls = 0;
  let connected = true;
  let nextId = 500;
  let updateMissing = false;
  let connectedCalls = 0;

  function useGateway() {
    sync.setProductionScheduleGatewayForTests({
      connected: () => {
        connectedCalls += 1;
        return connected;
      },
      listEntries: async () => {
        listCalls += 1;
        return { ok: true, entries, totalCount: entries.length };
      },
      listPeople: async () => [{ id: 42, name: "Alex Rivera" }],
      create: async (body) => {
        const id = String(nextId++);
        created.push({ id, body });
        return { ok: true, id };
      },
      update: async (id, body) => {
        updated.push({ id, body });
        if (updateMissing) return { ok: false, error: "That schedule entry is gone.", missing: true };
        return { ok: true, id };
      },
      trash: async (id) => {
        trashed.push(id);
        return { ok: true };
      },
    });
  }

  useGateway();
  const empty = await sync.backfillProductionSchedule(today);
  assert.equal(empty.ok, true);
  assert.equal(empty.created, 0);
  assert.equal(connectedCalls, 0);

  const videographer = createVideographer("Alex Rivera");
  const client = revenue.updateRevClient(
    revenue.createRevClient({ name: "Shaw Studio", businessModel: "home_service" }).id,
    { videographerId: videographer.id }
  );
  assert.ok(client);

  const past = calendar.createSend({
    clientId: client.id,
    title: "Old shoot",
    sendDate: "2020-06-01",
    sendTime: "10:00",
    requestedByClient: true,
  });
  assert.equal((await sync.syncProductionScheduleEntry(past.id)).skipped, true);
  assert.equal(created.length, 0);

  const editorial = calendar.createSend({
    clientId: client.id,
    title: "November newsletter",
    sendDate: future,
    sendTime: "10:00",
  });
  assert.equal((await sync.syncProductionScheduleEntry(editorial.id)).skipped, true);
  assert.equal(created.length, 0);

  const send = calendar.createSend({
    clientId: client.id,
    title: "Shaw Studio production",
    sendDate: future,
    sendTime: "10:00",
    duration: "half",
    productionBrief: JSON.stringify({ locations: "123 Main St" }),
    requestedByClient: true,
  });
  const first = await sync.syncProductionScheduleEntry(send.id);
  assert.equal(first.ok, true);
  assert.equal(first.entryId, created[0]?.id);
  assert.equal(calendar.getSend(send.id)?.basecamp_schedule_entry_id, created[0]?.id);
  assert.equal(created[0]?.body.summary, "Shaw Studio — Half day");
  assert.deepEqual(created[0]?.body.participantIds, [42]);
  assert.match(created[0]?.body.description || "", /123 Main St/);
  assert.match(created[0]?.body.description || "", /Open this production in Campaign Desk/);
  assert.match(created[0]?.body.description || "", new RegExp(`/admin/production/${send.id}`));

  const second = await sync.syncProductionScheduleEntry(send.id);
  assert.equal(second.ok, true);
  assert.equal(second.entryId, created[0]?.id);
  assert.equal(created.length, 1);
  assert.equal(updated.at(-1)?.id, created[0]?.id);

  const movedDate = addDays(future, 1);
  calendar.updateSend(send.id, { sendDate: movedDate });
  await sync.syncProductionScheduleEntry(send.id);
  assert.equal(created.length, 1);
  assert.equal(updated.at(-1)?.body.startsAt, at(movedDate, "10:00"));

  calendar.cancelSend(send.id, true);
  const trashedResult = await sync.syncProductionScheduleEntry(send.id);
  assert.equal(trashedResult.ok, true);
  assert.deepEqual(trashed.at(-1), created[0]?.id);
  assert.equal(calendar.getSend(send.id)?.basecamp_schedule_entry_id, created[0]?.id);

  calendar.cancelSend(send.id, false);
  calendar.updateSend(send.id, { sendDate: future });
  updateMissing = true;
  const recreated = await sync.syncProductionScheduleEntry(send.id);
  updateMissing = false;
  assert.equal(recreated.ok, true);
  assert.equal(recreated.entryId, created[1]?.id);
  assert.notEqual(created[1]?.id, created[0]?.id);
  assert.equal(calendar.getSend(send.id)?.basecamp_schedule_entry_id, created[1]?.id);

  const raced = calendar.createSend({
    clientId: client.id,
    title: "Race",
    sendDate: later,
    sendTime: "11:00",
    requestedByClient: true,
  });
  sync.setProductionScheduleGatewayForTests({
    connected: () => true,
    listEntries: async () => ({ ok: true, entries: [], totalCount: 0 }),
    listPeople: async () => [{ id: 42, name: "Alex Rivera" }],
    create: async (body) => {
      calendar.getSend(raced.id);
      const { getDb, nowIso } = await import("../src/lib/db");
      getDb()
        .prepare(
          `UPDATE scheduled_sends SET basecamp_schedule_entry_id = ?, updated_at = ? WHERE id = ?`
        )
        .run("winner", nowIso(), raced.id);
      created.push({ id: "duplicate", body });
      return { ok: true, id: "duplicate" };
    },
    update: async (id, body) => {
      updated.push({ id, body });
      return { ok: true, id };
    },
    trash: async (id) => {
      trashed.push(id);
      return { ok: true };
    },
  });
  const race = await sync.syncProductionScheduleEntry(raced.id);
  assert.equal(race.ok, true);
  assert.equal(race.entryId, "winner");
  assert.equal(trashed.at(-1), "duplicate");
  assert.equal(calendar.getSend(raced.id)?.basecamp_schedule_entry_id, "winner");

  useGateway();
  const beforeBackfill = created.length;
  const linked = calendar.createSend({
    clientId: client.id,
    title: "Linked",
    sendDate: later,
    sendTime: "10:00",
    requestedByClient: true,
  });
  const { getDb, nowIso } = await import("../src/lib/db");
  getDb()
    .prepare(`UPDATE scheduled_sends SET basecamp_schedule_entry_id = ?, updated_at = ? WHERE id = ?`)
    .run("kept", nowIso(), linked.id);
  const cancelled = calendar.createSend({
    clientId: client.id,
    title: "Cancelled",
    sendDate: later,
    sendTime: "12:00",
    requestedByClient: true,
  });
  calendar.cancelSend(cancelled.id, true);
  const missing = calendar.createSend({
    clientId: client.id,
    title: "Missing",
    sendDate: later,
    sendTime: "13:00",
    duration: "full",
    requestedByClient: true,
  });
  const backfill = await sync.backfillProductionSchedule(today);
  assert.equal(backfill.ok, true);
  assert.equal(created.length - beforeBackfill, 1);
  assert.equal(calendar.getSend(missing.id)?.basecamp_schedule_entry_id !== "", true);
  assert.equal(calendar.getSend(linked.id)?.basecamp_schedule_entry_id, "kept");
  assert.equal(calendar.getSend(past.id)?.basecamp_schedule_entry_id, "");

  useGateway();
  entries = [];
  listCalls = 0;
  const open = await sync.readVideographerBlocks({
    videographerId: videographer.id,
    dates: [future],
  });
  const cached = await sync.readVideographerBlocks({
    videographerId: videographer.id,
    dates: [future],
  });
  assert.equal(open.ok, true);
  assert.equal(cached.ok, true);
  assert.equal(listCalls, 1);

  sync.setProductionScheduleGatewayForTests({
    connected: () => true,
    listEntries: async () => ({ ok: true, entries: [], totalCount: 12 }),
    listPeople: async () => [],
    create: async () => {
      throw new Error("must not create");
    },
    update: async () => {
      throw new Error("must not update");
    },
    trash: async () => {
      throw new Error("must not trash");
    },
  });
  const cutOff = await sync.readVideographerBlocks({
    videographerId: videographer.id,
    dates: [future],
  });
  assert.equal(cutOff.ok, false);
  assert.equal(cutOff.blocks.blockedFullDays.includes(future), true);
  assert.equal(
    failures.listOpenFailures().some((row) => row.kind === "basecamp_schedule"),
    true
  );

  connected = false;
  useGateway();
  const sendsBefore = getDb().prepare(`SELECT count(*) c FROM scheduled_sends`).get() as { c: number };
  const unreachable = await recordOutOfCycleProduction(client, {
    date: addDays(today, 35),
    time: "10:00",
    duration: "half",
  });
  assert.equal(unreachable.ok, false);
  if (!unreachable.ok) assert.equal(unreachable.httpStatus, 503);
  const sendsAfterOutage = getDb().prepare(`SELECT count(*) c FROM scheduled_sends`).get() as { c: number };
  assert.equal(sendsAfterOutage.c, sendsBefore.c);

  connected = true;
  entries = [
    {
      id: 77,
      summary: "Alex OOO",
      starts_at: addDays(today, 36),
      ends_at: addDays(today, 36),
      all_day: true,
      participants: [],
    },
  ];
  useGateway();
  const conflict = await recordOutOfCycleProduction(client, {
    date: addDays(today, 36),
    time: "11:00",
    duration: "half",
  });
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.httpStatus, 409);
  const sendsAfterConflict = getDb().prepare(`SELECT count(*) c FROM scheduled_sends`).get() as { c: number };
  assert.equal(sendsAfterConflict.c, sendsBefore.c);

  entries = [
    {
      id: 78,
      summary: "Existing shoot",
      starts_at: at(addDays(today, 40), "10:00"),
      ends_at: at(addDays(today, 40), "12:00"),
      all_day: false,
      participants: [{ id: 42, name: "Alex Rivera" }],
    },
  ];
  useGateway();
  const overlap = await recordOutOfCycleProduction(client, {
    date: addDays(today, 40),
    time: "09:00",
    duration: "half",
  });
  assert.equal(overlap.ok, false);
  if (!overlap.ok) assert.equal(overlap.httpStatus, 409);

  entries = [
    {
      id: 79,
      summary: "Alex off-site shoot",
      starts_at: at(addDays(today, 42), "10:00"),
      ends_at: at(addDays(today, 42), "12:00"),
      all_day: false,
      participants: [],
    },
  ];
  useGateway();
  const offSite = await recordOutOfCycleProduction(client, {
    date: addDays(today, 42),
    time: "10:00",
    duration: "half",
  });
  assert.equal(offSite.ok, true);
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
});

function addDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
