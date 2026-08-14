import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
});
