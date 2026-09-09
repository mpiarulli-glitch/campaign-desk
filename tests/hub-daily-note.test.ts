import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { looksLikeAdsLaunch, stripHtml } from "../src/lib/ads-launch";
import { shapeReadings } from "../src/lib/basecamp";

test("ads launch copy is distinct from email launches", () => {
  assert.equal(looksLikeAdsLaunch("Ads launched for Humble Somm"), true);
  assert.equal(looksLikeAdsLaunch("The ads are live"), true);
  assert.equal(looksLikeAdsLaunch("We launched the Meta ads this morning"), true);
  assert.equal(looksLikeAdsLaunch("Google ads went live"), true);
  assert.equal(looksLikeAdsLaunch("Welcome sequence launched"), false);
  assert.equal(looksLikeAdsLaunch("Email launch is scheduled"), false);
  assert.equal(looksLikeAdsLaunch(""), false);
});

test("stripHtml keeps the words we match on", () => {
  assert.equal(stripHtml("<p>Ads launched</p><br>today"), "Ads launched today");
});

test("shapeReadings keeps unreads ahead of duplicate reads", () => {
  const rows = shapeReadings({
    unreads: [
      {
        id: 1,
        section: "pings",
        title: "Hey",
        content_excerpt: "Can you look?",
        bucket_name: "MEG",
        app_url: "https://3.basecamp.com/x",
        updated_at: "2026-09-09T16:00:00.000Z",
        unread_count: 1,
        unread_at: "2026-09-09T16:00:00.000Z",
        creator: { name: "Jane" },
      },
    ],
    reads: [
      {
        id: 1,
        section: "pings",
        title: "Hey",
        unread_count: 0,
        unread_at: null,
      },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].unread, true);
  assert.equal(rows[0].actor, "Jane");
});

test("daily note groups client posts, ads launches, and approvals for the Pacific day", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-daily-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const { closeDbForTests, getDb, nowIso } = await import("../src/lib/db");
  const hub = await import("../src/lib/hub-daily-note");

  t.after(() => {
    closeDbForTests();
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const db = getDb();
  const now = new Date("2026-09-09T16:20:00.000Z"); // 9:20am PDT
  const today = "2026-09-09T15:00:00.000Z"; // 8:00am PDT, earlier this morning
  const yesterday = "2026-09-08T20:00:00.000Z";
  const ts = nowIso();

  const msg = db.prepare(
    `INSERT INTO basecamp_client_messages
       (id, project_id, client_id, client_name, title, app_url, author_name,
        created_at, last_client_at, last_team_at, reply_count, awaiting_reply,
        preview, synced_at)
     VALUES (?, 'p1', 'cl_1', ?, ?, '', ?, ?, ?, ?, 0, ?, ?, ?)`
  );
  msg.run(
    "p1:1",
    "Humble Somm",
    "Can we pause next week?",
    "Katie",
    today,
    today,
    "",
    1,
    "We need to pause ads spend.",
    ts
  );
  msg.run(
    "p1:2",
    "Humble Somm",
    "Ads launched this morning",
    "Alex",
    today,
    "",
    today,
    0,
    "Meta ads are live on the prospecting set.",
    ts
  );
  msg.run(
    "p1:3",
    "Krak Boba",
    "Wrote last night",
    "Sam",
    yesterday,
    yesterday,
    "",
    1,
    "",
    ts
  );
  msg.run(
    "p1:5",
    "Krak Boba",
    "Unanswered from last month",
    "Sam",
    "2026-08-01T18:00:00.000Z",
    "2026-08-01T18:00:00.000Z",
    "",
    1,
    "",
    ts
  );
  msg.run(
    "p1:4",
    "Cisco",
    "Welcome sequence launched",
    "Alex",
    today,
    "",
    today,
    0,
    "The welcome emails went out.",
    ts
  );

  db.prepare(
    `INSERT INTO campaigns
       (id, title, client_name, status, magic_token, external_token,
        created_at, updated_at, approved_at, approved_by, approved_channel,
        basecamp_card_url)
     VALUES (?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, 'client', ?)`
  ).run(
    "camp-1",
    "September newsletter",
    "Cisco Restaurant",
    "mt-1",
    "et-1",
    ts,
    ts,
    today,
    "Katie Jones",
    "https://3.basecamp.com/card"
  );

  db.prepare(
    `INSERT INTO campaigns
       (id, title, client_name, status, magic_token, external_token,
        created_at, updated_at, approved_at, approved_by, approved_channel)
     VALUES (?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, 'client')`
  ).run(
    "camp-old",
    "August newsletter",
    "Cisco Restaurant",
    "mt-2",
    "et-2",
    "2026-08-01T18:00:00.000Z",
    "2026-08-01T18:00:00.000Z",
    "2026-08-01T18:00:00.000Z",
    "Katie Jones"
  );

  db.prepare(
    `INSERT INTO comments
       (id, campaign_id, author_name, body, created_at)
     VALUES ('c1', 'camp-1', 'Katie Jones', 'Love the hero.', ?)`
  ).run(today);

  const note = hub.buildDailyNote(now);
  assert.equal(note.dayKey, "2026-09-09");
  assert.deepEqual(
    note.clientMessages.map((m) => m.title),
    ["Can we pause next week?", "Wrote last night"]
  );
  assert.equal(note.clientMessages[0].awaitingReply, true);
  assert.deepEqual(
    note.adsLaunched.map((m) => m.title),
    ["Ads launched this morning"]
  );
  assert.equal(note.approvals.length, 1);
  assert.match(note.approvals[0].summary, /approved September newsletter/);
  assert.equal(note.reviewComments.length, 1);
  assert.deepEqual(
    note.waiting.map((m) => m.title),
    ["Can we pause next week?", "Wrote last night"]
  );
  assert.ok(!note.waiting.some((m) => m.title.includes("last month")));

  const pings = hub.pingsForDay(
    [
      {
        id: 9,
        section: "pings",
        title: "Quick question",
        excerpt: "Are we live?",
        projectName: "MEG HQ",
        actor: "Jane",
        url: "https://3.basecamp.com/ping",
        at: today,
        unread: true,
      },
      {
        id: 10,
        section: "inbox",
        title: "Old unread ping",
        excerpt: "",
        projectName: "MEG HQ",
        actor: "Jane",
        url: "",
        at: "2026-08-01T18:00:00.000Z",
        unread: true,
      },
    ],
    now
  );
  assert.equal(pings.length, 1);
  assert.equal(pings[0].title, "Quick question");
});
