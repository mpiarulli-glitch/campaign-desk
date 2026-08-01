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
    // Neither fixture was tagged, so both count as unscoped.
    assert.equal(stats.find((s) => s.label === "No owning team")?.value, "2");

    const table = r.sections.find((s) => s.title === "Deliverables")!;
    const audit = table.rows!.find((row) => row[1] === "Site audit")!;
    // Looked up by column name rather than position, so adding a column to the
    // report does not break this assertion the way a hardcoded index did.
    const col = (name: string) => audit[table.columns!.indexOf(name)];
    assert.equal(col("Last reported"), "Never");
    // Untagged deliverables read as "Any", i.e. visible to every team.
    assert.equal(col("Team"), "Any");
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

  await t.test("capacity counts tasks by traffic light", () => {
    // Michael: one flexible task (t1) and one flexible meeting (t2).
    // Jack: one flexible task (t3). The January row is out of range.
    const r = reports.buildReport("capacity", "2026-07-01", "2026-07-31");
    const light = r.sections.find((s) => s.title === "Traffic light")!.stats!;
    assert.equal(light.find((s) => s.label === "Red · urgent")?.value, "0");
    assert.equal(light.find((s) => s.label === "Yellow · important")?.value, "0");
    // Two flexible tasks (t1, t3). The meeting (t2) is counted as a meeting,
    // not as green work, so it can't be read as movable.
    assert.equal(light.find((s) => s.label === "Green · flexible")?.value, "2");
    assert.equal(light.find((s) => s.label === "In meetings")?.value, "1h");
  });

  await t.test("a booked meeting is never offered as reallocatable", () => {
    const r = reports.buildReport("capacity", "2026-07-01", "2026-07-31");
    const moveable = r.sections.find((s) => s.title.startsWith("Hours you could move"))!.stats!;
    // Flexible hours are t1 (4h) + t3 (6h) = 10h. The 1h meeting (t2) carries a
    // basecamp_event_id and defaults to flexible, but cannot be moved.
    assert.equal(moveable.find((s) => s.label === "On flexible work")?.value, "10h");
    assert.equal(moveable.find((s) => s.label === "Booked")?.value, "11h");
  });

  await t.test("only people who forecast are counted, the rest are listed apart", () => {
    const r = reports.buildReport("capacity", "2026-07-01", "2026-07-31");
    const byPerson = r.sections.find((s) => s.title === "By person")!;
    assert.deepEqual(
      byPerson.rows!.map((row) => row[0]).sort(),
      ["Jack", "Michael"]
    );
    const none = r.sections.find((s) => s.title === "No forecast entered")!;
    assert.ok(none.rows!.some((row) => row[0] === "Paula"));
    assert.ok(!none.rows!.some((row) => row[0] === "Jack"));
  });

  await t.test("a wide range does not invent capacity from unplanned weeks", () => {
    // The regression: over a 3-month range, someone who forecast a single week
    // was credited with the whole quarter (66 workdays x 8h = 528h), so 1h
    // booked read as 527h free. Capacity must follow the weeks they planned.
    const r = reports.buildReport("capacity", "2026-05-01", "2026-08-01");
    const byPerson = r.sections.find((s) => s.title === "By person")!;
    const jack = byPerson.rows!.find((row) => row[0] === "Jack")!;
    // Jack has one row (t3, 6h flexible) in one week: 40h capacity, 34h free,
    // and the 6h is itself movable, so 40h reallocatable — not 527h.
    assert.equal(jack[4], "6h");
    assert.equal(jack[5], "34h");
    assert.equal(jack[6], "40h");

    for (const row of byPerson.rows!) {
      assert.ok(
        Number(row[5].replace("h", "")) <= 40,
        `${row[0]} was credited ${row[5]} free from a single planned week`
      );
    }
  });

  await t.test("an empty range reports no capacity rather than a free team", () => {
    const r = reports.buildReport("capacity", "2020-01-01", "2020-01-31");
    const moveable = r.sections.find((s) => s.title.startsWith("Hours you could move"))!.stats!;
    // Nobody forecast, so nobody's 40h counts. A blank range is not a free one.
    assert.equal(moveable.find((s) => s.label === "Reallocatable")?.value, "0h");
    assert.equal(r.sections.find((s) => s.title === "By person")!.rows!.length, 0);
  });

  await t.test("approvals ageing splits the queue by who is holding it", () => {
    const ago = (days: number) =>
      new Date(Date.now() - days * 86_400_000).toISOString();
    const camp = db.prepare(
      `INSERT INTO campaigns
         (id, title, client_name, client_id, status, magic_token, external_token,
          created_at, updated_at, approved_at, basecamp_approval_sent_at)
       VALUES (?, ?, ?, 'cl_1', ?, ?, ?, ?, ?, ?, ?)`
    );
    // Two on the client, one back on us, one already approved.
    camp.run("ap1", "Old promo", "Humble Somm", "in_review", "mt1", "et1", ago(40), ago(40), null, null);
    camp.run("ap2", "Fresh promo", "Humble Somm", "in_review", "mt2", "et2", ago(2), ago(2), null, null);
    camp.run("ap3", "Needs a rewrite", "Krak Boba", "needs_changes", "mt3", "et3", ago(9), ago(9), null, null);
    camp.run("ap4", "Done deal", "Humble Somm", "approved", "mt4", "et4", "2026-07-01T00:00:00.000Z", ago(1), "2026-07-11T00:00:00.000Z", null);

    const r = reports.buildReport("approvals_ageing", "2026-07-01", "2026-07-31");
    const stand = r.sections[0].stats!;
    assert.equal(stand.find((s) => s.label === "Open approvals")?.value, "3");
    assert.equal(stand.find((s) => s.label === "With the client")?.value, "2");
    assert.equal(stand.find((s) => s.label === "With us")?.value, "1");

    // Buckets: 2d, 9d and 40d land in three different bands.
    const buckets = r.sections.find((s) => s.title === "Age of open approvals")!;
    const row = (label: string) => buckets.rows!.find((x) => x[0] === label)!;
    assert.equal(row("0–3 days")[1], "1");
    assert.equal(row("8–14 days")[1], "1");
    assert.equal(row("Over 30 days")[1], "1");
    assert.equal(row("4–7 days")[1], "0");

    // Oldest first, and the approved one never appears in the open list.
    const list = r.sections.find((s) => s.title.startsWith("Every open approval"))!;
    assert.deepEqual(list.rows!.map((x) => x[0]), ["Old promo", "Needs a rewrite", "Fresh promo"]);
    assert.equal(list.rows![0][2], "Client");
    assert.equal(list.rows![1][2], "Us");
  });

  await t.test("ageing ignores the range for open work but honours it for approvals", () => {
    // The 40-day-old package must survive a narrow recent range: filtering open
    // items by date would hide exactly the ones worth seeing.
    const narrow = reports.buildReport("approvals_ageing", "2026-07-25", "2026-07-31");
    assert.equal(narrow.sections[0].stats!.find((s) => s.label === "Open approvals")?.value, "3");
    // ap4 was approved on 2026-07-11, outside that window.
    assert.equal(
      narrow.sections.find((s) => s.title === "Approved in this range")!.stats![0].value,
      "0"
    );

    const wide = reports.buildReport("approvals_ageing", "2026-07-01", "2026-07-31");
    const settled = wide.sections.find((s) => s.title === "Approved in this range")!.stats!;
    assert.equal(settled[0].value, "1");
    // Uploaded 2026-07-01, approved 2026-07-11.
    assert.equal(settled.find((s) => s.label === "Median turnaround")?.value, "10d");
  });

  await t.test("unanswered client messages reads the cache, newest last", () => {
    const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
    const msg = db.prepare(
      `INSERT INTO basecamp_client_messages
         (id, project_id, client_id, client_name, title, app_url, author_name,
          created_at, last_client_at, last_team_at, reply_count, awaiting_reply, synced_at)
       VALUES (?, ?, 'cl_1', ?, ?, '', ?, ?, ?, ?, ?, ?, ?)`
    );
    msg.run("p1:1", "p1", "Humble Somm", "Where is the draft?", "Katie", ago(20), ago(20), "", 0, 1, ago(0));
    msg.run("p1:2", "p1", "Humble Somm", "Logo files", "Katie", ago(6), ago(5), ago(9), 2, 1, ago(0));
    msg.run("p2:3", "p2", "Krak Boba", "Answered already", "Sam", ago(30), ago(12), ago(2), 3, 0, ago(0));

    const r = reports.buildReport("client_messages", "2026-07-01", "2026-07-31");
    // Not ranged: an old unanswered message is the point, so no date filter.
    assert.equal(r.range, null);

    const top = r.sections[0].stats!;
    assert.equal(top.find((s) => s.label === "Unanswered")?.value, "2");
    assert.equal(top.find((s) => s.label === "Oldest")?.value, "20d");
    assert.equal(top.find((s) => s.label === "Clients affected")?.value, "1");

    // The answered thread is tracked but never listed as waiting.
    const list = r.sections.find((s) => s.title.startsWith("Every unanswered"))!;
    assert.deepEqual(list.rows!.map((x) => x[0]), ["Where is the draft?", "Logo files"]);
    assert.ok(!list.rows!.some((x) => x[0] === "Answered already"));

    // Coverage is reported so an empty result is never mistaken for good news.
    const cov = r.sections.find((s) => s.title === "Coverage")!.stats!;
    assert.equal(cov.find((s) => s.label === "Threads tracked")?.value, "3");
    assert.ok(cov.find((s) => s.label === "Last synced")?.value !== "Never");
  });

  await t.test("unanswered threads link straight to Basecamp", () => {
    db.prepare(
      `UPDATE basecamp_client_messages SET app_url = ? WHERE id = 'p1:1'`
    ).run("https://3.basecamp.com/5338018/buckets/p1/messages/1");

    const r = reports.buildReport("client_messages", "2026-07-01", "2026-07-31");
    const list = r.sections.find((s) => s.title.startsWith("Every unanswered"))!;
    const i = list.rows!.findIndex((x) => x[0] === "Where is the draft?");
    assert.match(list.rowLinks![i]!, /^https:\/\/3\.basecamp\.com\//);

    // A thread Basecamp gave no app_url for still gets a working link, built
    // from the project and message ids rather than left dead.
    const j = list.rows!.findIndex((x) => x[0] === "Logo files");
    assert.match(list.rowLinks![j]!, /^https:\/\/3\.basecamp\.com\/\d+\/buckets\/p1\/messages\/2$/);

    // The CSV keeps the destination as its own column.
    const csv = reports.reportToCsv(r);
    assert.ok(csv.includes("Thread,Client,Last posted by,Waiting,Replies,Link"));
    assert.ok(csv.includes("https://3.basecamp.com/5338018/buckets/p1/messages/1"));
  });

  await t.test("delivery vs contract separates never-reported from unfinished", () => {
    // d1 has entries in range (see the weekly_snapshots fixture); d2 has none.
    const r = reports.buildReport("delivery_vs_contract", "2026-07-01", "2026-07-31");
    const cover = r.sections[0].stats!;
    assert.equal(cover.find((s) => s.label === "Active deliverables")?.value, "2");
    assert.equal(cover.find((s) => s.label === "Nothing reported")?.value, "1");

    const quiet = r.sections.find((s) => s.title.startsWith("Gone quiet"))!;
    assert.ok(
      quiet.rows!.some((row) => row[1] === "Site audit" && row[4] === "Never reported"),
      "a deliverable with no entry at all should read as never reported"
    );
  });

  await t.test("delivery vs contract surfaces deliverables with no cadence", () => {
    db.prepare(
      `INSERT INTO snapshot_deliverables (id, client_id, name, category, kind, cadence, cadence_unit, active, created_at, updated_at)
       VALUES (?, 'cl_1', ?, 'Social', 'recurring', '', 'monthly', 1, ?, ?)`
    ).run("d3", "Nobody wrote a cadence", now, now);

    const r = reports.buildReport("delivery_vs_contract", "2026-07-01", "2026-07-31");
    const gap = r.sections.find((s) => s.title.startsWith("Deliverables with no cadence"))!;
    assert.ok(gap.rows!.some((row) => row[1] === "Nobody wrote a cadence"));
  });

  await t.test("contract runway buckets by urgency and lists undated clients", () => {
    const day = 86_400_000;
    const ymd = (offset: number) => new Date(Date.now() + offset * day).toISOString().slice(0, 10);
    const c = db.prepare(
      `INSERT INTO rev_clients (id, name, active, contract_end, tier, account_manager, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?)`
    );
    c.run("cl_x", "Lapsed Co", ymd(-20), "gold", "cassidy", now, now);
    c.run("cl_y", "Renewing Soon", ymd(12), "silver", "carlos", now, now);
    c.run("cl_z", "Long Runway", ymd(200), "", "", now, now);

    const r = reports.buildReport("contract_runway", "2026-07-01", "2026-07-31");
    assert.equal(r.range, null, "runway is a state of play, not a period");

    const stats = r.sections[0].stats!;
    assert.equal(stats.find((s) => s.label === "Expired")?.value, "1");
    assert.equal(stats.find((s) => s.label === "Due within 90 days")?.value, "1");
    // cl_1 from the earlier fixture has no end date, so it must be counted apart
    // rather than treated as open-ended.
    assert.ok(Number(stats.find((s) => s.label === "No end date")?.value) >= 1);

    const buckets = r.sections.find((s) => s.title === "Runway")!;
    const bucket = (label: string) => buckets.rows!.find((x) => x[0] === label)![1];
    assert.equal(bucket("Already expired"), "1");
    assert.equal(bucket("Within 30 days"), "1");
    assert.equal(bucket("Over 90 days"), "1");

    // Expired first, and an expired contract reads as days ago rather than a
    // negative number.
    const soonest = r.sections.find((s) => s.title === "Expiring soonest")!;
    assert.equal(soonest.rows![0][0], "Lapsed Co");
    assert.match(soonest.rows![0][2], /ago$/);
    assert.equal(soonest.rows![0][4], "cassidy");

    const undated = r.sections.find((s) => s.title.startsWith("Clients with no contract"))!;
    assert.ok(undated.rows!.some((row) => row[0] === "Humble Somm"));
  });

  await t.test("account health counts warnings and shows what drove each one", () => {
    const r = reports.buildReport("account_health", "2026-07-01", "2026-07-31");
    assert.equal(r.range, null);

    const table = r.sections.find((s) => s.title.startsWith("Accounts with warnings"))!;
    const somm = table.rows!.find((x) => x[0] === "Humble Somm");
    assert.ok(somm, "Humble Somm has an open red flag and stale approvals");
    // The warning count must equal what the explanation actually lists.
    assert.equal(Number(somm![1]), somm![7].split(", ").length);
    assert.ok(somm![7].includes("open flag"), "the open flag should be named");

    // The rules are published on screen so the count can be checked.
    const rules = r.sections.find((s) => s.title === "What counts as a warning")!;
    assert.equal(rules.stats!.find((s) => s.label === "Approval waiting")?.value, "14d+");
  });

  await t.test("an unknown report type is rejected", () => {
    assert.equal(reports.isReportType("time_tracking"), true);
    assert.equal(reports.isReportType("nope"), false);
    assert.equal(reports.isReportType(""), false);
    assert.equal(reports.isReportType(null), false);
  });
});
