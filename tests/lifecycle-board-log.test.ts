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
