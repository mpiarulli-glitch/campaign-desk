import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// How the weekly snapshot handles cadences longer than a week, and what the
// contract-fulfillment figure is allowed to claim. Both used to misreport in ways
// a client would see, so these are about the numbers on screen rather than the
// internals underneath them.

test("monthly and quarterly deliverables across the weeks of a period", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-period-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const snapshot = await import("../src/lib/snapshot");
  const { getDb, nowIso } = await import("../src/lib/db");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const now = nowIso();
  const client = (id: string) => {
    getDb()
      .prepare(`INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(id, `Client ${id}`, now, now);
    return id;
  };

  // Four Mondays inside one month, so "the same period" is exercised with real
  // week keys rather than period-aligned ones.
  const WEEK_1 = "2026-03-02";
  const WEEK_3 = "2026-03-16";
  const WEEK_4 = "2026-03-23";
  const APRIL = "2026-04-06";

  await t.test("a status set mid-month does not rewrite earlier weeks", () => {
    const id = client("per_hold");
    const d = snapshot.createDeliverable({
      clientId: id,
      category: "Email",
      name: "Monthly newsletter",
      cadence: "1 per month",
      cadenceUnit: "monthly",
    });

    snapshot.upsertEntry({
      deliverableId: d.id,
      weekStart: WEEK_3,
      status: "completed",
      workDone: "Sent it",
    });

    const week1 = snapshot.weekData(id, WEEK_1).find((r) => r.deliverable_id === d.id)!;
    assert.equal(week1.status, "not_started", "earlier weeks in the month stay open");
    for (const week of [WEEK_3, WEEK_4]) {
      const row = snapshot.weekData(id, week).find((r) => r.deliverable_id === d.id)!;
      assert.equal(row.status, "completed", `week of ${week}`);
      assert.equal(row.work_done, "Sent it");
    }

    // And it resets once a new month actually starts.
    const april = snapshot.weekData(id, APRIL).find((r) => r.deliverable_id === d.id)!;
    assert.equal(april.status, "not_started");
    assert.equal(april.work_done, "");
  });

  await t.test("editing from an earlier week in the period is not lost", () => {
    const id = client("per_earlier");
    const d = snapshot.createDeliverable({
      clientId: id,
      category: "Email",
      name: "Monthly newsletter",
      cadence: "1 per month",
      cadenceUnit: "monthly",
    });

    // Logged in week 3, then the text was corrected while looking at week 1.
    // The correction must stick on the week-3 row — it must not stamp Complete
    // onto week 1.
    snapshot.upsertEntry({
      deliverableId: d.id,
      weekStart: WEEK_3,
      status: "in_progress",
      workDone: "Drafted",
    });
    snapshot.upsertEntry({
      deliverableId: d.id,
      weekStart: WEEK_1,
      status: "completed",
      workDone: "Actually sent",
    });

    const week1 = snapshot.weekData(id, WEEK_1).find((r) => r.deliverable_id === d.id)!;
    assert.equal(week1.status, "not_started", "earlier week stays open");
    for (const week of [WEEK_3, WEEK_4]) {
      const row = snapshot.weekData(id, week).find((r) => r.deliverable_id === d.id)!;
      assert.equal(row.status, "completed", `week of ${week}`);
      assert.equal(row.work_done, "Actually sent", `week of ${week}`);
    }
  });

  await t.test("a month keeps one entry, not one per week edited", () => {
    const id = client("per_onerow");
    const d = snapshot.createDeliverable({
      clientId: id,
      category: "Email",
      name: "Monthly newsletter",
      cadence: "1 per month",
      cadenceUnit: "monthly",
    });

    for (const week of [WEEK_1, WEEK_3, WEEK_4]) {
      snapshot.upsertEntry({ deliverableId: d.id, weekStart: week, status: "in_progress" });
    }
    const rows = getDb()
      .prepare(`SELECT week_start FROM snapshot_entries WHERE deliverable_id = ?`)
      .all(d.id) as Array<{ week_start: string }>;
    assert.equal(rows.length, 1, "a monthly deliverable has one entry per month");
    assert.equal(rows[0].week_start, WEEK_4, "filed under the week it was last logged");
  });

  await t.test("a weekly deliverable still gets one entry per week", () => {
    const id = client("per_weekly");
    const d = snapshot.createDeliverable({
      clientId: id,
      category: "Social",
      name: "Weekly posts",
      cadence: "3 per week",
      cadenceUnit: "weekly",
    });

    snapshot.upsertEntry({ deliverableId: d.id, weekStart: WEEK_1, status: "completed" });
    snapshot.upsertEntry({ deliverableId: d.id, weekStart: WEEK_3, status: "in_progress" });

    assert.equal(
      snapshot.weekData(id, WEEK_1).find((r) => r.deliverable_id === d.id)!.status,
      "completed"
    );
    assert.equal(
      snapshot.weekData(id, WEEK_3).find((r) => r.deliverable_id === d.id)!.status,
      "in_progress"
    );
    // A week nobody logged reads as not started, which is the point of a weekly
    // cadence.
    assert.equal(
      snapshot.weekData(id, WEEK_4).find((r) => r.deliverable_id === d.id)!.status,
      "not_started"
    );
  });

  await t.test("the week grid is scoped to a team, like the deliverable list", () => {
    const id = client("per_scoped");
    snapshot.createDeliverable({
      clientId: id, category: "Email", name: "Broadcasts", cadence: "", team: "email",
    });
    snapshot.createDeliverable({
      clientId: id, category: "SEO", name: "Blog posts", cadence: "", team: "seo",
    });
    snapshot.createDeliverable({
      clientId: id, category: "Strategy", name: "Quarterly review", cadence: "",
    });

    const seo = snapshot.weekData(id, WEEK_1, { team: "seo" }).map((r) => r.name).sort();
    assert.deepEqual(seo, ["Blog posts"]);

    // No team means everything, which is what an admin gets.
    assert.equal(snapshot.weekData(id, WEEK_1).length, 3);
    assert.equal(snapshot.weekData(id, WEEK_1, { team: null }).length, 3);
  });

  await t.test("one-time complete does not rewrite earlier weeks", () => {
    const id = client("per_onetime_asof");
    const d = snapshot.createDeliverable({
      clientId: id, category: "Email", name: "Klaviyo setup", cadence: "", kind: "one_time",
    });
    snapshot.upsertEntry({
      deliverableId: d.id,
      weekStart: WEEK_3,
      status: "completed",
      workDone: "Installed",
    });
    const week1 = snapshot.weekData(id, WEEK_1).find((r) => r.deliverable_id === d.id)!;
    assert.equal(week1.status, "not_started");
    const week3 = snapshot.weekData(id, WEEK_3).find((r) => r.deliverable_id === d.id)!;
    assert.equal(week3.status, "completed");
  });
});

test("contract fulfillment does not call an open period a miss", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-contract-pct-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const snapshot = await import("../src/lib/snapshot");
  const { getDb, nowIso } = await import("../src/lib/db");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const now = nowIso();
  const client = (id: string) => {
    getDb()
      .prepare(`INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(id, `Client ${id}`, now, now);
    return id;
  };
  // A deliverable that existed before the current period started, which is what
  // makes it eligible to be judged late.
  const olderDeliverable = (clientId: string, name: string, unit: "monthly" | "quarterly") => {
    const d = snapshot.createDeliverable({
      clientId, category: "Email", name, cadence: unit === "monthly" ? "Monthly" : "Quarterly", cadenceUnit: unit,
    });
    getDb()
      .prepare(`UPDATE snapshot_deliverables SET created_at = ? WHERE id = ?`)
      .run("2020-01-01T00:00:00.000Z", d.id);
    return d;
  };

  await t.test("a fresh month with nothing logged yet is not 'significantly behind'", () => {
    const id = client("per_fresh");
    const d = olderDeliverable(id, "Monthly newsletter", "monthly");
    // The period that just closed was delivered; this one has only just begun.
    const lastMonth = snapshot.periodStartFor(
      "monthly",
      new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15)
        .toISOString()
        .slice(0, 10)
    );
    snapshot.upsertEntry({ deliverableId: d.id, weekStart: lastMonth, status: "completed" });

    const status = snapshot.contractStatus(id);
    // The old reading was 0% and "Significantly behind" on the 2nd of every
    // month, because the open period had no entry in it yet.
    assert.notEqual(status.label, "Significantly behind");
    assert.equal(status.onTrack, true);
    assert.equal(status.pct, 100);
  });

  await t.test("a deliverable too new to have a closed period is in flight", () => {
    const id = client("per_brandnew");
    // Added today, so its first month is still running and there is no fact yet
    // about whether it will be delivered.
    snapshot.createDeliverable({
      clientId: id, category: "Email", name: "Brand new", cadence: "Monthly", cadenceUnit: "monthly",
    });

    const status = snapshot.contractStatus(id);
    assert.equal(status.inFlightCount, 1);
    assert.equal(status.totalCount, 0);
    assert.equal(status.label, "Nothing due yet");
    assert.equal(status.onTrack, true);
  });

  await t.test("a genuinely missed period does count against the score", () => {
    const id = client("per_missed");
    olderDeliverable(id, "Monthly newsletter", "monthly"); // never logged at all

    const behind = snapshot.behindDeliverablesForClient(id);
    assert.equal(behind.length, 1, "the closed period was missed");

    const status = snapshot.contractStatus(id);
    assert.equal(status.pct, 0);
    assert.equal(status.totalCount, 1);
    assert.equal(status.label, "Significantly behind");
    assert.equal(status.onTrack, false);
  });

  await t.test("the percentage and the overdue banner never contradict", () => {
    const id = client("per_agree");
    const kept = olderDeliverable(id, "Kept promise", "monthly");
    olderDeliverable(id, "Missed promise", "monthly");

    // Deliver one of the two in the period that just closed.
    const lastMonth = snapshot.periodStartFor(
      "monthly",
      new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15)
        .toISOString()
        .slice(0, 10)
    );
    snapshot.upsertEntry({ deliverableId: kept.id, weekStart: lastMonth, status: "approved" });

    const status = snapshot.contractStatus(id);
    const behind = snapshot.behindDeliverablesForClient(id);
    assert.equal(behind.length, 1);
    assert.equal(status.totalCount - status.doneCount, behind.length);
    assert.equal(status.pct, 50);
  });

  await t.test("shared (awaiting approval) still meets the closed-period contract", () => {
    const id = client("per_shared");
    const d = olderDeliverable(id, "Monthly newsletter", "monthly");
    const lastMonth = snapshot.periodStartFor(
      "monthly",
      new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15)
        .toISOString()
        .slice(0, 10)
    );
    snapshot.upsertEntry({ deliverableId: d.id, weekStart: lastMonth, status: "shared" });

    const behind = snapshot.behindDeliverablesForClient(id);
    assert.equal(behind.length, 0);
    const status = snapshot.contractStatus(id);
    assert.equal(status.pct, 100);
    assert.equal(status.doneCount, 1);
    assert.equal(status.onTrack, true);
  });

  await t.test("scheduled still meets the closed-period contract", () => {
    const id = client("per_sched");
    const d = olderDeliverable(id, "Monthly newsletter", "monthly");
    const lastMonth = snapshot.periodStartFor(
      "monthly",
      new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15)
        .toISOString()
        .slice(0, 10)
    );
    snapshot.upsertEntry({ deliverableId: d.id, weekStart: lastMonth, status: "scheduled" });

    const behind = snapshot.behindDeliverablesForClient(id);
    assert.equal(behind.length, 0);
    const status = snapshot.contractStatus(id);
    assert.equal(status.pct, 100);
    assert.equal(status.doneCount, 1);
    assert.equal(status.onTrack, true);
  });

  await t.test("sent for approval is not delivered and still counts as a miss", () => {
    const id = client("per_sent");
    const d = olderDeliverable(id, "Monthly newsletter", "monthly");
    const lastMonth = snapshot.periodStartFor(
      "monthly",
      new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15)
        .toISOString()
        .slice(0, 10)
    );
    snapshot.upsertEntry({ deliverableId: d.id, weekStart: lastMonth, status: "sent_for_approval" });

    const behind = snapshot.behindDeliverablesForClient(id);
    assert.equal(behind.length, 1);
    assert.equal(behind[0].status, "sent_for_approval");
    const status = snapshot.contractStatus(id);
    assert.equal(status.pct, 0);
    assert.equal(status.onTrack, false);
  });

  await t.test("one-time shared work is treated as delivered in the overview", () => {
    const id = client("per_onetime_shared");
    const d = snapshot.createDeliverable({
      clientId: id, category: "Email", name: "Klaviyo setup", cadence: "", kind: "one_time",
    });
    getDb()
      .prepare(`UPDATE snapshot_deliverables SET due_date = ?, created_at = ? WHERE id = ?`)
      .run("2020-01-15", "2020-01-01T00:00:00.000Z", d.id);
    snapshot.upsertEntry({ deliverableId: d.id, weekStart: "2020-01-06", status: "shared" });

    const overview = snapshot.deliverableOverview(id);
    assert.equal(overview.length, 1);
    assert.ok(overview[0].completed_on);
    assert.equal(overview[0].status, "completed");
    assert.equal(snapshot.behindDeliverablesForClient(id).length, 0);
  });

  await t.test("notes do not silently mark a week complete", () => {
    const id = client("per_notes_met");
    const d = olderDeliverable(id, "Monthly newsletter", "monthly");
    const lastMonth = snapshot.periodStartFor(
      "monthly",
      new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15)
        .toISOString()
        .slice(0, 10)
    );
    snapshot.upsertEntry({
      deliverableId: d.id,
      weekStart: lastMonth,
      status: "in_progress",
      workDone: "Published the July issue",
    });
    const row = snapshot.weekData(id, lastMonth).find((r) => r.deliverable_id === d.id)!;
    assert.equal(row.status, "in_progress");
  });

  await t.test("one-time setup work is not a recurring promise", () => {
    const id = client("per_onetime");
    snapshot.createDeliverable({
      clientId: id, category: "Email", name: "Klaviyo setup", cadence: "", kind: "one_time",
    });
    const status = snapshot.contractStatus(id);
    assert.equal(status.totalCount, 0);
    assert.equal(status.label, "No recurring deliverables");
  });
});
