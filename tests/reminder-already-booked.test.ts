import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zonedLocalToUtc } from "../src/lib/forecast-time";

// db.ts picks its file from process.cwd() the first time it opens, so this
// suite chdirs to a throwaway directory before importing anything that
// touches the database. Same shape as tests/reachouts.test.ts.

const TODAY = "2026-11-23";
const WINDOW_START = "2026-11-23";
const PRIOR_WINDOW = "2026-10-26";

function at(date: string, time: string): string {
  const instant = zonedLocalToUtc(date, time, "America/Los_Angeles");
  if (!instant) throw new Error(`bad time ${date} ${time}`);
  return instant.toISOString();
}

function shoot(id: number, summary: string, date: string, time = "09:00", end = "14:00") {
  return {
    id,
    summary,
    starts_at: at(date, time),
    ends_at: at(date, end),
    all_day: false,
    participants: [{ id: 77, name: "Paula Loomis" }],
  };
}

function allDay(id: number, summary: string, date: string) {
  return {
    id,
    summary,
    starts_at: date,
    ends_at: date,
    all_day: true,
    participants: [] as { id: number; name: string }[],
  };
}

test("a recent shoot, in the app or typed on the Basecamp schedule, covers the window", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-booked-window-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const { createRevClient, updateRevClient, getRevClient } = await import("../src/lib/revenue");
  const { createSend, cancelSend } = await import("../src/lib/calendar");
  const { runReminders } = await import("../src/lib/reminders");
  const {
    findSendForWindow,
    nextWindow,
    productionWindowForDate,
    cadenceWindowBookedEarly,
  } = await import("../src/lib/cadence");
  const sync = await import("../src/lib/production-schedule-sync");
  const { listOpenFailures } = await import("../src/lib/failures");
  const { closeDbForTests } = await import("../src/lib/db");

  const entries: unknown[] = [];
  let listEntries: () => Promise<{ ok: true; entries: unknown[]; totalCount: number } | { ok: false; error: string }> =
    async () => ({ ok: true, entries, totalCount: entries.length });

  const useGateway = () => {
    sync.setProductionScheduleGatewayForTests({
      connected: () => true,
      listEntries: () => listEntries(),
      listPeople: async () => [{ id: 77, name: "Paula Loomis" }],
      create: async () => {
        throw new Error("reminder dry run tried to create a Basecamp entry");
      },
      update: async () => {
        throw new Error("reminder dry run tried to update a Basecamp entry");
      },
      trash: async () => {
        throw new Error("reminder dry run tried to trash a Basecamp entry");
      },
    });
  };

  t.after(() => {
    sync.resetProductionScheduleForTests();
    closeDbForTests();
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const enroll = (name: string) => {
    const created = createRevClient({ name, businessModel: "home_service" });
    updateRevClient(created.id, {
      colorWeek: "purple",
      productionCadence: "monthly",
      productionEnrolled: true,
      contactName: "Pat Client",
      contactEmail: `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@example.com`,
    });
    return getRevClient(created.id)!;
  };

  const production = (
    client: { id: string; name: string },
    sendDate: string,
    cadenceWindowStart: string | null
  ) =>
    createSend({
      clientId: client.id,
      clientName: client.name,
      title: `${client.name} production`,
      sendDate,
      sendTime: "09:00",
      status: "scheduled",
      cadenceWindowStart,
      requestedByClient: true,
    });

  // Purple's December production week is Mon Nov 23–Fri Nov 27. The October
  // booking was filed under the week of Oct 26, which is where the public
  // link put Pipe It Right's Oct 28 shoot.
  const pipe = enroll("Pipe It Right Plumbing");
  assert.equal(productionWindowForDate("purple", "2026-10-28")?.start, PRIOR_WINDOW);
  assert.equal(nextWindow(pipe, TODAY)?.start, WINDOW_START);
  assert.equal(nextWindow(pipe, TODAY)?.end, "2026-11-27");
  production(pipe, "2026-10-28", PRIOR_WINDOW);

  const earlyFiled = enroll("Early Filed Co");
  production(earlyFiled, "2026-11-16", PRIOR_WINDOW);
  assert.equal(cadenceWindowBookedEarly(earlyFiled, "2026-11-16", TODAY)?.start, WINDOW_START);

  const earlyOpen = enroll("Early Open Co");
  production(earlyOpen, "2026-11-10", null);
  assert.equal(cadenceWindowBookedEarly(earlyOpen, "2026-11-10", TODAY)?.start, WINDOW_START);

  const far = enroll("Far Early Co");
  production(far, "2026-10-28", PRIOR_WINDOW);
  assert.equal(cadenceWindowBookedEarly(far, "2026-10-28", TODAY), null);

  const neighbor = enroll("Neighbor Co");
  const cascade = enroll("Cascade Heating");
  const cancelled = enroll("Cancelled Early Co");
  cancelSend(production(cancelled, "2026-11-16", null).id, true);

  const newsletter = enroll("Newsletter Co");
  createSend({
    clientId: newsletter.id,
    clientName: newsletter.name,
    title: "November newsletter",
    sendDate: "2026-11-16",
    status: "planned",
    assetType: "email_campaign",
  });

  // Cassidy's hand-made entry: Nov 19, 9am–2pm PT, Paula Loomis. The other
  // rows are a different client's shoot and time off, which must not quiet
  // anyone else.
  entries.push(
    shoot(1901, "Confirmed: Pipe It Right Production", "2026-11-19"),
    shoot(1902, "Confirmed: Top Notch Auto Production", "2026-11-19"),
    allDay(1903, "Cascade Heating OOO", "2026-11-19"),
    allDay(1904, "Paula Loomis OOO", "2026-11-19")
  );
  useGateway();

  const onTheShoot = await sync.handMadeClientShootCovering({
    clientName: "Pipe It Right Plumbing",
    start: "2026-11-19",
    end: "2026-11-19",
  });
  assert.equal(onTheShoot.ok && onTheShoot.found, true);
  const insideTheWindowOnly = await sync.handMadeClientShootCovering({
    clientName: "Pipe It Right Plumbing",
    start: WINDOW_START,
    end: "2026-11-27",
  });
  assert.equal(insideTheWindowOnly.ok && insideTheWindowOnly.found, false);
  const byAlias = await sync.handMadeClientShootCovering({
    clientName: "Some Other Legal Name",
    aliases: ["pipe it right"],
    start: "2026-11-09",
    end: "2026-11-27",
  });
  assert.equal(byAlias.ok && byAlias.found, true);

  const names = (run: { reachedOut: Array<{ client: string }> }) =>
    run.reachedOut.map((row) => row.client).sort();

  const quiet = await runReminders({ today: TODAY, dryRun: true });
  assert.deepEqual(
    names(quiet),
    [cancelled.name, cascade.name, far.name, neighbor.name, newsletter.name].sort()
  );
  assert.equal(quiet.reachedOut.some((row) => row.clientId === pipe.id), false);
  assert.equal(quiet.reachedOut.some((row) => row.clientId === earlyFiled.id), false);
  assert.equal(quiet.reachedOut.some((row) => row.clientId === earlyOpen.id), false);
  assert.equal(quiet.skipped.bookedInBasecamp, 1);
  assert.equal(quiet.skipped.alreadyBooked, 2);
  assert.equal(quiet.sent.length, 5);
  assert.equal(quiet.basecampCards.length, 0);
  assert.equal(quiet.basecampFollowups.length, 0);
  assert.equal(
    quiet.reachedOut.every((row) => row.channel === "email" && row.window.start === WINDOW_START),
    true
  );
  assert.equal(listOpenFailures().length, 0);

  listEntries = async () => {
    throw new Error("Basecamp schedule timed out");
  };
  useGateway();
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((part) => String(part)).join(" "));
  };
  let failed: Awaited<ReturnType<typeof runReminders>> | null = null;
  try {
    failed = await runReminders({ today: TODAY, dryRun: true });
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(failed);
  assert.deepEqual(
    names(failed),
    [cancelled.name, cascade.name, far.name, neighbor.name, newsletter.name, pipe.name].sort()
  );
  assert.equal(failed.skipped.bookedInBasecamp, 0);
  assert.equal(failed.skipped.alreadyBooked, 2);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Couldn't read the Basecamp production schedule/);
  assert.equal(listOpenFailures().length, 0);

  // A shoot filed under an open window stays that window's booking. It can
  // cover the next window only after its own window has ended, or when some
  // other row already covers it.
  const guard = enroll("Guard Co");
  const decemberShoot = production(guard, "2026-12-16", WINDOW_START);
  assert.equal(findSendForWindow(guard.id, WINDOW_START, "2026-11-20")?.id, decemberShoot.id);
  assert.equal(findSendForWindow(guard.id, "2026-12-28", "2026-11-20"), null);
  assert.equal(findSendForWindow(guard.id, "2026-12-28", "2026-12-01")?.id, decemberShoot.id);

  const novemberShoot = production(guard, "2026-11-24", WINDOW_START);
  assert.equal(findSendForWindow(guard.id, "2026-12-28", "2026-11-20")?.id, decemberShoot.id);
  // Both rows are filed on Nov 23. The early row filed on the prior window
  // must not win over them.
  const earlyOther = production(guard, "2026-11-16", PRIOR_WINDOW);
  const preferred = findSendForWindow(guard.id, WINDOW_START, TODAY);
  assert.ok(preferred);
  assert.equal(preferred.cadence_window_start, WINDOW_START);
  assert.notEqual(preferred.id, earlyOther.id);
  assert.ok(preferred.id === novemberShoot.id || preferred.id === decemberShoot.id);

  cancelSend(decemberShoot.id, true);
  assert.equal(findSendForWindow(guard.id, "2026-12-28", "2026-12-01"), null);

  const edge = enroll("Edge Co");
  const onTheBoundary = production(edge, "2026-11-09", null);
  production(edge, "2026-11-08", null);
  assert.equal(findSendForWindow(edge.id, WINDOW_START, TODAY)?.id, onTheBoundary.id);

  const inside = enroll("Inside Window Co");
  const moved = production(inside, "2026-11-25", PRIOR_WINDOW);
  assert.equal(findSendForWindow(inside.id, WINDOW_START, TODAY)?.id, moved.id);
});
