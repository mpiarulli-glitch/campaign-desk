import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Everything here is imported dynamically, after the chdir, and nothing this
// file imports at the top level reaches db.ts. That module fixes its database
// path from process.cwd() the moment it is first imported, so a static import
// of scheduling.ts or notify.ts would pin the real data/campaign-desk.db and
// this suite would write its fixtures into the working database.

test("production window declines", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-declines-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const rules = await import("../src/lib/scheduling-rules");
  const declines = await import("../src/lib/window-declines");
  const { windowDeclinedCampfireContent } = await import("../src/lib/notify");
  const { declineCardComment } = await import("../src/lib/scheduling");
  const { getDb, nowIso } = await import("../src/lib/db");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const ts = nowIso();
  getDb()
    .prepare(
      `INSERT INTO rev_clients (id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?)`
    )
    .run("c1", "Juniors Market", ts, ts);

  await t.test("only the offered reasons are accepted", () => {
    for (const reason of rules.DECLINE_REASONS) {
      assert.equal(rules.isDeclineReason(reason.value), true);
    }
    assert.equal(rules.isDeclineReason("whatever"), false);
    assert.equal(rules.isDeclineReason(""), false);
    assert.equal(rules.isDeclineReason(undefined), false);
    // A stored code no longer offered still reads as something rather than
    // blank, so an old row on the board is never an empty cell.
    assert.equal(rules.declineReasonLabel("retired-code"), "Not given");
    assert.equal(rules.declineReasonLabel("busy"), "Too busy that week");
  });

  await t.test("the team is told what the client wants next", () => {
    const base = {
      clientName: "Juniors Market",
      accountManagerName: "Luis",
      windowStart: "2026-09-07",
      windowEnd: "2026-09-11",
      reasonLabel: "Too busy that week",
    };
    assert.match(
      windowDeclinedCampfireContent({ ...base, wantsOtherDate: true }),
      /picking a date outside the window/
    );
    assert.match(
      windowDeclinedCampfireContent({ ...base, wantsOtherDate: false }),
      /wait for their next window/
    );
    // The client's own words carry through, escaped.
    assert.match(
      windowDeclinedCampfireContent({
        ...base,
        wantsOtherDate: true,
        note: "Closed for <inventory>",
      }),
      /Closed for &lt;inventory&gt;/
    );
  });

  await t.test("the reply on their card says the reminders have stopped", () => {
    const week = "Monday, September 7 to Friday, September 11";
    const comment = declineCardComment(week, true, "");
    assert.match(comment, /will not get any more reminders/);
    assert.match(comment, /pick a day that works better/);
    assert.match(declineCardComment(week, false, ""), /next production window/);
    // Never write raw client input into the card body.
    assert.match(declineCardComment(week, true, "we are <away>"), /we are &lt;away&gt;/);
  });

  await t.test("a window nobody declined is left alone", () => {
    assert.equal(declines.isWindowDeclined("c1", "2026-09-07"), false);
  });

  await t.test("declining stops the sweep for that window only", () => {
    declines.declineWindow({
      clientId: "c1",
      windowStart: "2026-09-07",
      windowEnd: "2026-09-11",
      reason: "closed",
      note: "Closed for inventory",
      wantsOtherDate: true,
    });
    assert.equal(declines.isWindowDeclined("c1", "2026-09-07"), true);
    assert.equal(declines.isWindowDeclined("c1", "2026-10-05"), false);
  });

  await t.test("declining twice updates rather than stacking", () => {
    declines.declineWindow({
      clientId: "c1",
      windowStart: "2026-09-07",
      windowEnd: "2026-09-11",
      reason: "busy",
      wantsOtherDate: false,
    });
    assert.equal(declines.listDeclinesForClient("c1").length, 1);
    const live = declines.activeDecline("c1", "2026-09-07");
    assert.equal(live?.reason, "busy");
    assert.equal(live?.wants_other_date, 0);
    // The earlier note goes with the answer it belonged to.
    assert.equal(live?.note, "");
  });

  await t.test("an unresolved decline is on the work list", () => {
    const open = declines.listUnresolvedDeclines();
    assert.equal(open.length, 1);
    assert.equal(open[0].client_id, "c1");
  });

  await t.test("booking a make-up settles it without reopening the window", () => {
    declines.resolveDeclineWithSend("c1", "send-1");
    assert.deepEqual(declines.listUnresolvedDeclines(), []);
    // Still declined: the client is not going to book that week either way, so
    // the reminders must stay off.
    assert.equal(declines.isWindowDeclined("c1", "2026-09-07"), true);
    assert.equal(
      declines.activeDecline("c1", "2026-09-07")?.resolved_send_id,
      "send-1"
    );
  });

  await t.test("handing the window back starts the asks again", () => {
    declines.clearDecline("c1", "2026-09-07");
    assert.equal(declines.isWindowDeclined("c1", "2026-09-07"), false);
    // The record survives, so a window that was declined and reopened is still
    // readable later.
    assert.equal(declines.listDeclinesForClient("c1").length, 1);
  });

  await t.test("a reopened window can be declined again", () => {
    declines.declineWindow({
      clientId: "c1",
      windowStart: "2026-09-07",
      windowEnd: "2026-09-11",
      reason: "people",
      wantsOtherDate: true,
    });
    assert.equal(declines.isWindowDeclined("c1", "2026-09-07"), true);
    assert.equal(declines.listDeclinesForClient("c1").length, 1);
    assert.equal(declines.activeDecline("c1", "2026-09-07")?.resolved_send_id, null);
  });
});
