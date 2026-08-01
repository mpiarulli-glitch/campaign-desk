import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Same cwd trick as the other db-backed suites: db.ts resolves its file at
// import time, so point it at a throwaway directory first.

test("reports", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-reports-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const reports = await import("../src/lib/reports");
  const { getDb, nowIso } = await import("../src/lib/db");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const db = getDb();
  const now = nowIso();

  db.prepare(
    `INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`
  ).run("cl_1", "Humble Somm", now, now);

  // Forecast rows: one work task with logged time, one meeting, one unlogged.
  const task = db.prepare(
    `INSERT INTO forecast_tasks
       (id, person, task_date, client, notes, hours, completed, priority,
        basecamp_todo_id, basecamp_project_id, basecamp_event_id,
        actual_hours, basecamp_time_entry_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'flexible', ?, '', ?, ?, ?, ?, ?)`
  );
  task.run("t1", "michael", "2026-07-15", "Humble Somm", "Build email", 4, 1, "todo_1", "", 3.5, "te_1", now, now);
  task.run("t2", "michael", "2026-07-16", "", "Leadership meeting", 1, 1, "", "ev_1", 1, "te_2", now, now);
  task.run("t3", "jack", "2026-07-17", "Humble Somm", "Design pass", 6, 0, "todo_2", "", 0, "", now, now);
  // Outside the range, to prove the filter bites.
  task.run("t4", "jack", "2026-01-05", "Humble Somm", "Old work", 99, 1, "todo_3", "", 99, "te_9", now, now);

  await t.test("every report type builds without throwing", () => {
    for (const meta of reports.REPORTS) {
      const r = reports.buildReport(meta.type, "2026-07-01", "2026-07-31");
      assert.equal(r.type, meta.type);
      assert.ok(r.sections.length > 0, `${meta.type} produced no sections`);
      assert.ok(r.title, `${meta.type} has no title`);
      // Ranged reports carry the range; state-of-play reports must not, or the
      // header would imply a filter that was never applied.
      assert.equal(r.range === null, !meta.ranged, `${meta.type} range mismatch`);
    }
  });

  await t.test("time tracking totals only the rows inside the range", () => {
    const r = reports.buildReport("time_tracking", "2026-07-01", "2026-07-31");
    const totals = r.sections[0].stats!;
    // 4 + 1 + 6 = 11 forecast hours; the January row is excluded.
    assert.equal(totals.find((s) => s.label === "Forecast hours")?.value, "11h");
    // 3.5 + 1 = 4.5 logged.
    assert.equal(totals.find((s) => s.label === "Hours logged")?.value, "4.5h");
    assert.equal(totals.find((s) => s.label === "In meetings")?.value, "1h");
  });

  await t.test("time tracking splits by person and by client", () => {
    const r = reports.buildReport("time_tracking", "2026-07-01", "2026-07-31");
    const byPerson = r.sections.find((s) => s.title === "By person")!;
    assert.equal(byPerson.rows!.length, 2);
    // Ordered by forecast hours: Jack's 6 beats Michael's 5.
    assert.equal(byPerson.rows![0][0], "Jack");
    assert.equal(byPerson.rows![0][3], "6h");

    const byClient = r.sections.find((s) => s.title === "By client")!;
    const internal = byClient.rows!.find((row) => row[0] === "No client (internal)");
    assert.ok(internal, "a meeting with no client should still be counted");
  });

  await t.test("an empty range reports zero rather than failing", () => {
    const r = reports.buildReport("time_tracking", "2020-01-01", "2020-01-31");
    const totals = r.sections[0].stats!;
    assert.equal(totals.find((s) => s.label === "Forecast hours")?.value, "0h");
    const byPerson = r.sections.find((s) => s.title === "By person")!;
    assert.equal(byPerson.rows!.length, 0);
    // The section still declares its empty-state copy so the page has something
    // to render instead of a bare heading.
    assert.ok(byPerson.empty);
  });

  await t.test("a malformed key_results blob does not take the OKR report down", () => {
    db.prepare(
      `INSERT INTO client_okrs (id, client_id, objective, key_results, status, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'on_track', 1, ?, ?)`
    ).run("okr_bad", "cl_1", "Grow the list", "not json at all", now, now);
    db.prepare(
      `INSERT INTO client_okrs (id, client_id, objective, key_results, status, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'at_risk', 1, ?, ?)`
    ).run("okr_ok", "cl_1", "Lift revenue", '[{"done":true},{"done":false}]', now, now);

    const r = reports.buildReport("okrs", "2026-07-01", "2026-07-31");
    const table = r.sections.find((s) => s.title === "Objectives")!;
    assert.equal(table.rows!.length, 2);
    // The good one still counts its key results.
    const good = table.rows!.find((row) => row[1] === "Lift revenue")!;
    assert.equal(good[3], "1/2");
    // The bad one degrades to a dash rather than throwing.
    const bad = table.rows!.find((row) => row[1] === "Grow the list")!;
    assert.equal(bad[3], "—");
  });

  await t.test("team sentiment names who never checked in", () => {
    db.prepare(
      `INSERT INTO sentiment_checkins (id, person, month, score, note, created_at, updated_at)
       VALUES (?, 'michael', '2026-07', 4, 'Good month', ?, ?)`
    ).run("sc_1", now, now);
    const r = reports.buildReport("team_sentiment", "2026-07-01", "2026-07-31");
    const stats = r.sections[0].stats!;
    assert.equal(stats.find((s) => s.label === "Average score")?.value, "4.0");
    const missing = stats.find((s) => s.label === "Never checked in")!;
    // Everyone except Michael.
    assert.equal(missing.value, "8");
    assert.ok(missing.hint!.includes("Jack"));
  });

  await t.test("client sentiment separates open flags from resolved", () => {
    const flag = db.prepare(
      `INSERT INTO client_flags (id, client_id, level, note, created_by, resolved, resolved_by, resolved_at, created_at, updated_at)
       VALUES (?, 'cl_1', ?, ?, 'michael', ?, ?, ?, ?, ?)`
    );
    flag.run("f1", "red", "Client unhappy with turnaround", 0, "", null, "2026-07-10T12:00:00.000Z", now);
    flag.run("f2", "yellow", "Slow to approve", 1, "michael", "2026-07-20T12:00:00.000Z", "2026-07-12T12:00:00.000Z", now);

    const r = reports.buildReport("client_sentiment", "2026-07-01", "2026-07-31");
    const stats = r.sections[0].stats!;
    assert.equal(stats.find((s) => s.label === "Flags raised")?.value, "2");
    assert.equal(stats.find((s) => s.label === "Still open")?.value, "1");
    assert.equal(stats.find((s) => s.label === "Red flags")?.value, "1");

    const byClient = r.sections.find((s) => s.title === "By client")!;
    // Worst level wins for the client summary, not the most recent.
    assert.equal(byClient.rows![0][3], "Red");
  });

  await t.test("deliverables flag the ones never reported on", () => {
    db.prepare(
      `INSERT INTO snapshot_deliverables (id, client_id, name, category, kind, cadence, cadence_unit, active, created_at, updated_at)
       VALUES (?, 'cl_1', ?, 'Email', 'recurring', '2 per month', 'monthly', 1, ?, ?)`
    ).run("d1", "Broadcast emails", now, now);
    db.prepare(
      `INSERT INTO snapshot_deliverables (id, client_id, name, category, kind, cadence, cadence_unit, active, created_at, updated_at)
       VALUES (?, 'cl_1', ?, 'SEO', 'one_time', '', 'monthly', 1, ?, ?)`
    ).run("d2", "Site audit", now, now);
    db.prepare(
      `INSERT INTO snapshot_entries (id, deliverable_id, client_id, week_start, status, work_done, next_steps, notes, created_at, updated_at)
       VALUES (?, 'd1', 'cl_1', '2026-07-06', 'done', 'Sent both', '', '', ?, ?)`
    ).run("se_1", now, now);

    const r = reports.buildReport("deliverables", "2026-07-01", "2026-07-31");
    const stats = r.sections[0].stats!;
    assert.equal(stats.find((s) => s.label === "Active deliverables")?.value, "2");
    assert.equal(stats.find((s) => s.label === "Never reported on")?.value, "1");

    const table = r.sections.find((s) => s.title === "Deliverables")!;
    const audit = table.rows!.find((row) => row[1] === "Site audit")!;
    assert.equal(audit[6], "Never");
  });

  await t.test("weekly snapshots roll up by client", () => {
    const r = reports.buildReport("weekly_snapshots", "2026-07-01", "2026-07-31");
    const stats = r.sections[0].stats!;
    assert.equal(stats.find((s) => s.label === "Entries reported")?.value, "1");
    const entries = r.sections.find((s) => s.title === "Entries")!;
    assert.equal(entries.rows![0][1], "Humble Somm");
    assert.equal(entries.rows![0][3], "Done");
  });

  await t.test("CSV escapes quotes, commas and newlines", () => {
    db.prepare(
      `INSERT INTO client_flags (id, client_id, level, note, created_by, resolved, created_at, updated_at)
       VALUES (?, 'cl_1', 'yellow', ?, 'michael', 0, '2026-07-15T12:00:00.000Z', ?)`
    ).run("f3", 'Said "too slow", twice', now);

    const csv = reports.reportToCsv(
      reports.buildReport("client_sentiment", "2026-07-01", "2026-07-31")
    );
    // A quote inside a field is doubled and the field is wrapped.
    assert.ok(csv.includes('"Said ""too slow"", twice"'), "quotes should be escaped");
    // Header row is present for the table sections.
    assert.ok(csv.includes("Client,Flags,Open,Worst level"));
    // Stat sections come through as measure/value pairs.
    assert.ok(csv.includes("Measure,Value,Detail"));
  });

  await t.test("an unknown report type is rejected", () => {
    assert.equal(reports.isReportType("time_tracking"), true);
    assert.equal(reports.isReportType("nope"), false);
    assert.equal(reports.isReportType(""), false);
    assert.equal(reports.isReportType(null), false);
  });
});
