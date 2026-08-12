import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mondayOf, addWeeks } from "../src/lib/week";

// Who logged a snapshot entry, and how far the client-facing week picker may
// travel. The first is a new record and the second used to be unbounded, so a
// client could page forward for years reading "no updates yet".

test("actor tags render as names, and mark an impersonated write", async () => {
  const { actorLabel } = await import("../src/lib/people");

  assert.equal(actorLabel("randi"), "Randi");
  // Admin-only logins are in a separate roster; personLabel alone rendered these
  // as their raw slug.
  assert.equal(actorLabel("kyle_onstott"), "Kyle Onstott");
  assert.equal(actorLabel("michael"), "Michael");
  // An unknown slug degrades to itself rather than to nothing.
  assert.equal(actorLabel("someone_new"), "someone_new");
  assert.equal(actorLabel(""), "");

  // The marker is kept visible: the session cookie does not record which admin was
  // acting, so filing the work under this person unmarked would credit it to
  // someone who may not have done it.
  assert.equal(actorLabel("randi:impersonated"), "Randi (via admin)");
});

test("snapshot entry authorship and week bounds", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-author-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const { getDb, nowIso } = await import("../src/lib/db");
  const snapshot = await import("../src/lib/snapshot");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const client = (id: string) => {
    const now = nowIso();
    getDb()
      .prepare(`INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(id, `Client ${id}`, now, now);
    return id;
  };
  const deliverable = (clientId: string, name: string, unit: "weekly" | "monthly" = "weekly") =>
    snapshot.createDeliverable({
      clientId, category: "Email", name, cadence: "", cadenceUnit: unit,
    });

  const THIS_WEEK = mondayOf(new Date());
  const LAST_WEEK = addWeeks(THIS_WEEK, -1);
  const NEXT_WEEK = addWeeks(THIS_WEEK, 1);

  await t.test("the author is recorded and read back with the row", () => {
    const id = client("auth_basic");
    const d = deliverable(id, "Broadcast emails");

    snapshot.upsertEntry({
      deliverableId: d.id,
      weekStart: THIS_WEEK,
      status: "completed",
      workDone: "Sent the September newsletter",
      loggedBy: "randi",
    });

    const row = snapshot.weekData(id, THIS_WEEK).find((r) => r.deliverable_id === d.id)!;
    assert.equal(row.logged_by, "randi");
    assert.ok(row.updated_at, "the time it was logged comes back too");
  });

  await t.test("the last person to touch the row owns it", () => {
    const id = client("auth_last");
    const d = deliverable(id, "Broadcast emails");

    snapshot.upsertEntry({ deliverableId: d.id, weekStart: THIS_WEEK, status: "in_progress", loggedBy: "randi" });
    snapshot.upsertEntry({ deliverableId: d.id, weekStart: THIS_WEEK, status: "completed", loggedBy: "carlos" });

    assert.equal(
      snapshot.weekData(id, THIS_WEEK).find((r) => r.deliverable_id === d.id)!.logged_by,
      "carlos"
    );
  });

  await t.test("saving one field does not blank the author of the rest", () => {
    const id = client("auth_field");
    const d = deliverable(id, "Broadcast emails");

    // The admin page saves field by field on blur. A later write that carries no
    // author (a script, or a caller with no session) must not erase a real name.
    snapshot.upsertEntry({ deliverableId: d.id, weekStart: THIS_WEEK, workDone: "Drafted", loggedBy: "randi" });
    snapshot.upsertEntry({ deliverableId: d.id, weekStart: THIS_WEEK, nextSteps: "Schedule it" });

    const row = snapshot.weekData(id, THIS_WEEK).find((r) => r.deliverable_id === d.id)!;
    assert.equal(row.logged_by, "randi");
    assert.equal(row.work_done, "Drafted");
    assert.equal(row.next_steps, "Schedule it");
  });

  await t.test("an entry nobody has touched has no author", () => {
    const id = client("auth_none");
    const d = deliverable(id, "Broadcast emails");
    const row = snapshot.weekData(id, THIS_WEEK).find((r) => r.deliverable_id === d.id)!;
    assert.equal(row.logged_by, "");
    assert.equal(row.updated_at, "");
  });

  await t.test("the author travels with a monthly item across its whole period", () => {
    const id = client("auth_monthly");
    const d = deliverable(id, "Monthly newsletter", "monthly");
    snapshot.upsertEntry({
      deliverableId: d.id, weekStart: THIS_WEEK, status: "completed", loggedBy: "carlos",
    });

    // Every week inside the month resolves to the same entry, so it names the same
    // person rather than only doing so in the week it was typed.
    for (const week of [THIS_WEEK, addWeeks(THIS_WEEK, 1), addWeeks(THIS_WEEK, -1)]) {
      const rows = snapshot.weekData(id, week);
      const row = rows.find((r) => r.deliverable_id === d.id);
      // Only assert for weeks that fall in the same month as today.
      if (row && week.slice(0, 7) === THIS_WEEK.slice(0, 7)) {
        assert.equal(row.logged_by, "carlos", `week of ${week}`);
      }
    }
  });

  await t.test("the week picker stops at the first week logged and at this week", () => {
    const id = client("auth_bounds");
    const d = deliverable(id, "Broadcast emails");

    // Nothing logged: no floor to offer, and the ceiling is this week.
    const empty = snapshot.weekBounds(id);
    assert.equal(empty.earliest, "");
    assert.equal(empty.latest, THIS_WEEK);

    snapshot.upsertEntry({ deliverableId: d.id, weekStart: LAST_WEEK, status: "completed" });
    snapshot.upsertEntry({ deliverableId: d.id, weekStart: THIS_WEEK, status: "in_progress" });

    const bounds = snapshot.weekBounds(id);
    assert.equal(bounds.earliest, LAST_WEEK);
    // The ceiling is this week, never a week in the future, so the client cannot
    // page into empty weeks that read like the account going quiet.
    assert.equal(bounds.latest, THIS_WEEK);
  });

  await t.test("an entry filed ahead of today still yields a usable range", () => {
    const id = client("auth_future");
    const d = deliverable(id, "Broadcast emails");
    // A period-keyed entry can sit ahead of today. The range must not end before
    // it begins.
    snapshot.upsertEntry({ deliverableId: d.id, weekStart: NEXT_WEEK, status: "in_progress" });

    const bounds = snapshot.weekBounds(id);
    assert.equal(bounds.earliest, NEXT_WEEK);
    assert.ok(bounds.latest >= bounds.earliest, `${bounds.earliest} .. ${bounds.latest}`);
  });
});
