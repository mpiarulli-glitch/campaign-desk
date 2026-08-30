import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("email analytics rankings", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-email-analytics-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const { getDb, nowIso } = await import("../src/lib/db");
  const stats = await import("../src/lib/ghl-email-stats");
  const db = getDb();
  const ts = nowIso();

  db.prepare(
    `INSERT INTO rev_clients
       (id, name, business_model, ghl_location_id, klaviyo_account, retainer, monthly_cost, active, created_at, updated_at)
     VALUES ('cl1', 'Alpha Co', 'home_service', 'loc1', '', 0, 0, 1, ?, ?)`
  ).run(ts, ts);

  db.prepare(
    `INSERT INTO ghl_email_sends (
       id, client_id, client_name, location_id, source, source_id,
       campaign_name, subject, preview_text, status, sent_at,
       sent, delivered, opened, clicked, unsubscribed, complained, bounced, replied,
       open_rate, click_rate, synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "s1",
    "cl1",
    "Alpha Co",
    "loc1",
    "email-campaigns",
    "c1",
    "June sale",
    "Your summer deal is here",
    "",
    "sent",
    "2026-06-15T12:00:00.000Z",
    1000,
    1000,
    300,
    60,
    0,
    0,
    0,
    5,
    30,
    6,
    ts
  );

  db.prepare(
    `INSERT INTO ghl_email_sends (
       id, client_id, client_name, location_id, source, source_id,
       campaign_name, subject, preview_text, status, sent_at,
       sent, delivered, opened, clicked, unsubscribed, complained, bounced, replied,
       open_rate, click_rate, synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "s2",
    "cl1",
    "Alpha Co",
    "loc1",
    "email-campaigns",
    "c2",
    "July reminder",
    "Last chance: summer deal",
    "",
    "sent",
    "2026-07-01T12:00:00.000Z",
    1000,
    1000,
    180,
    20,
    0,
    0,
    0,
    1,
    18,
    2,
    ts
  );

  // Tiny sample should not rank — protects against noisy winners.
  db.prepare(
    `INSERT INTO ghl_email_sends (
       id, client_id, client_name, location_id, source, source_id,
       campaign_name, subject, preview_text, status, sent_at,
       sent, delivered, opened, clicked, unsubscribed, complained, bounced, replied,
       open_rate, click_rate, synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "s3",
    "cl1",
    "Alpha Co",
    "loc1",
    "email-campaigns",
    "c3",
    "Test",
    "100% open on tiny list",
    "",
    "sent",
    "2026-07-10T12:00:00.000Z",
    10,
    10,
    10,
    5,
    0,
    0,
    0,
    0,
    100,
    50,
    ts
  );

  const dashboard = stats.buildEmailAnalyticsDashboard(180);
  assert.equal(dashboard.totals.sends, 3);
  assert.equal(dashboard.topSubjects.length, 2);
  assert.equal(dashboard.topSubjects[0]?.subject, "Your summer deal is here");
  assert.equal(dashboard.topSubjects.some((r) => r.subject.includes("100%")), false);
  assert.equal(dashboard.clients[0]?.clientName, "Alpha Co");
  assert.equal(dashboard.trends.length, 2);
  assert.equal(dashboard.periodDays, 180);

  // Old June send drops out of a 30-day window when "now" is late July.
  const july = stats.buildEmailAnalyticsDashboard(30);
  assert.equal(july.periodDays, 30);
  assert.ok(july.totals.sends <= 2);
});

test("period helpers", async () => {
  const stats = await import("../src/lib/ghl-email-stats");
  assert.equal(stats.parseEmailAnalyticsPeriod("60"), 60);
  assert.equal(stats.parseEmailAnalyticsPeriod("nope"), 90);
  assert.equal(stats.minDeliveredForPeriod(30), 25);
  assert.equal(stats.minDeliveredForPeriod(180), 50);
  assert.equal(
    stats.inPeriod("2026-07-01T12:00:00.000Z", 30, new Date("2026-07-15T12:00:00.000Z")),
    true
  );
  assert.equal(
    stats.inPeriod("2026-05-01T12:00:00.000Z", 30, new Date("2026-07-15T12:00:00.000Z")),
    false
  );
});

test("subjectKey normalises whitespace", async () => {
  const { subjectKey } = await import("../src/lib/ghl-email-stats");
  assert.equal(subjectKey("  Hello   World  "), "hello world");
});
