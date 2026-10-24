import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// db.ts picks its file from cwd at the first getDb(), so this chdirs first and
// imports after. One top-level test: tsx compiles this file as CJS.

const ROOT = process.cwd();

test("bot activity", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-bot-activity-"));
  const originalCwd = process.cwd();
  const previousPrimary = process.env.CAMPAIGN_DESK_API_TOKEN;
  const previousDedicated = process.env.BOT_ACTIVITY_TOKEN;
  process.chdir(tmp);
  process.env.CAMPAIGN_DESK_API_TOKEN = "primary-token-value";
  delete process.env.BOT_ACTIVITY_TOKEN;

  const ba = await import("../src/lib/bot-activity");
  const schema = await import("../src/lib/bot-activity-schema");
  const access = await import("../src/lib/access");
  const gate = await import("../src/lib/page-gate");
  const { getDb, closeDbForTests } = await import("../src/lib/db");
  const { CAMPAIGN_ACCOUNT_MANAGER_SLUGS } = await import("../src/lib/campaign-review-queue");

  t.after(() => {
    closeDbForTests();
    process.chdir(originalCwd);
    if (previousPrimary === undefined) delete process.env.CAMPAIGN_DESK_API_TOKEN;
    else process.env.CAMPAIGN_DESK_API_TOKEN = previousPrimary;
    if (previousDedicated === undefined) delete process.env.BOT_ACTIVITY_TOKEN;
    else process.env.BOT_ACTIVITY_TOKEN = previousDedicated;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const michael = { role: "admin" as const, person: null, impersonating: false };
  const owner = access.subjectFor("michael");
  const carlos = access.subjectFor("carlos");
  const jack = access.subjectFor("jack");
  const cassidy = access.subjectFor("cassidy");
  const kyle = access.subjectFor("kyle_morris");
  const luis = access.subjectFor("luis_romero");

  function actor(who: {
    role: "admin" | "forecast";
    person: string | null;
    impersonating?: boolean;
  }) {
    return { role: who.role, person: who.person, impersonating: Boolean(who.impersonating) };
  }

  function request(
    method: string,
    url: string,
    token: string | null,
    body?: unknown,
    ip = "203.0.113.10"
  ) {
    return new Request(url, {
      method,
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  await t.test("the page is in the owner menu and nowhere else", () => {
    assert.equal(gate.ownerPageAllowed(owner), true);
    assert.equal(gate.ownerPageAllowed(null), false);
    assert.equal(ba.actorMaySeeBotActivity(michael), true);
    assert.equal(ba.actorMaySeeBotActivity(null), false);

    const refused = [carlos, jack, cassidy, kyle, luis, access.subjectFor("abel")];
    for (const who of refused) {
      assert.equal(gate.ownerPageAllowed(who), false, who.person || "unknown");
      assert.equal(access.allows(who, "page.bot_activity"), false, who.person || "unknown");
      assert.equal(ba.actorMaySeeBotActivity(actor(who)), false, who.person || "unknown");
      assert.ok(
        !access.visiblePages(who).some((page) => page.href === "/admin/bot-activity"),
        who.person || "unknown"
      );
    }

    assert.equal(access.allows(owner, "page.bot_activity"), true);
    assert.ok(access.visiblePages(owner).some((page) => page.href === "/admin/bot-activity"));
    assert.equal(access.isGrantable("page.bot_activity"), false);
    assert.equal(access.capability("page.bot_activity")?.fixed, true);

    const viewingAs = {
      role: "admin" as const,
      person: "carlos",
      owner: false,
      impersonating: true,
    };
    assert.equal(gate.ownerPageAllowed(viewingAs), false);
    assert.equal(ba.actorMaySeeBotActivity(actor(viewingAs)), false);
    assert.equal(gate.ownerPageAllowed({ owner: true, impersonating: true }), false);

    assert.deepEqual(CAMPAIGN_ACCOUNT_MANAGER_SLUGS, ["cassidy", "kyle_morris", "luis_romero"]);
    assert.throws(() => access.setOverride("carlos", "page.bot_activity", true, "michael"));
    assert.throws(() => access.setOverride("cassidy", "page.bot_activity", true, "michael"));
    assert.throws(() => access.setOverride("jack", "page.bot_activity", true, "michael"));

    getDb()
      .prepare(
        `INSERT INTO user_access (person, capability, allowed, updated_at, updated_by)
         VALUES ('carlos', 'page.bot_activity', 1, '2026-10-24T00:00:00.000Z', 'michael')`
      )
      .run();
    assert.equal(access.allows(carlos, "page.bot_activity"), false);

    const layout = fs.readFileSync(
      path.join(ROOT, "src/app/admin/bot-activity/layout.tsx"),
      "utf8"
    );
    assert.match(layout, /requireOwnerPage/);
    const page = fs.readFileSync(
      path.join(ROOT, "src/app/admin/bot-activity/page.tsx"),
      "utf8"
    );
    assert.doesNotMatch(page, /dangerouslySetInnerHTML/);
    const shell = fs.readFileSync(path.join(ROOT, "src/components/AppShell.tsx"), "utf8");
    assert.match(shell, /\bbot:/);

    const botRoute = fs.readFileSync(
      path.join(ROOT, "src/app/api/bot-activity/route.ts"),
      "utf8"
    );
    assert.match(botRoute, /botActivityApiGet/);
    assert.match(botRoute, /botActivityApiPost/);
    assert.doesNotMatch(botRoute, /getSession/);
    const adminRoute = fs.readFileSync(
      path.join(ROOT, "src/app/api/admin/bot-activity/route.ts"),
      "utf8"
    );
    assert.match(adminRoute, /getSession/);
    assert.match(adminRoute, /botActivityAdminGet/);
    assert.match(adminRoute, /botActivityAdminPost/);
    assert.doesNotMatch(adminRoute, /CAMPAIGN_DESK_API_TOKEN/);
    assert.doesNotMatch(adminRoute, /botActivityTokenAuthorized/);

    const lib = fs.readFileSync(path.join(ROOT, "src/lib/bot-activity.ts"), "utf8");
    assert.match(lib, /timingSafeEqual/);
    assert.doesNotMatch(lib, /console\.(log|info|debug|warn|error)/);
  });

  await t.test("seed matches the mockup once and does not overwrite", () => {
    const board = ba.botActivityBoard();
    assert.equal(board.updated, "Sat Oct 24, 11:32 AM PT");
    assert.equal(board.waiting.length, schema.WAITING_SEED.length);
    assert.equal(board.work.length, schema.WORK_SEED.length);
    assert.equal(
      board.timeline.reduce((n, day) => n + day.entries.length, 0),
      schema.TIMELINE_SEED.length
    );
    assert.equal(board.bots.length, schema.BOT_SEED.length);

    const byName = new Map(board.bots.map((bot) => [bot.name, bot]));
    for (const bot of schema.BOT_SEED) {
      assert.equal(byName.get(bot.name)?.icon, bot.icon, bot.name);
      assert.equal(byName.get(bot.name)?.agentId, bot.agentId, bot.name);
    }
    for (const name of ["Emily", "Wes"]) {
      assert.equal(byName.get(name)?.agentId, "");
    }
    assert.equal(byName.get("Rachel")?.agentId, "cec22a29-7e04-46be-9061-3efab0248b01");
    assert.equal(byName.get("James")?.agentId, "9ddf64b1-0e55-4159-8fd6-ed51c53ce1af");
    assert.equal(byName.get("David")?.agentId, "ab3a26ac-65b3-498f-b501-7b4f052aa909");
    assert.equal(byName.get("Lincoln")?.agentId, "7b766fe0-5455-458b-baf7-c02ef776035a");

    assert.equal(board.waiting[0].title, schema.WAITING_SEED[0].title);
    assert.equal(board.waiting[0].when, "Fri 5:09 PM");
    assert.match(board.waiting[0].at, /^2026-/);
    assert.match(board.timeline[0].entries[0].at, /^2026-/);
    assert.match(board.work[0].at, /^2026-/);
    assert.match(board.work[0].updatedAt, /^2026-/);
    assert.match(board.timeline[0].entries[0].postedAt, /^2026-/);
    assert.equal(board.waiting[0].chatHref, "grokbot://app/v1/agent?id=74308129-2f1d-43a1-973e-029bc428d239");
    assert.equal(board.timeline[0].day, "Sat Oct 24");
    assert.equal(board.timeline[0].entries[0].when, "11:32 AM");
    assert.equal(board.timeline[0].entries[0].text, schema.TIMELINE_SEED[0].text);
    assert.ok(board.work.some((item) => item.state === "blocked"));
    assert.ok(board.work.some((item) => item.state === "done"));
    assert.ok(board.work.some((item) => item.state === "progress"));

    const years = getDb()
      .prepare(
        `SELECT occurred_at AS at FROM bot_activity_items
         UNION ALL
         SELECT occurred_at AS at FROM bot_activity_timeline`
      )
      .all() as Array<{ at: string }>;
    for (const row of years) assert.equal(row.at.slice(0, 4), "2026");

    const flag = getDb()
      .prepare(`SELECT value FROM app_settings WHERE key = ?`)
      .get(schema.BOT_ACTIVITY_SEED_KEY) as { value: string };
    assert.ok(flag.value);

    getDb()
      .prepare(`UPDATE bot_activity_items SET title = 'CHANGED' WHERE id = 'seed-w-1'`)
      .run();
    closeDbForTests();
    const again = getDb()
      .prepare(`SELECT title FROM bot_activity_items WHERE id = 'seed-w-1'`)
      .get() as { title: string };
    assert.equal(again.title, "CHANGED");
    const timelineCount = getDb()
      .prepare(`SELECT COUNT(*) AS n FROM bot_activity_timeline`)
      .get() as { n: number };
    assert.equal(timelineCount.n, schema.TIMELINE_SEED.length);
    getDb()
      .prepare(`UPDATE bot_activity_items SET title = ? WHERE id = 'seed-w-1'`)
      .run(schema.WAITING_SEED[0].title);
  });

  await t.test("the bot token accepts the desk token and an optional dedicated token", async () => {
    ba.resetBotActivityRateLimitForTests();
    const url = "https://hub.marketingempiregroup.com/api/bot-activity";
    const noToken = await ba.botActivityApiGet(request("GET", url, null));
    const wrong = await ba.botActivityApiGet(request("GET", url, "nope"));
    const shortWrong = await ba.botActivityApiPost(request("POST", url, "x", { type: "timeline", bot: "Jerry", text: "no" }));
    const queryToken = await ba.botActivityApiGet(
      request("GET", `${url}?secret=primary-token-value&token=primary-token-value`, null)
    );
    assert.equal(noToken.status, 401);
    assert.equal(wrong.status, 401);
    assert.equal(shortWrong.status, 401);
    assert.equal(queryToken.status, 401);

    const post = await ba.botActivityApiPost(
      request("POST", url, "primary-token-value", {
        type: "timeline",
        bot: "Jerry",
        text: "Token check.",
      })
    );
    assert.equal(post.status, 200);
    const got = await ba.botActivityApiGet(request("GET", url, "primary-token-value"));
    assert.equal(got.status, 200);

    process.env.BOT_ACTIVITY_TOKEN = "dedicated-token-value";
    const dedicated = await ba.botActivityApiPost(
      request("POST", url, "dedicated-token-value", {
        type: "timeline",
        bot: "Jerry",
        text: "Dedicated token.",
      }, "203.0.113.11")
    );
    assert.equal(dedicated.status, 200);
    const primaryStill = await ba.botActivityApiGet(
      request("GET", url, "primary-token-value", undefined, "203.0.113.12")
    );
    assert.equal(primaryStill.status, 200);
    delete process.env.BOT_ACTIVITY_TOKEN;
    const dedicatedGone = await ba.botActivityApiGet(
      request("GET", url, "dedicated-token-value", undefined, "203.0.113.13")
    );
    assert.equal(dedicatedGone.status, 401);

    delete process.env.CAMPAIGN_DESK_API_TOKEN;
    const unset = await ba.botActivityApiGet(
      request("GET", url, "primary-token-value", undefined, "203.0.113.14")
    );
    assert.equal(unset.status, 401);
    process.env.CAMPAIGN_DESK_API_TOKEN = "primary-token-value";

    const route = await import("../src/app/api/bot-activity/route");
    const http = await route.GET(request("GET", url, null, undefined, "203.0.113.15"));
    assert.equal(http.status, 401);
    const httpOk = await route.POST(
      request(
        "POST",
        url,
        "primary-token-value",
        { type: "timeline", bot: "Jerry", text: "Via the route." },
        "203.0.113.16"
      )
    );
    assert.equal(httpOk.status, 200);
    assert.match(httpOk.headers.get("content-type") || "", /application\/json/);
  });

  await t.test("bots can upsert waiting and work, append timeline, and read replies", async () => {
    ba.resetBotActivityRateLimitForTests();
    const url = "https://hub.marketingempiregroup.com/api/bot-activity";
    const token = "primary-token-value";
    const script = "<script>alert(1)</script>";
    const created = await ba.botActivityApiPost(
      request("POST", url, token, {
        type: "waiting",
        bot: "Newbie",
        key: "html-item",
        title: script,
        detail: "<img src=x onerror=alert(1)>",
        at: "2026-10-24T18:00:00.000Z",
      }, "203.0.113.20")
    );
    assert.equal(created.status, 200);

    const updated = await ba.botActivityApiPost(
      request("POST", url, token, {
        type: "waiting",
        bot: "newbie",
        key: "html-item",
        title: "Renamed",
        detail: script,
      }, "203.0.113.20")
    );
    assert.equal(updated.status, 200);
    const body = updated.body as { results: Array<{ status: string; bot: string }> };
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].status, "open");
    assert.equal(body.results[0].bot, "Newbie");

    const newbie = getDb()
      .prepare(`SELECT icon, agent_id FROM bot_activity_bots WHERE name = 'Newbie'`)
      .get() as { icon: string; agent_id: string };
    assert.equal(newbie.icon, "clipboard");
    assert.equal(newbie.agent_id, "");
    const dupes = getDb()
      .prepare(`SELECT COUNT(*) AS n FROM bot_activity_items WHERE item_key = 'html-item'`)
      .get() as { n: number };
    assert.equal(dupes.n, 1);

    const resolved = await ba.botActivityApiPost(
      request("POST", url, token, {
        events: [
          { type: "waiting", bot: "Newbie", key: "html-item", resolved: true },
          {
            type: "work",
            bot: "Newbie",
            key: "html-work",
            title: "A task",
            detail: script,
            state: "progress",
          },
          { type: "timeline", bot: "Newbie", text: script, at: "2026-10-24T19:00:00.000Z" },
        ],
      }, "203.0.113.20")
    );
    assert.equal(resolved.status, 200);

    const blocked = await ba.botActivityApiPost(
      request("POST", url, token, {
        type: "work",
        bot: "Newbie",
        key: "html-work",
        state: "blocked",
      }, "203.0.113.20")
    );
    assert.equal(blocked.status, 200);
    const done = await ba.botActivityApiPost(
      request("POST", url, token, {
        type: "work",
        bot: "Newbie",
        key: "html-work",
        state: "done",
      }, "203.0.113.20")
    );
    assert.equal(done.status, 200);
    const work = getDb()
      .prepare(`SELECT state, detail FROM bot_activity_items WHERE item_key = 'html-work'`)
      .get() as { state: string; detail: string };
    assert.equal(work.state, "done");
    assert.equal(work.detail, script);

    const listed = await ba.botActivityApiGet(
      request("GET", `${url}?bot=Newbie`, token, undefined, "203.0.113.21")
    );
    assert.equal(listed.status, 200);
    const waiting = (listed.body as { waiting: Array<{ title: string; detail: string; status: string; replies: unknown[] }> }).waiting;
    assert.equal(waiting.length, 1);
    assert.equal(waiting[0].status, "resolved");
    assert.equal(waiting[0].title, "Renamed");
    assert.equal(waiting[0].detail, script);
    assert.deepEqual(waiting[0].replies, []);

    const other = await ba.botActivityApiGet(
      request("GET", `${url}?bot=Jessica`, token, undefined, "203.0.113.21")
    );
    const jessica = (other.body as { waiting: Array<{ bot: string }> }).waiting;
    assert.ok(jessica.every((item) => item.bot === "Jessica"));

    const future = await ba.botActivityApiGet(
      request("GET", `${url}?bot=Newbie&since=2099-01-01T00:00:00.000Z`, token, undefined, "203.0.113.22")
    );
    assert.equal((future.body as { waiting: unknown[] }).waiting.length, 0);
    const past = await ba.botActivityApiGet(
      request("GET", `${url}?since=2026-01-01T00:00:00.000Z`, token, undefined, "203.0.113.22")
    );
    assert.ok((past.body as { waiting: unknown[] }).waiting.length > 0);

    const board = ba.botActivityBoard();
    const card = board.waiting.find((item) => item.bot === "Newbie");
    assert.equal(card, undefined);
    const task = board.work.find((item) => item.bot === "Newbie");
    assert.equal(task?.state, "done");
    assert.equal(task?.detail, script);
    const line = board.timeline.flatMap((day) => day.entries).find((entry) => entry.bot === "Newbie");
    assert.equal(line?.text, script);
    assert.equal(board.bots.find((bot) => bot.name === "Newbie")?.agentId, "");
  });

  await t.test("only Michael can read the board and save or dismiss a reply", async () => {
    ba.resetBotActivityRateLimitForTests();
    const denied = [
      null,
      actor(carlos),
      actor(jack),
      actor(cassidy),
      actor(kyle),
      actor(luis),
      actor(access.subjectFor("abel")),
      { role: "admin" as const, person: "carlos", impersonating: true },
    ];
    for (const who of denied) {
      const read = ba.botActivityAdminGet(who);
      assert.equal(read.status, who ? 403 : 401, who?.person || "signed-out");
      const write = await ba.botActivityAdminPost(
        request("POST", "https://hub.example/api/admin/bot-activity", null, {
          action: "reply",
          id: "seed-w-2",
          body: "should not save",
        }, "203.0.113.30"),
        who
      );
      assert.equal(write.status, who ? 403 : 401, who?.person || "signed-out");
    }
    const replies = getDb()
      .prepare(`SELECT COUNT(*) AS n FROM bot_activity_replies`)
      .get() as { n: number };
    assert.equal(replies.n, 0);

    const board = ba.botActivityAdminGet(michael);
    assert.equal(board.status, 200);
    const saved = await ba.botActivityAdminPost(
      request("POST", "https://hub.example/api/admin/bot-activity", "primary-token-value", {
        action: "reply",
        id: "seed-w-2",
        body: "Use the login I just sent.",
      }, "203.0.113.31"),
      michael
    );
    assert.equal(saved.status, 200);
    const reply = (saved.body as { reply: { body: string; at: string; when: string } }).reply;
    assert.equal(reply.body, "Use the login I just sent.");
    assert.match(reply.when, /PT$/);
    assert.ok(reply.at.startsWith("2026-") || reply.at.startsWith("20"));

    const visible = ba.botActivityBoard().waiting.find((item) => item.id === "seed-w-2");
    assert.equal(visible?.replies[0].body, "Use the login I just sent.");

    const forBots = await ba.botActivityApiGet(
      request(
        "GET",
        "https://hub.marketingempiregroup.com/api/bot-activity?bot=Daniel",
        "primary-token-value",
        undefined,
        "203.0.113.32"
      )
    );
    const daniel = (forBots.body as { waiting: Array<{ key: string; status: string; replies: Array<{ body: string }> }> }).waiting;
    const item = daniel.find((row) => row.key === "vita-q4-offer-answers-and-mockup");
    assert.equal(item?.status, "open");
    assert.equal(item?.replies[0].body, "Use the login I just sent.");

    const dismissed = await ba.botActivityAdminPost(
      request("POST", "https://hub.example/api/admin/bot-activity", null, {
        action: "dismiss",
        id: "seed-w-2",
      }, "203.0.113.33"),
      michael
    );
    assert.equal(dismissed.status, 200);
    assert.equal(
      ba.botActivityBoard().waiting.some((row) => row.id === "seed-w-2"),
      false
    );
    const after = await ba.botActivityApiGet(
      request(
        "GET",
        "https://hub.marketingempiregroup.com/api/bot-activity?bot=Daniel&since=2020-01-01T00:00:00.000Z",
        "primary-token-value",
        undefined,
        "203.0.113.34"
      )
    );
    const resolved = (after.body as { waiting: Array<{ key: string; status: string; replies: unknown[] }> }).waiting.find(
      (row) => row.key === "vita-q4-offer-answers-and-mockup"
    );
    assert.equal(resolved?.status, "resolved");
    assert.equal(resolved?.replies.length, 1);
  });

  await t.test("oversized and unauthenticated floods are refused", async () => {
    ba.resetBotActivityRateLimitForTests();
    const url = "https://hub.marketingempiregroup.com/api/bot-activity";
    const huge = "x".repeat(ba.BOT_ACTIVITY_MAX_BODY + 1);
    const tooBig = await ba.botActivityApiPost(
      new Request(url, {
        method: "POST",
        headers: {
          authorization: "Bearer primary-token-value",
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.40",
        },
        body: huge,
      })
    );
    assert.equal(tooBig.status, 413);

    ba.resetBotActivityRateLimitForTests();
    let last = 0;
    for (let i = 0; i < ba.BOT_ACTIVITY_RATE_LIMIT + 1; i++) {
      const res = await ba.botActivityApiGet(
        request("GET", url, "wrong-token", undefined, "203.0.113.41")
      );
      last = res.status;
    }
    assert.equal(last, 429);
  });

  await t.test("owner board reads are not counted by the bot rate limit", async () => {
    ba.resetBotActivityRateLimitForTests();
    const url = "https://hub.marketingempiregroup.com/api/bot-activity";
    for (let i = 0; i < ba.BOT_ACTIVITY_RATE_LIMIT; i++) {
      const res = await ba.botActivityApiGet(
        request("GET", url, "primary-token-value", undefined, "203.0.113.77")
      );
      assert.equal(res.status, 200);
    }
    const blocked = await ba.botActivityApiGet(
      request("GET", url, "primary-token-value", undefined, "203.0.113.77")
    );
    assert.equal(blocked.status, 429);
    for (let i = 0; i < 40; i++) {
      assert.equal(ba.botActivityAdminGet(michael).status, 200);
    }
  });

  await t.test("an existing database and an empty database both boot", async () => {
    getDb().pragma("wal_checkpoint(TRUNCATE)");
    const live = path.join(tmp, "data", "campaign-desk.db");
    const existingDir = fs.mkdtempSync(path.join(os.tmpdir(), "cd-bot-existing-"));
    fs.mkdirSync(path.join(existingDir, "data"));
    fs.copyFileSync(live, path.join(existingDir, "data", "campaign-desk.db"));
    const { default: Database } = await import("better-sqlite3");
    const old = new Database(path.join(existingDir, "data", "campaign-desk.db"));
    old.exec(`
      DROP TABLE IF EXISTS bot_activity_replies;
      DROP TABLE IF EXISTS bot_activity_timeline;
      DROP TABLE IF EXISTS bot_activity_items;
      DROP TABLE IF EXISTS bot_activity_bots;
    `);
    old.prepare(`DELETE FROM app_settings WHERE key = ?`).run(schema.BOT_ACTIVITY_SEED_KEY);
    old.prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('keep-me', 'yes', '2026-01-01T00:00:00.000Z')
       ON CONFLICT(key) DO UPDATE SET value = 'yes'`
    ).run();
    const campaigns = old.prepare(`SELECT COUNT(*) AS n FROM campaigns`).get() as { n: number };
    old.close();

    closeDbForTests();
    process.chdir(existingDir);
    const health = getDb().prepare("SELECT 1 AS ok").get() as { ok: number };
    assert.equal(health.ok, 1);
    const kept = getDb()
      .prepare(`SELECT value FROM app_settings WHERE key = 'keep-me'`)
      .get() as { value: string };
    assert.equal(kept.value, "yes");
    const reseeded = getDb()
      .prepare(`SELECT COUNT(*) AS n FROM bot_activity_timeline`)
      .get() as { n: number };
    assert.equal(reseeded.n, schema.TIMELINE_SEED.length);
    const stillThere = getDb().prepare(`SELECT COUNT(*) AS n FROM campaigns`).get() as { n: number };
    assert.equal(stillThere.n, campaigns.n);
    closeDbForTests();

    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "cd-bot-empty-"));
    process.chdir(emptyDir);
    const fresh = getDb().prepare("SELECT 1 AS ok").get() as { ok: number };
    assert.equal(fresh.ok, 1);
    const seeded = getDb()
      .prepare(`SELECT COUNT(*) AS n FROM bot_activity_bots`)
      .get() as { n: number };
    assert.equal(seeded.n, schema.BOT_SEED.length);
    closeDbForTests();
    process.chdir(tmp);

    fs.rmSync(existingDir, { recursive: true, force: true });
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});
