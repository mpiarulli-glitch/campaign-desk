import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// db.ts resolves its file from process.cwd() when it is first imported, so this
// suite chdirs to a throwaway directory and imports dynamically, the same way
// tests/failures.test.ts does.

test("the reach-out log", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-reachouts-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const reachouts = await import("../src/lib/reachouts");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await t.test("starts empty", () => {
    assert.deepEqual(reachouts.listRecentReachouts(), []);
    assert.equal(reachouts.lastReachoutForClient("c1"), null);
  });

  await t.test("records a contact on every channel", () => {
    reachouts.recordReachout({
      clientId: "c1",
      clientName: "Looda House Pawn",
      channel: "email",
      windowStart: "2026-08-03",
      ymd: "2026-08-03",
      detail: "owner@loodahouse.com",
    });
    reachouts.recordReachout({
      clientId: "c2",
      clientName: "Krak Boba Corporate",
      channel: "basecamp_card",
      windowStart: "2026-08-03",
      ymd: "2026-08-03",
      detail: "Jamie Cruz",
    });
    reachouts.recordReachout({
      clientId: "c3",
      clientName: "Humble Somm",
      channel: "basecamp_comment",
      windowStart: "2026-08-03",
      ymd: "2026-08-03",
      detail: "Alex Reyes",
    });

    // The whole point: a Basecamp-only contact is as visible as an emailed one.
    // Reading the email channel alone reported one client out of three.
    const all = reachouts.listRecentReachouts();
    assert.equal(all.length, 3);
    assert.deepEqual(
      new Set(all.map((r) => r.client_name)),
      new Set(["Looda House Pawn", "Krak Boba Corporate", "Humble Somm"])
    );
    assert.equal(all.filter((r) => r.channel === "email").length, 1);
  });

  await t.test("last contact counts any channel, not just email", () => {
    const last = reachouts.lastReachoutForClient("c2");
    assert.equal(last?.channel, "basecamp_card");
    assert.equal(last?.ymd, "2026-08-03");
  });

  await t.test("a client's history comes back newest first", () => {
    reachouts.recordReachout({
      clientId: "c2",
      clientName: "Krak Boba Corporate",
      channel: "basecamp_comment",
      windowStart: "2026-08-03",
      ymd: "2026-08-05",
      detail: "Jamie Cruz",
    });
    const history = reachouts.listReachoutsForClient("c2");
    assert.equal(history.length, 2);
    assert.equal(history[0].ymd, "2026-08-05");
    assert.equal(history[1].ymd, "2026-08-03");
    assert.equal(reachouts.lastReachoutForClient("c2")?.ymd, "2026-08-05");
  });

  await t.test("a single day reads back on its own", () => {
    assert.equal(reachouts.listReachoutsOn("2026-08-03").length, 3);
    assert.equal(reachouts.listReachoutsOn("2026-08-05").length, 1);
    assert.equal(reachouts.listReachoutsOn("2026-08-04").length, 0);
  });
});

test("Basecamp cards obey the same weekday rule as their follow-ups", async () => {
  const { isBasecampFollowupDay, isEmailFollowupDay } = await import(
    "../src/lib/reminders"
  );
  // 2026-08-07 is a Friday: a Basecamp day but not an email day. This is the
  // shape that under-reported, because every client reached that day was
  // reached on Basecamp and none of them landed in the email array.
  assert.equal(isBasecampFollowupDay("2026-08-07"), true);
  assert.equal(isEmailFollowupDay("2026-08-07"), false);

  // Saturday and Sunday are neither. A first card used to ignore this gate
  // entirely and could post on a weekend.
  for (const weekend of ["2026-08-08", "2026-08-09"]) {
    assert.equal(isBasecampFollowupDay(weekend), false);
    assert.equal(isEmailFollowupDay(weekend), false);
  }
});

