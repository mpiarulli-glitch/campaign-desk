import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("adding a client to the hub requires a launch date and platform", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-hub-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const hub = await import("../src/lib/lifecycle-hub");
  const { getDb, nowIso } = await import("../src/lib/db");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO rev_clients (id, name, active, monthly_email_quota, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?)`
    )
    .run("cl_hub", "Northline", 4, now, now);

  assert.deepEqual(hub.addClientToHub("cl_hub", "2026-08-26", "michael"), {
    ok: false,
    error: "Pick a platform.",
  });
  assert.deepEqual(hub.addClientToHub("cl_hub", "2026-08-26", "michael", undefined, null), {
    ok: false,
    error: "Pick a platform.",
  });

  const added = hub.addClientToHub("cl_hub", "2026-08-26", "michael", undefined, "klaviyo");
  assert.deepEqual(added, { ok: true });

  const snapshot = hub.buildLifecycleHub();
  const client = snapshot.clients.find((c) => c.id === "cl_hub");
  assert.ok(client);
  assert.equal(client.launchDate, "2026-08-26");
  assert.equal(client.platform, "klaviyo");
  assert.equal(client.launch.total, 3);
});

test("hub shows sent campaigns and calendar sends, and skips automation quota", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-hub-sent-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const hub = await import("../src/lib/lifecycle-hub");
  const board = await import("../src/lib/lifecycle-board");
  const campaigns = await import("../src/lib/campaigns");
  const { getDb, nowIso } = await import("../src/lib/db");
  const { currentPeriod } = await import("../src/lib/period");
  const { todayYmd } = await import("../src/lib/cadence");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const now = nowIso();
  const period = currentPeriod();
  const today = todayYmd();
  const sentDate = `${period}-04`;
  const db = getDb();
  db.prepare(
    `INSERT INTO rev_clients (id, name, active, monthly_email_quota, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?, ?)`
  ).run("cl_watch", "Our Watch", 4, now, now);
  db.prepare(
    `INSERT INTO rev_clients (id, name, active, monthly_email_quota, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?, ?)`
  ).run("cl_watch_tim", "Our Watch w/Tim Thompson", 4, now, now);
  db.prepare(
    `INSERT INTO rev_clients (id, name, active, monthly_email_quota, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?, ?)`
  ).run("cl_looda_a", "Looda House Pawn", 2, now, now);
  db.prepare(
    `INSERT INTO rev_clients (id, name, active, monthly_email_quota, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?, ?)`
  ).run("cl_looda_b", "Looda House Pawn", 2, now, now);

  assert.equal(hub.addClientToHub("cl_watch", today, "michael", period, "klaviyo").ok, true);
  assert.equal(board.addBoardCard("cl_watch_tim", period), true);
  assert.equal(board.addBoardCard("cl_looda_a", period), true);
  assert.equal(board.addBoardCard("cl_looda_b", period), true);

  const welcome = campaigns.createCampaign({
    title: "Our Watch Welcome Series V2",
    clientName: "Our Watch w/Tim Thompson",
    clientId: "cl_watch_tim",
    htmlContent: "<p>Hi</p>",
  });
  db.prepare(`UPDATE campaigns SET status = 'sent', created_at = ?, updated_at = ? WHERE id = ?`).run(
    `${sentDate}T12:00:00.000Z`,
    `${sentDate}T12:00:00.000Z`,
    welcome.id
  );

  const broadcasts = campaigns.createCampaign({
    title: "Our Watch | August 2026 Broadcasts",
    clientName: "Our Watch w/Tim Thompson",
    clientId: "cl_watch_tim",
    htmlContent: "<p>Hi</p>",
  });
  db.prepare(`UPDATE campaigns SET status = 'in_review', created_at = ?, updated_at = ? WHERE id = ?`).run(
    `${period}-13T12:00:00.000Z`,
    `${period}-13T12:00:00.000Z`,
    broadcasts.id
  );

  const flow = campaigns.createCampaign({
    title: "Looda House Pawn Browse Return Flow",
    clientName: "Looda House Pawn",
    clientId: "cl_looda_a",
    htmlContent: "<p>Hi</p>",
  });
  db.prepare(`UPDATE campaigns SET status = 'approved', created_at = ?, updated_at = ? WHERE id = ?`).run(
    `${period}-18T12:00:00.000Z`,
    `${period}-18T12:00:00.000Z`,
    flow.id
  );

  const past = campaigns.createCampaign({
    title: "Looda House Pawn August 2026 Past Customer Campaigns",
    clientName: "Looda House Pawn",
    clientId: "cl_looda_a",
    htmlContent: "<p>Hi</p>",
  });
  campaigns.addEmail({
    campaignId: past.id,
    title: "Email 2",
    htmlContent: "<p>Two</p>",
  });
  db.prepare(`UPDATE campaigns SET status = 'in_review', created_at = ?, updated_at = ? WHERE id = ?`).run(
    `${period}-12T12:00:00.000Z`,
    `${period}-12T12:00:00.000Z`,
    past.id
  );

  db.prepare(
    `INSERT INTO scheduled_sends
      (id, client_id, client_name, title, send_date, status, asset_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'sent', 'email_campaign', ?, ?)`
  ).run("send_looda", "cl_looda_a", "Looda House Pawn", "August promo", sentDate, now, now);

  const snapshot = hub.buildLifecycleHub();
  const watchRows = snapshot.clients.filter((c) => c.name.toLowerCase().includes("watch"));
  assert.equal(watchRows.length, 1);
  const watch = watchRows[0];
  assert.ok(watch.memberIds.includes("cl_watch"));
  assert.ok(watch.memberIds.includes("cl_watch_tim"));
  assert.ok(watch.activity.some((a) => a.title.includes("Welcome Series") && a.status === "sent"));
  assert.ok(watch.activity.some((a) => a.title.includes("Broadcasts")));
  assert.equal(watch.delivered, 1);
  assert.equal(
    watch.activity.find((a) => a.title.includes("Welcome Series"))?.kind,
    "automation"
  );

  const loodaRows = snapshot.clients.filter((c) => c.name === "Looda House Pawn");
  assert.equal(loodaRows.length, 1);
  const looda = loodaRows[0];
  assert.ok(looda.activity.some((a) => a.title === "August promo" && a.status === "sent"));
  assert.ok(looda.activity.some((a) => a.title.includes("Browse Return Flow")));
  assert.equal(looda.delivered, 2);
});

test("hub contract is met at client approval, not internal review", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-hub-met-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const hub = await import("../src/lib/lifecycle-hub");
  const campaigns = await import("../src/lib/campaigns");
  const { getDb, nowIso } = await import("../src/lib/db");
  const { currentPeriod } = await import("../src/lib/period");
  const { todayYmd } = await import("../src/lib/cadence");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const now = nowIso();
  const period = currentPeriod();
  const today = todayYmd();
  const stamp = `${period}-10T12:00:00.000Z`;
  const db = getDb();
  db.prepare(
    `INSERT INTO rev_clients (id, name, active, monthly_email_quota, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?, ?)`
  ).run("cl_pace", "Pace Co", 1, now, now);

  assert.equal(hub.addClientToHub("cl_pace", today, "michael", period, "ghl").ok, true);

  const camp = campaigns.createCampaign({
    title: "August promo",
    clientName: "Pace Co",
    clientId: "cl_pace",
    htmlContent: "<p>Hi</p>",
  });
  db.prepare(
    `UPDATE campaigns SET status = 'internal_review', created_at = ?, updated_at = ? WHERE id = ?`
  ).run(stamp, stamp, camp.id);

  let snapshot = hub.buildLifecycleHub();
  let client = snapshot.clients.find((c) => c.id === "cl_pace");
  assert.ok(client);
  assert.equal(client.delivered, 0);
  assert.notEqual(client.pace, "met");
  const internal = client.activity.find((a) => a.title === "August promo");
  assert.ok(internal);
  assert.equal(internal.delivered, false);
  assert.equal(internal.status, "internal_review");

  db.prepare(
    `UPDATE campaigns SET status = 'in_review', created_at = ?, updated_at = ? WHERE id = ?`
  ).run(stamp, stamp, camp.id);

  snapshot = hub.buildLifecycleHub();
  client = snapshot.clients.find((c) => c.id === "cl_pace");
  assert.ok(client);
  assert.equal(client.delivered, 1);
  assert.equal(client.pace, "met");
  assert.equal(client.paceLabel, "Contract met");
  const withClient = client.activity.find((a) => a.title === "August promo");
  assert.ok(withClient);
  assert.equal(withClient.delivered, true);
});

test("hub can adjust quota and log an off-app campaign", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-hub-log-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const hub = await import("../src/lib/lifecycle-hub");
  const { getDb, nowIso } = await import("../src/lib/db");
  const { currentPeriod } = await import("../src/lib/period");
  const { todayYmd } = await import("../src/lib/cadence");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const now = nowIso();
  const period = currentPeriod();
  const today = todayYmd();
  getDb()
    .prepare(
      `INSERT INTO rev_clients (id, name, active, monthly_email_quota, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?)`
    )
    .run("cl_manual", "Kentina Hospitality", 0, now, now);

  assert.equal(hub.addClientToHub("cl_manual", today, "michael", period, "klaviyo").ok, true);
  assert.equal(hub.setHubClientQuota("cl_manual", 4), true);

  let snapshot = hub.buildLifecycleHub();
  let client = snapshot.clients.find((c) => c.id === "cl_manual");
  assert.ok(client);
  assert.equal(client.quota, 4);
  assert.equal(client.delivered, 0);

  assert.deepEqual(hub.logHubCampaign("cl_manual", { title: "   " }), {
    ok: false,
    error: "Add a title.",
  });

  const logged = hub.logHubCampaign("cl_manual", {
    title: "August newsletter",
    sentOn: `${period}-12`,
    status: "sent",
  });
  assert.deepEqual(logged, { ok: true });

  snapshot = hub.buildLifecycleHub();
  client = snapshot.clients.find((c) => c.id === "cl_manual");
  assert.ok(client);
  assert.equal(client.quota, 4);
  assert.equal(client.delivered, 1);
  assert.equal(client.remaining, 3);
  const row = client.activity.find((a) => a.title === "August newsletter");
  assert.ok(row);
  assert.equal(row.delivered, true);
  assert.equal(row.status, "sent");
});

