import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cadenceWindowBookedEarly, nextWindow } from "../src/lib/cadence";
import type { RevClient } from "../src/lib/db";

function addDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

test("a shoot within 14 days of the next cadence window counts toward it", () => {
  const client = {
    color_week: "blue",
    production_cadence: "monthly",
    last_production_date: null,
  } as RevClient;
  const today = "2026-11-19";
  assert.equal(nextWindow(client, today)?.start, "2026-12-07");
  assert.equal(cadenceWindowBookedEarly(client, "2026-11-23", today)?.start, "2026-12-07");
  assert.equal(cadenceWindowBookedEarly(client, "2026-11-30", today)?.start, "2026-12-07");
  assert.equal(cadenceWindowBookedEarly(client, "2026-11-22", today), null);
  assert.equal(cadenceWindowBookedEarly(client, "2026-12-09", today), null);
  assert.equal(cadenceWindowBookedEarly(client, "2026-07-30", today), null);
});

// db.ts resolves its file from process.cwd() when it is first imported, so this
// suite chdirs to a throwaway directory and imports dynamically, the same way
// tests/reachouts.test.ts does.

// The "counts toward window" override on the manual production form used to be
// stored exactly as typed, checked only for being a real date. A shoot logged
// against 2026-08-12 rather than that window's 2026-08-10 start was then filed
// under a window nothing else refers to: the reminder sweep looks for the
// window's start, found nothing, and went on asking a client to book a
// production they had already booked.
test("the window an override names", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-prodwindow-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const { createRevClient, updateRevClient, getRevClient } = await import(
    "../src/lib/revenue"
  );
  const { recordManualProduction } = await import("../src/lib/scheduling");
  const { findSendForWindow } = await import("../src/lib/cadence");
  const { deleteSend } = await import("../src/lib/calendar");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // Blue shoots Aug 10-14 in 2026, which is the window every case below is
  // really talking about.
  const created = createRevClient({
    name: "Window Test Co",
    businessModel: "home_service",
  });
  updateRevClient(created.id, {
    colorWeek: "blue",
    productionCadence: "monthly",
    productionEnrolled: true,
  });
  const client = getRevClient(created.id)!;

  const log = (body: Record<string, unknown>) =>
    recordManualProduction(client, {
      time: "09:00",
      status: "scheduled",
      notifyClient: false,
      advanceAnchor: false,
      ...body,
    });

  // One booking per window is enforced, so each case that lands a row clears it
  // again before the next one runs.
  const logThenClear = async (body: Record<string, unknown>) => {
    const res = await log(body);
    if (res.ok) {
      const stored = res.send.cadence_window_start;
      deleteSend(res.send.id);
      return stored;
    }
    return null;
  };

  await t.test("a mid-week override means that week, not that day", async () => {
    const res = await log({
      date: "2026-08-13",
      cadenceWindowStart: "2026-08-12",
    });
    assert.equal(res.ok, true);
    assert.equal(res.ok && res.send.cadence_window_start, "2026-08-10");

    // The whole point: the sweep asks for the window's start, so a row filed
    // under anything else reads as "never booked" and the client gets chased.
    assert.notEqual(findSendForWindow(client.id, "2026-08-10"), null);
    if (res.ok) deleteSend(res.send.id);
  });

  await t.test("an out-of-cycle date inside the week is stored as that week", async () => {
    const { recordOutOfCycleProduction } = await import("../src/lib/scheduling");
    const res = await recordOutOfCycleProduction(client, {
      date: "2026-08-12",
      time: "09:00",
      status: "scheduled",
    });
    assert.equal(res.ok, true);
    assert.equal(res.ok && res.send.cadence_window_start, "2026-08-10");
    assert.equal(res.ok && res.send.title, "Window Test Co production");
    if (res.ok) deleteSend(res.send.id);
  });

  await t.test("an out-of-cycle date outside every production week stays unlinked", async () => {
    const { recordOutOfCycleProduction } = await import("../src/lib/scheduling");
    const res = await recordOutOfCycleProduction(client, {
      date: "2026-08-20",
      time: "09:00",
      status: "scheduled",
    });
    assert.equal(res.ok, true);
    assert.equal(res.ok && res.send.cadence_window_start, null);
    if (res.ok) deleteSend(res.send.id);
  });

  await t.test("a blank override still derives from the shoot date", async () => {
    assert.equal(await logThenClear({ date: "2026-08-13" }), "2026-08-10");
  });

  await t.test("an exact window start is kept as-is", async () => {
    assert.equal(
      await logThenClear({
        date: "2026-08-13",
        cadenceWindowStart: "2026-08-10",
      }),
      "2026-08-10"
    );
  });

  // The override exists for productions that happened outside a production
  // week, so an off-window shoot pointed at a real window must keep working.
  await t.test("an off-window shoot can still be counted toward a window", async () => {
    assert.equal(
      await logThenClear({
        date: "2026-08-05",
        cadenceWindowStart: "2026-08-10",
      }),
      "2026-08-10"
    );
  });

  await t.test("a date in no production week is refused, not stored", async () => {
    const res = await log({
      date: "2026-08-13",
      cadenceWindowStart: "2026-08-25",
    });
    assert.equal(res.ok, false);
    assert.equal(res.ok === false && res.httpStatus, 400);
    assert.match(
      res.ok === false ? res.error : "",
      /isn't inside a blue production week/
    );
  });

  await t.test("a malformed date is still refused", async () => {
    const res = await log({
      date: "2026-08-13",
      cadenceWindowStart: "not-a-date",
    });
    assert.equal(res.ok, false);
    assert.equal(res.ok === false && res.httpStatus, 400);
  });

  await t.test("an early shoot with no window counts toward the next one", async () => {
    const { appDateTime, nextWindow: next, productionWindowForDate } = await import(
      "../src/lib/cadence"
    );
    const today = appDateTime().date;
    const upcoming = next(client, today);
    assert.ok(upcoming);
    const early = addDays(upcoming.start, -7);
    assert.equal(productionWindowForDate("blue", early), null);
    const res = await log({ date: early });
    assert.equal(res.ok, true);
    assert.equal(res.ok && res.send.cadence_window_start, upcoming.start);
    if (res.ok) deleteSend(res.send.id);
  });

  await t.test("a shoot more than 14 days before the next window is still refused", async () => {
    const { appDateTime, nextWindow: next, productionWindowForDate } = await import(
      "../src/lib/cadence"
    );
    const upcoming = next(client, appDateTime().date);
    assert.ok(upcoming);
    let far = "";
    for (let days = 15; days <= 27; days++) {
      const candidate = addDays(upcoming.start, -days);
      if (!productionWindowForDate("blue", candidate)) {
        far = candidate;
        break;
      }
    }
    assert.ok(far);
    const res = await log({ date: far });
    assert.equal(res.ok, false);
    assert.equal(res.ok === false && res.httpStatus, 400);
  });

  await t.test("an explicit window still wins, and out-of-cycle stays unlinked", async () => {
    assert.equal(
      await logThenClear({
        date: "2026-07-30",
        cadenceWindowStart: "2026-08-10",
      }),
      "2026-08-10"
    );
    const refused = await log({ date: "2026-07-30" });
    assert.equal(refused.ok, false);
    assert.equal(refused.ok === false && refused.httpStatus, 400);

    const { recordOutOfCycleProduction } = await import("../src/lib/scheduling");
    const { appDateTime, nextWindow: next, productionWindowForDate } = await import(
      "../src/lib/cadence"
    );
    const upcoming = next(client, appDateTime().date);
    assert.ok(upcoming);
    const early = addDays(upcoming.start, -7);
    assert.equal(productionWindowForDate("blue", early), null);
    const res = await recordOutOfCycleProduction(client, {
      date: early,
      time: "09:00",
      status: "scheduled",
    });
    assert.equal(res.ok, true);
    assert.equal(res.ok && res.send.cadence_window_start, null);
    if (res.ok) deleteSend(res.send.id);
  });
});