// Once a client books, every channel has to go quiet. The already-booked check
// sits ahead of both the Basecamp block and the email gates in the sweep, so
// this proves the ordering rather than just the email path.
test("a requested production stops all further outreach", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-booked-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const { createRevClient, updateRevClient } = await import("../src/lib/revenue");
  const { createSend } = await import("../src/lib/calendar");
  const { runReminders } = await import("../src/lib/reminders");
  const { nextWindow } = await import("../src/lib/cadence");
  const { getRevClient } = await import("../src/lib/revenue");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // A red monthly client, enrolled, with their window open. 2026-08-03 is the
  // Monday of red's August production window and an email follow-up day.
  const today = "2026-08-03";
  const created = createRevClient({ name: "Test Co", businessModel: "home_service" });
  updateRevClient(created.id, {
    colorWeek: "red",
    productionCadence: "monthly",
    productionEnrolled: true,
    contactName: "Sam Doe",
    contactEmail: "sam@test.co",
  });

  const client = getRevClient(created.id)!;
  const window = nextWindow(client, today);
  assert.equal(window?.start, "2026-08-03");

  // Control: unbooked, so the sweep reaches them.
  const before = await runReminders({ today, dryRun: true });
  assert.equal(before.reachedOut.length, 1);
  assert.equal(before.reachedOut[0].client, "Test Co");
  assert.equal(before.skipped.alreadyBooked, 0);

  // The client books. Status "requested" is what a client booking creates.
  createSend({
    clientId: client.id,
    clientName: client.name,
    title: "Test Co production",
    sendDate: "2026-08-05",
    status: "requested",
    cadenceWindowStart: window!.start,
    requestedByClient: true,
  });

  const after = await runReminders({ today, dryRun: true });
  assert.equal(after.reachedOut.length, 0, "no channel should reach a booked client");
  assert.equal(after.sent.length, 0);
  assert.equal(after.basecampCards.length, 0);
  assert.equal(after.basecampFollowups.length, 0);
  assert.equal(after.skipped.alreadyBooked, 1);
});

// The status pill reads off outreach for the CURRENT window, on any channel.
// Krak Boba Corporate showed "Not due yet" while three Basecamp nudges had gone
// out, because the pill counted emails only.
test("outreach for a window is counted across every channel", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-window-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const reachouts = await import("../src/lib/reachouts");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const AUG = "2026-08-10"; // blue week's August production window
  const JUL = "2026-07-13"; // the window before it

  // Chased three times for August, all on Basecamp. No email at all.
  reachouts.recordReachout({
    clientId: "krak", clientName: "Krak Boba Corporate", channel: "basecamp_card",
    windowStart: AUG, ymd: "2026-08-03",
  });
  reachouts.recordReachout({
    clientId: "krak", clientName: "Krak Boba Corporate", channel: "basecamp_comment",
    windowStart: AUG, ymd: "2026-08-05",
  });
  reachouts.recordReachout({
    clientId: "krak", clientName: "Krak Boba Corporate", channel: "basecamp_comment",
    windowStart: AUG, ymd: "2026-08-07",
  });
  // Plus an older contact about a window that is already done.
  reachouts.recordReachout({
    clientId: "krak", clientName: "Krak Boba Corporate", channel: "email",
    windowStart: JUL, ymd: "2026-07-06",
  });

  const august = reachouts.reachoutsForWindow("krak", AUG);
  assert.equal(august.count, 3, "all three Basecamp contacts count");
  assert.equal(august.last?.ymd, "2026-08-07", "newest first");
  assert.equal(august.last?.channel, "basecamp_comment");

  // July's contact must not leak into August's tally, otherwise a client chased
  // hard last month reads as already asked about this month.
  assert.equal(reachouts.reachoutsForWindow("krak", JUL).count, 1);

  // A window nobody has been contacted about reads as zero, not as "some".
  assert.equal(reachouts.reachoutsForWindow("krak", "2026-09-14").count, 0);
  assert.equal(reachouts.reachoutsForWindow("someone-else", AUG).count, 0);
});

