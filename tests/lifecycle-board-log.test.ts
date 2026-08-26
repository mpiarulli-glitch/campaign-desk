import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("logging an off-app campaign counts on that month's board card", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-board-log-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const board = await import("../src/lib/lifecycle-board");
  const { getDb, nowIso } = await import("../src/lib/db");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const now = nowIso();
  const db = getDb();
  db.prepare(
    `INSERT INTO rev_clients (id, name, active, monthly_email_quota, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?, ?)`
  ).run("cl_log", "CIPO Cloud Software", 8, now, now);

  const period = board.currentPeriod();
  assert.equal(board.addBoardCard("cl_log", period), true);
  const card = board.listBoardCards(period).find((c) => c.clientId === "cl_log");
  assert.ok(card);
  assert.equal(card.delivered, 0);
  assert.equal(card.campaigns.length, 0);

  await t.test("empty title is rejected", () => {
    assert.equal(board.logOffAppCampaign(card.id, { title: "   " }), null);
  });

  await t.test("a sent log ticks the email quota and marks off-app", () => {
    const next = board.logOffAppCampaign(card.id, {
      title: "July newsletter",
      sentOn: `${period}-12`,
      status: "sent",
    });
    assert.ok(next);
    assert.equal(next.delivered, 1);
    assert.equal(next.quota, 8);
    assert.equal(next.campaigns.length, 1);
    assert.equal(next.campaigns[0].title, "July newsletter");
    assert.equal(next.campaigns[0].status, "sent");
    assert.equal(next.campaigns[0].emailCount, 1);
    assert.equal(next.campaigns[0].loggedOffApp, true);

    const row = db
      .prepare(`SELECT status, logged_off_app, created_at FROM campaigns WHERE id = ?`)
      .get(next.campaigns[0].id) as {
      status: string;
      logged_off_app: number;
      created_at: string;
    };
    assert.equal(row.status, "sent");
    assert.equal(row.logged_off_app, 1);
    assert.equal(row.created_at.slice(0, 7), period);
    assert.equal(row.created_at.slice(8, 10), "12");
  });

  await t.test("an approved log also counts, and a date outside the month stays on this board", () => {
    const next = board.logOffAppCampaign(card.id, {
      title: "Partner blast",
      sentOn: "2019-01-31",
      status: "approved",
    });
    assert.ok(next);
    assert.equal(next.delivered, 2);
    const logged = next.campaigns.find((c) => c.title === "Partner blast");
    assert.ok(logged);
    assert.equal(logged.status, "approved");
    assert.equal(logged.loggedOffApp, true);

    const row = db
      .prepare(`SELECT created_at, approved_channel FROM campaigns WHERE id = ?`)
      .get(logged.id) as { created_at: string; approved_channel: string | null };
    assert.equal(row.created_at.slice(0, 7), period);
    assert.equal(row.approved_channel, "client");
  });
});

test("automation emails do not tick the monthly quota", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-board-auto-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const board = await import("../src/lib/lifecycle-board");
  const campaigns = await import("../src/lib/campaigns");
  const { getDb, nowIso } = await import("../src/lib/db");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const now = nowIso();
  const db = getDb();
  db.prepare(
    `INSERT INTO rev_clients (id, name, active, monthly_email_quota, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?, ?)`
  ).run("cl_auto", "Our Watch", 4, now, now);

  const period = board.currentPeriod();
  assert.equal(board.addBoardCard("cl_auto", period), true);

  const auto = campaigns.createCampaign({
    title: "Welcome Series V2",
    clientName: "Our Watch",
    clientId: "cl_auto",
    htmlContent: "<p>Hi</p>",
    presentation: "automation",
  });
  db.prepare(`UPDATE campaigns SET status = 'sent' WHERE id = ?`).run(auto.id);

  const blast = campaigns.createCampaign({
    title: "August broadcasts",
    clientName: "Our Watch",
    clientId: "cl_auto",
    htmlContent: "<p>Hi</p>",
  });
  db.prepare(`UPDATE campaigns SET status = 'sent' WHERE id = ?`).run(blast.id);

  const card = board.listBoardCards(period).find((c) => c.clientId === "cl_auto");
  assert.ok(card);
  assert.equal(card.delivered, 1);
  const welcome = card.campaigns.find((c) => c.title === "Welcome Series V2");
  assert.ok(welcome);
  assert.equal(welcome.isAutomation, true);
  assert.equal(welcome.countsTowardQuota, false);
});

test("board quota ticks when sent to the client, not at internal review or list send", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-board-met-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const board = await import("../src/lib/lifecycle-board");
  const campaigns = await import("../src/lib/campaigns");
  const { getDb, nowIso } = await import("../src/lib/db");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const now = nowIso();
  const db = getDb();
  db.prepare(
    `INSERT INTO rev_clients (id, name, active, monthly_email_quota, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?, ?)`
  ).run("cl_met", "Northline", 2, now, now);

  const period = board.currentPeriod();
  const stamp = `${period}-10T12:00:00.000Z`;
  assert.equal(board.addBoardCard("cl_met", period), true);

  const camp = campaigns.createCampaign({
    title: "September broadcasts",
    clientName: "Northline",
    clientId: "cl_met",
    htmlContent: "<p>Hi</p>",
  });

  const setStatus = (status: string, channel: string | null = null) => {
    db.prepare(
      `UPDATE campaigns SET status = ?, approved_channel = ?, created_at = ?, updated_at = ? WHERE id = ?`
    ).run(status, channel, stamp, stamp, camp.id);
  };

  setStatus("draft");
  let card = board.listBoardCards(period).find((c) => c.clientId === "cl_met");
  assert.ok(card);
  assert.equal(card.delivered, 0);
  assert.equal(card.campaigns.length, 0);
  assert.equal(card.suggestedColumnKey, "triage");

  setStatus("internal_review");
  card = board.listBoardCards(period).find((c) => c.clientId === "cl_met");
  assert.ok(card);
  assert.equal(card.delivered, 0);
  assert.equal(card.campaigns.length, 0);

  setStatus("approved", "internal");
  card = board.listBoardCards(period).find((c) => c.clientId === "cl_met");
  assert.ok(card);
  assert.equal(card.delivered, 0);
  assert.equal(card.campaigns.length, 0);

  setStatus("in_review");
  card = board.listBoardCards(period).find((c) => c.clientId === "cl_met");
  assert.ok(card);
  assert.equal(card.delivered, 1);
  assert.equal(card.campaigns[0].delivered, true);
  assert.equal(card.suggestedColumnKey, "sent_for_approval");

  campaigns.addEmail({
    campaignId: camp.id,
    title: "Email 2",
    htmlContent: "<p>Two</p>",
  });
  card = board.listBoardCards(period).find((c) => c.clientId === "cl_met");
  assert.ok(card);
  assert.equal(card.delivered, 2);
  assert.equal(card.suggestedColumnKey, "deliverables_met");

  setStatus("needs_changes");
  card = board.listBoardCards(period).find((c) => c.clientId === "cl_met");
  assert.ok(card);
  assert.equal(card.delivered, 2);
  assert.equal(card.suggestedColumnKey, "deliverables_met");

  setStatus("scheduled");
  card = board.listBoardCards(period).find((c) => c.clientId === "cl_met");
  assert.ok(card);
  assert.equal(card.delivered, 2);
  assert.equal(card.suggestedColumnKey, "deliverables_met");

  setStatus("sent");
  card = board.listBoardCards(period).find((c) => c.clientId === "cl_met");
  assert.ok(card);
  assert.equal(card.delivered, 2);
  assert.equal(card.suggestedColumnKey, "deliverables_met");
});

