import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Same cwd trick as the other db-backed suites: db.ts resolves its file at
// import time, so point it at a throwaway directory first.

test("subject bank", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-subjects-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const bank = await import("../src/lib/subject-bank");
  const { getDb, nowIso } = await import("../src/lib/db");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const db = getDb();
  const now = nowIso();

  db.prepare(
    `INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`
  ).run("cl_1", "Guardian Plumbers", now, now);
  // 1600 of 4000 opened in July: a 40% month.
  db.prepare(
    `INSERT INTO rev_metrics (id, client_id, month, recipients, opens, created_at, updated_at)
     VALUES (?, 'cl_1', '2026-07', 4000, 1600, ?, ?)`
  ).run("rm_1", now, now);

  const send = db.prepare(
    `INSERT INTO scheduled_sends
       (id, client_id, client_name, title, send_date, status, subject, preview_text,
        purpose, offer, audience, created_at, updated_at)
     VALUES (?, 'cl_1', 'Guardian Plumbers', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  send.run("s1", "AC tune-up", "2026-07-10", "sent", "Beat the heat", "Book before the rush",
    "Rebook lapsed customers", "$89 tune-up", "Lapsed 12mo", now, now);
  // August has no rev_metrics row, so this one has no rate to show.
  send.run("s2", "Plan push", "2026-08-04", "planned", "Never worry again", "Priority service",
    "Sell the annual plan", "Annual $199", "Active customers", now, now);
  // Blank subjects are calendar rows that simply haven't been written yet.
  send.run("s3", "Untitled", "2026-07-20", "planned", "", "", "", "", "", now, now);

  await t.test("subjects come from the calendar with their strategy attached", () => {
    const b = bank.buildSubjectBank();
    assert.equal(b.totals.lines, 2, "the blank subject is not a subject line");
    assert.equal(b.totals.fromCalendar, 2);

    const ac = b.lines.find((l) => l.subject === "Beat the heat")!;
    assert.equal(ac.previewText, "Book before the rush");
    assert.equal(ac.offer, "$89 tune-up");
    assert.equal(ac.purpose, "Rebook lapsed customers");
    assert.equal(ac.status, "sent");
    assert.equal(ac.source, "calendar");
  });

  await t.test("the month's account open rate is attached where one exists", () => {
    const b = bank.buildSubjectBank();
    const july = b.lines.find((l) => l.subject === "Beat the heat")!;
    assert.equal(Math.round(july.monthOpenRate!), 40);

    // No metrics row for August, so no rate — not a zero, which would read as
    // a line that flopped.
    const august = b.lines.find((l) => l.subject === "Never worry again")!;
    assert.equal(august.monthOpenRate, null);
    assert.equal(b.totals.withOpenRate, 1);
  });

  await t.test("review-package subjects are included alongside calendar ones", () => {
    db.prepare(
      `INSERT INTO campaigns (id, title, client_name, client_id, html_content, status,
                              magic_token, external_token, created_at, updated_at)
       VALUES ('c1', 'July promo', 'Guardian Plumbers', 'cl_1', '', 'in_review', 'mt1', 'et1', ?, ?)`
    ).run("2026-07-05T00:00:00.000Z", now);
    db.prepare(
      `INSERT INTO campaign_emails (id, campaign_id, title, html_content, created_at, updated_at)
       VALUES ('e1', 'c1', 'Email 1', '', ?, ?)`
    ).run(now, now);
    const sub = db.prepare(
      `INSERT INTO email_subjects (id, email_id, campaign_id, subject, preview_text, sort_order, created_at)
       VALUES (?, 'e1', 'c1', ?, ?, ?, ?)`
    );
    // Two variants on one email: an A/B pair, which is exactly why several rows
    // per email have to survive into the bank.
    sub.run("sub1", "Variant A: fix it before it breaks", "Ten minute read", 0, "2026-07-05T00:00:00.000Z");
    sub.run("sub2", "Variant B: your AC is about to quit", "Ten minute read", 1, "2026-07-05T00:00:00.000Z");

    const b = bank.buildSubjectBank();
    assert.equal(b.totals.fromReview, 2, "both A/B variants belong in the bank");
    const a = b.lines.find((l) => l.subject.startsWith("Variant A"))!;
    assert.equal(a.source, "review");
    assert.equal(a.purpose, "July promo", "the package title stands in for a purpose");
    assert.equal(Math.round(a.monthOpenRate!), 40);
  });

  await t.test("newest first, and every client is listed for the filter", () => {
    const b = bank.buildSubjectBank();
    assert.equal(b.lines[0].date, "2026-08-04", "the August send is the most recent");
    assert.deepEqual(b.clients, ["Guardian Plumbers"]);
  });

  await t.test("an archived campaign's subjects drop out of the bank", () => {
    db.prepare(`UPDATE campaigns SET archived_at = ? WHERE id = 'c1'`).run(now);
    const b = bank.buildSubjectBank();
    assert.equal(b.totals.fromReview, 0);
    assert.equal(b.totals.lines, 2);
  });
});