// A hand-set status pins the row, and a hand-set pause stops the sweep. They
// are deliberately two switches: pinning a status must never quietly stop a
// client being asked.
test("hand-set status and hand-set pause", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-override-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const { createRevClient, updateRevClient, getRevClient } = await import(
    "../src/lib/revenue"
  );
  const { runReminders } = await import("../src/lib/reminders");
  const { effectiveCycleStatus, nextWindow, isCycleStatus } = await import(
    "../src/lib/cadence"
  );

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const today = "2026-08-03"; // Monday of red's August window, an email day
  const created = createRevClient({ name: "Pin Co", businessModel: "home_service" });
  updateRevClient(created.id, {
    colorWeek: "red",
    productionCadence: "monthly",
    productionEnrolled: true,
    contactName: "Sam Doe",
    contactEmail: "sam@pin.co",
  });

  await t.test("no override means the real status shows", () => {
    const client = getRevClient(created.id)!;
    const w = nextWindow(client, today);
    const s = effectiveCycleStatus(client, w, today);
    assert.equal(s.overridden, false);
    assert.equal(s.status, s.real);
    assert.equal(s.status, "due"); // today is the window's first day
  });

  await t.test("a pinned status wins but keeps the real one visible", () => {
    updateRevClient(created.id, { statusOverride: "sent" });
    const client = getRevClient(created.id)!;
    const w = nextWindow(client, today);
    const s = effectiveCycleStatus(client, w, today);
    assert.equal(s.overridden, true);
    assert.equal(s.status, "sent");
    assert.equal(s.real, "due", "the real status is never lost");
  });

  await t.test("a status meaning handled stops the outreach", async () => {
    // "sent" is still pinned from the test above.
    const run = await runReminders({ today, dryRun: true });
    assert.equal(run.reachedOut.length, 0, "a handled row is not chased");
    assert.equal(run.skipped.heldByStatus, 1);
    assert.deepEqual(
      run.heldByStatus.map((h) => [h.client, h.status]),
      [["Pin Co", "sent"]],
      "held clients are named, not just counted"
    );
  });

  await t.test('"requested" stops it too, because they already asked', async () => {
    updateRevClient(created.id, { statusOverride: "requested" });
    const run = await runReminders({ today, dryRun: true });
    assert.equal(run.reachedOut.length, 0);
    assert.equal(run.heldByStatus[0]?.status, "requested");
  });

  await t.test('"due" and "not_due" keep the outreach running', async () => {
    for (const pinned of ["due", "not_due"]) {
      updateRevClient(created.id, { statusOverride: pinned });
      const run = await runReminders({ today, dryRun: true });
      assert.equal(
        run.reachedOut.length,
        1,
        `pinning "${pinned}" still means they have to book, so keep chasing`
      );
      assert.equal(run.skipped.heldByStatus, 0);
    }
  });

  await t.test("clearing it hands the row back to the engine", () => {
    updateRevClient(created.id, { statusOverride: "" });
    const client = getRevClient(created.id)!;
    const s = effectiveCycleStatus(client, nextWindow(client, today), today);
    assert.equal(s.overridden, false);
    assert.equal(s.status, "due");
  });

  await t.test("pausing stops every channel and names the client", async () => {
    updateRevClient(created.id, { outreachPaused: true });
    const run = await runReminders({ today, dryRun: true });
    assert.equal(run.reachedOut.length, 0);
    assert.equal(run.skipped.paused, 1);
    assert.deepEqual(
      run.paused.map((p) => p.client),
      ["Pin Co"],
      "paused clients are named, not just counted"
    );
  });

  await t.test("resuming starts it again", async () => {
    updateRevClient(created.id, { outreachPaused: false });
    const run = await runReminders({ today, dryRun: true });
    assert.equal(run.reachedOut.length, 1);
    assert.equal(run.paused.length, 0);
  });

  await t.test("garbage is not a status", () => {
    assert.equal(isCycleStatus("sent"), true);
    assert.equal(isCycleStatus("shipped"), false);
    assert.equal(isCycleStatus(""), false);
  });
});

// Picking the contact from the Basecamp roster stores their person id, so the
// match cannot be broken by a typo or by them changing their display name.
test("a picked contact resolves by Basecamp id, not by name", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-contact-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const { createRevClient, updateRevClient, getRevClient } = await import(
    "../src/lib/revenue"
  );
  const { findClientContact } = await import("../src/lib/basecamp");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const roster = [
    { id: 101, name: "Jamie Cruz", email_address: "jamie@krak.co", client: true },
    { id: 202, name: "Michael Piarulli", email_address: "mp@meg.com", employee: true },
  ];

  const created = createRevClient({ name: "Krak", businessModel: "home_service" });

  await t.test("a typed name that does not match exactly resolves to nobody", () => {
    updateRevClient(created.id, { contactName: "Jamie", contactEmail: "" });
    const c = getRevClient(created.id)!;
    assert.equal(
      findClientContact(roster, c.contact_email, c.contact_name),
      null,
      '"Jamie" is not "Jamie Cruz", and a near-match must not pick a person'
    );
  });

  await t.test("picking from the roster stores the id and the real name", () => {
    updateRevClient(created.id, {
      basecampContactId: 101,
      contactName: "Jamie Cruz",
      contactEmail: "jamie@krak.co",
    });
    const c = getRevClient(created.id)!;
    assert.equal(c.basecamp_contact_id, 101);
    // Same resolution the sweep does: id first, then the old fallbacks.
    const byId = roster.find((p) => p.id === c.basecamp_contact_id);
    assert.equal(byId?.name, "Jamie Cruz");
  });

  await t.test("the id still matches after they are renamed in Basecamp", () => {
    const renamed = [{ ...roster[0], name: "Jamie Cruz-Alvarez" }, roster[1]];
    const c = getRevClient(created.id)!;
    assert.equal(
      renamed.find((p) => p.id === c.basecamp_contact_id)?.id,
      101,
      "an id survives a rename that would break exact-name matching"
    );
    assert.equal(
      findClientContact(renamed, "", "Jamie Cruz"),
      null,
      "and the old name-based path would indeed have broken"
    );
  });

  await t.test("clearing it hands resolution back to email and name", () => {
    updateRevClient(created.id, { basecampContactId: 0 });
    const c = getRevClient(created.id)!;
    assert.equal(c.basecamp_contact_id, 0);
    assert.equal(
      findClientContact(roster, c.contact_email, c.contact_name)?.id,
      101,
      "email still resolves them"
    );
  });
});

