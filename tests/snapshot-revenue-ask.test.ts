import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Asking the client for last month's revenue from their own snapshot page.
// What matters is when the ask appears and when it stops: it should not nag a
// client for a month we already have a number for, and it should close once
// they answer.

test("client revenue ask", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-revask-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const snapshot = await import("../src/lib/snapshot");
  const revenue = await import("../src/lib/revenue");
  const { getDb, nowIso } = await import("../src/lib/db");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const now = nowIso();
  const insert = getDb().prepare(
    `INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`
  );
  insert.run("cl_1", "Guardian Plumbers", now, now);
  insert.run("cl_2", "Sierra Sprinkler", now, now);
  insert.run("cl_3", "Top Notch Auto", now, now);

  await t.test("the previous month rolls back over a year boundary", () => {
    assert.equal(snapshot.previousMonthOf("2026-08-13"), "2026-07");
    assert.equal(snapshot.previousMonthOf("2026-01-04"), "2025-12");
    assert.equal(snapshot.previousMonthOf("2026-03-01"), "2026-02");
  });

  await t.test("an unanswered month is asked about, labelled for a human", () => {
    const ask = snapshot.revenueAsk("cl_1", "2026-08-03");
    assert.equal(ask?.month, "2026-07");
    assert.equal(ask?.label, "Jul 2026");
    assert.equal(ask?.amount, null);
  });

  await t.test("the ask is still open later in the month, not just week one", () => {
    // The client who opens the link on the 26th is the one we never hear from.
    assert.equal(snapshot.revenueAsk("cl_1", "2026-08-26")?.month, "2026-07");
  });

  await t.test("we don't ask for a month we already have revenue for", () => {
    revenue.upsertMetric({ clientId: "cl_2", month: "2026-07", revenue: 51000 });
    assert.equal(snapshot.revenueAsk("cl_2", "2026-08-03"), null);
  });

  await t.test("a zero-revenue row is not a number we have, so we still ask", () => {
    revenue.upsertMetric({ clientId: "cl_3", month: "2026-07", leads: 12 });
    assert.equal(snapshot.revenueAsk("cl_3", "2026-08-03")?.month, "2026-07");
  });

  await t.test("once they answer, the ask reports back what we received", () => {
    snapshot.upsertRevenueReport({ clientId: "cl_1", month: "2026-07", amount: 48200, note: "two big jobs" });
    const ask = snapshot.revenueAsk("cl_1", "2026-08-13");
    assert.equal(ask?.amount, 48200);
    assert.ok(ask?.reportedAt);
  });

  await t.test("a revised figure replaces the old one and reopens review", () => {
    const first = snapshot.getRevenueReport("cl_1", "2026-07")!;
    snapshot.markRevenueReportAccepted(first.id);
    assert.ok(snapshot.getRevenueReport("cl_1", "2026-07")!.accepted_at);

    snapshot.upsertRevenueReport({ clientId: "cl_1", month: "2026-07", amount: 49500 });
    const revised = snapshot.getRevenueReport("cl_1", "2026-07")!;
    assert.equal(revised.amount, 49500);
    assert.equal(revised.accepted_at, "", "a new figure needs looking at again");
    // One row per client per month, not a pile of revisions.
    assert.equal(snapshot.listRevenueReports("cl_1").length, 1);
    // The note they gave the first time is kept when they don't send a new one.
    assert.equal(revised.note, "two big jobs");
  });

  // What the accept button does: the figure crosses into rev_metrics, tagged as
  // the client's own count, and the ask closes because we now have the number.
  await t.test("accepting a report writes it into the revenue tracker", () => {
    snapshot.upsertRevenueReport({ clientId: "cl_2", month: "2026-06", amount: 33750 });
    const report = snapshot.getRevenueReport("cl_2", "2026-06")!;

    revenue.upsertMetric({
      clientId: report.client_id,
      month: report.month,
      revenue: report.amount,
      revenueSource: "client",
    });
    snapshot.markRevenueReportAccepted(report.id);

    const stored = revenue.listMetrics("cl_2").find((m) => m.month === "2026-06")!;
    assert.equal(stored.revenue, 33750);
    assert.equal(stored.revenue_source, "client");
    assert.ok(snapshot.getRevenueReport("cl_2", "2026-06")!.accepted_at);
    // The ask for that month now reads back as answered rather than blank, so
    // the client sees their own figure confirmed instead of an empty form.
    assert.equal(snapshot.revenueAsk("cl_2", "2026-07-04")?.amount, 33750);
  });

  await t.test("accepting leaves the rest of the month's data alone", () => {
    // cl_3 already had leads logged for 2026-07 from the earlier case.
    snapshot.upsertRevenueReport({ clientId: "cl_3", month: "2026-07", amount: 12000 });
    revenue.upsertMetric({ clientId: "cl_3", month: "2026-07", revenue: 12000, revenueSource: "client" });
    const stored = revenue.listMetrics("cl_3").find((m) => m.month === "2026-07")!;
    assert.equal(stored.revenue, 12000);
    assert.equal(stored.leads, 12, "the activity numbers we already had survive");
  });

  await t.test("a new month asks again on its own", () => {
    const ask = snapshot.revenueAsk("cl_1", "2026-09-02");
    assert.equal(ask?.month, "2026-08");
    assert.equal(ask?.amount, null);
  });

  await t.test("reports never leak across accounts", () => {
    // cl_1 reported July; cl_2 reported June. Neither shows up under the other.
    assert.deepEqual(snapshot.listRevenueReports("cl_1").map((r) => r.month), ["2026-07"]);
    assert.deepEqual(snapshot.listRevenueReports("cl_2").map((r) => r.month), ["2026-06"]);
    assert.equal(snapshot.getRevenueReport("cl_2", "2026-07"), null);
  });

  await t.test("a dismissed report is gone and the ask reopens", () => {
    const r = snapshot.getRevenueReport("cl_1", "2026-07")!;
    assert.equal(snapshot.deleteRevenueReport(r.id), true);
    assert.equal(snapshot.revenueAsk("cl_1", "2026-08-13")?.amount, null);
    assert.equal(snapshot.deleteRevenueReport(r.id), false);
  });
});