// "Outreach sent" is a hand-set status for outreach that happened off the app,
// a phone call or a conversation. It records that we asked; it does not mean
// they are handled, so the chasing has to continue.
test('"Outreach sent" is settable and keeps the chasing running', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-osent-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const { createRevClient, updateRevClient, getRevClient } = await import(
    "../src/lib/revenue"
  );
  const { runReminders } = await import("../src/lib/reminders");
  const {
    effectiveCycleStatus,
    nextWindow,
    isCycleStatus,
    statusMeansHandled,
    computeCycleStatus,
  } = await import("../src/lib/cadence");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const today = "2026-08-03";
  const created = createRevClient({ name: "Call Co", businessModel: "home_service" });
  updateRevClient(created.id, {
    colorWeek: "red",
    productionCadence: "monthly",
    productionEnrolled: true,
    contactName: "Sam Doe",
    contactEmail: "sam@call.co",
  });

  await t.test("it is a real status and it is not a handled one", () => {
    assert.equal(isCycleStatus("outreach_sent"), true);
    assert.equal(statusMeansHandled("outreach_sent"), false);
  });

  await t.test("the engine never produces it on its own", () => {
    const client = getRevClient(created.id)!;
    const real = computeCycleStatus(client, nextWindow(client, today), today);
    assert.notEqual(real, "outreach_sent");
    assert.equal(real, "due");
  });

  await t.test("setting it pins the row without hiding the real status", () => {
    updateRevClient(created.id, { statusOverride: "outreach_sent" });
    const client = getRevClient(created.id)!;
    const s = effectiveCycleStatus(client, nextWindow(client, today), today);
    assert.equal(s.status, "outreach_sent");
    assert.equal(s.overridden, true);
    assert.equal(s.real, "due");
  });

  // Asserted per client rather than on totals: db.ts resolves its path on first
  // import, so every test in this file shares one database and earlier clients
  // are still in it.
  await t.test("and the sweep keeps chasing, because asking once is not booking", async () => {
    const run = await runReminders({ today, dryRun: true });
    assert.ok(
      run.reachedOut.some((x) => x.clientId === created.id),
      "a row marked Outreach sent is still chased"
    );
    assert.ok(
      !run.heldByStatus.some((h) => h.clientId === created.id),
      "and it is not held"
    );
  });
});

// A videographer's standing day off. Distinct from a client blackout (one
// date) and from being booked (a real production), and the reason it exists is
// that a recurring commitment should not have to be re-entered forever.
test("a videographer's standing days off block those weekdays", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-daysoff-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const {
    createVideographer,
    updateVideographer,
    videographerOffDates,
    unavailableWeekdays,
    formatUnavailableWeekdays,
  } = await import("../src/lib/videographers");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const jack = createVideographer("Jack");

  await t.test("nobody has a day off to begin with", () => {
    assert.deepEqual(unavailableWeekdays(jack), []);
    assert.equal(videographerOffDates(jack.id, "2026-08-01", "2026-08-31").length, 0);
  });

  await t.test("setting Wednesday blocks every Wednesday in a range", () => {
    updateVideographer(jack.id, { unavailableWeekdays: [3] });
    const off = videographerOffDates(jack.id, "2026-08-01", "2026-08-31");
    // August 2026 Wednesdays: 5, 12, 19, 26.
    assert.deepEqual(off, ["2026-08-05", "2026-08-12", "2026-08-19", "2026-08-26"]);
  });

  await t.test("it only blocks that weekday, inside a real window", () => {
    // Blue week's August production window is Mon 10 to Fri 14.
    const off = videographerOffDates(jack.id, "2026-08-10", "2026-08-14");
    assert.deepEqual(off, ["2026-08-12"], "Wednesday only, the rest stay bookable");
  });

  await t.test("it reads back for a human", () => {
    const updated = updateVideographer(jack.id, { unavailableWeekdays: [3] })!;
    assert.equal(formatUnavailableWeekdays(updated), "No Wednesday");
  });

  await t.test("clearing it opens the week back up", () => {
    const cleared = updateVideographer(jack.id, { unavailableWeekdays: [] })!;
    assert.deepEqual(unavailableWeekdays(cleared), []);
    assert.equal(formatUnavailableWeekdays(cleared), "Every weekday");
    assert.equal(videographerOffDates(jack.id, "2026-08-01", "2026-08-31").length, 0);
  });

  await t.test("garbage day numbers are dropped", () => {
    const odd = updateVideographer(jack.id, { unavailableWeekdays: [3, 3, 9, -1] })!;
    assert.deepEqual(unavailableWeekdays(odd), [3], "deduped and bounded");
  });
});
