import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  BOT_ACTIVITY_POLL_MS,
  BOT_PORTRAIT_NAMES,
  BotActivityRefresh,
  authRedirectForStatus,
  botPortraitSrc,
  currentAssignment,
  fetchedLabel,
  nextBoardState,
  pollDelayMs,
  retainReplyDrafts,
  statusForBot,
  timeAgo,
} from "../src/lib/bot-activity-live";

type Timer = { fn: () => void; ms: number };

function fakePoller(run: () => Promise<"ok" | "fail" | "auth">) {
  let timers: Timer[] = [];
  let calls = 0;
  let active = 0;
  let peak = 0;
  const poller = new BotActivityRefresh<Timer>({
    setTimer(fn, ms) {
      const timer: Timer = {
        ms,
        fn: () => {
          timers = timers.filter((item) => item !== timer);
          fn();
        },
      };
      timers.push(timer);
      return timer;
    },
    clearTimer(id) {
      timers = timers.filter((timer) => timer !== id);
    },
    async run() {
      calls += 1;
      active += 1;
      peak = Math.max(peak, active);
      try {
        return await run();
      } finally {
        active -= 1;
      }
    },
  });
  return {
    poller,
    calls: () => calls,
    peak: () => peak,
    timers: () => timers,
  };
}

test("the board refreshes every 5 seconds and pauses while hidden", async () => {
  assert.equal(BOT_ACTIVITY_POLL_MS, 5_000);
  assert.equal(pollDelayMs(0), 5_000);
  assert.equal(pollDelayMs(1), 10_000);
  assert.equal(pollDelayMs(2), 20_000);
  assert.equal(pollDelayMs(3), 40_000);
  assert.equal(pollDelayMs(9), 40_000);

  let outcome: "ok" | "fail" | "auth" = "ok";
  const harness = fakePoller(async () => outcome);
  await harness.poller.start();
  assert.equal(harness.calls(), 1);
  assert.equal(harness.timers().length, 1);
  assert.equal(harness.timers()[0].ms, 5_000);

  harness.poller.setHidden(true);
  assert.equal(harness.timers().length, 0);
  const paused = harness.calls();
  harness.timers().forEach((timer) => timer.fn());
  await harness.poller.settled();
  assert.equal(harness.calls(), paused);

  await harness.poller.setHidden(false);
  assert.equal(harness.calls(), paused + 1);
  assert.equal(harness.timers()[0].ms, 5_000);

  const armed = harness.timers()[0];
  armed.fn();
  await harness.poller.settled();
  assert.equal(harness.calls(), paused + 2);
  assert.equal(harness.peak(), 1);

  outcome = "fail";
  harness.timers()[0].fn();
  await harness.poller.settled();
  assert.equal(harness.timers()[0].ms, 10_000);
  harness.timers()[0].fn();
  await harness.poller.settled();
  assert.equal(harness.timers()[0].ms, 20_000);
  outcome = "ok";
  harness.timers()[0].fn();
  await harness.poller.settled();
  assert.equal(harness.timers()[0].ms, 5_000);

  const fn = harness.timers()[0].fn;
  harness.poller.stop();
  assert.equal(harness.timers().length, 0);
  const stopped = harness.calls();
  fn();
  await harness.poller.settled();
  assert.equal(harness.calls(), stopped);
  await harness.poller.setHidden(false);
  assert.equal(harness.calls(), stopped);
});

test("a hidden tab does not start a second request over one already running", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const harness = fakePoller(async () => {
    await gate;
    return "ok";
  });
  const first = harness.poller.start();
  assert.equal(harness.calls(), 1);
  harness.poller.setHidden(true);
  const resumed = harness.poller.setHidden(false);
  assert.equal(harness.peak(), 1);
  assert.equal(harness.calls(), 1);
  release();
  await first;
  await resumed;
  assert.equal(harness.peak(), 1);
  assert.equal(harness.timers().length, 1);
});

test("401 and 403 stop the refresh and use the same redirects as the first load", async () => {
  assert.equal(authRedirectForStatus(401), "/login");
  assert.equal(authRedirectForStatus(403), "/admin/hub");
  assert.equal(authRedirectForStatus(500), null);
  assert.equal(authRedirectForStatus(200), null);

  const harness = fakePoller(async () => "auth");
  await harness.poller.start();
  assert.equal(harness.calls(), 1);
  assert.equal(harness.timers().length, 0);
  await harness.poller.setHidden(false);
  assert.equal(harness.calls(), 1);
});

test("an unchanged board is not applied, and a reply draft survives an item update", () => {
  const first = { waiting: [{ id: "w1", detail: "Old detail", title: "Sign in" }] };
  const opened = nextBoardState("", first);
  assert.deepEqual(opened.board, first);

  const again = nextBoardState(opened.key, {
    waiting: [{ id: "w1", detail: "Old detail", title: "Sign in" }],
  });
  assert.equal(again.board, null);
  assert.equal(again.key, opened.key);

  const edited = nextBoardState(opened.key, {
    waiting: [{ id: "w1", detail: "The login form changed.", title: "Sign in" }],
  });
  assert.ok(edited.board);
  assert.equal(edited.board?.waiting[0].detail, "The login form changed.");

  const drafts = { w1: "Use the login I just sent." };
  const kept = retainReplyDrafts(drafts);
  assert.equal(kept, drafts);
  assert.equal(kept.w1, "Use the login I just sent.");
  const pruned = retainReplyDrafts({ w1: "still typing", w2: "" });
  assert.deepEqual(pruned, { w1: "still typing" });
});

test("team status, current task, portrait path, and the fetched label", () => {
  assert.equal(
    statusForBot(
      "Jerry",
      [{ bot: "Jerry" }],
      [
        { bot: "Jerry", state: "blocked" },
        { bot: "Jerry", state: "progress" },
      ]
    ),
    "Blocked"
  );
  assert.equal(
    statusForBot("Jessica", [{ bot: "Jessica" }], [{ bot: "Jessica", state: "done" }]),
    "Waiting on you"
  );
  assert.equal(statusForBot("David", [], [{ bot: "David", state: "progress" }]), "Working");
  assert.equal(statusForBot("Cody", [], [{ bot: "Cody", state: "done" }]), "Idle");
  assert.equal(statusForBot("Wes", [], []), "Idle");

  const work = [
    { bot: "Daniel", title: "Older block", detail: "stuck", state: "blocked", at: "2026-10-23T00:00:00.000Z" },
    { bot: "Daniel", title: "Vita Q4 finalize", detail: "v6 saved", state: "progress", at: "2026-10-24T00:00:00.000Z" },
    { bot: "Sarah", title: "Done emails", detail: "qa passed", state: "done", at: "2026-10-24T01:00:00.000Z" },
  ];
  const lines = [
    { bot: "Sarah", text: "Drafted the pre-launch.", at: "2026-10-23T20:00:00.000Z" },
    { bot: "Sarah", text: "Newest line.", at: "2026-10-24T02:00:00.000Z" },
  ];
  assert.deepEqual(currentAssignment("Daniel", work, lines), {
    title: "Vita Q4 finalize",
    detail: "v6 saved",
    at: "2026-10-24T00:00:00.000Z",
  });
  assert.deepEqual(currentAssignment("Sarah", work, lines), {
    title: "Newest line.",
    detail: "",
    at: "2026-10-24T02:00:00.000Z",
  });
  assert.equal(currentAssignment("Nobody", work, lines), null);

  const now = Date.parse("2026-10-24T22:00:00.000Z");
  assert.equal(timeAgo("2026-10-24T21:59:40.000Z", now), "just now");
  assert.equal(timeAgo("2026-10-24T21:55:00.000Z", now), "5m ago");
  assert.equal(timeAgo("2026-10-24T20:00:00.000Z", now), "2h ago");
  assert.equal(timeAgo("2026-10-21T22:00:00.000Z", now), "3d ago");
  assert.equal(timeAgo("not-a-time", now), "");

  assert.equal(fetchedLabel(new Date("2026-10-24T22:02:00.000Z")), "Fetched 3:02 PM PT");

  for (const name of BOT_PORTRAIT_NAMES) {
    assert.equal(botPortraitSrc(name), `/bots/${name}.jpg`);
    assert.equal(botPortraitSrc(name[0].toUpperCase() + name.slice(1)), `/bots/${name}.jpg`);
  }
  assert.equal(botPortraitSrc("Newbie"), "/bots/newbie.jpg");
});

test("the page wires a quiet refresh and the team layout without a second filter", () => {
  const page = fs.readFileSync(path.join("src/app/admin/bot-activity/page.tsx"), "utf8");
  const css = fs.readFileSync(path.join("src/app/globals.css"), "utf8");
  const live = fs.readFileSync(path.join("src/lib/bot-activity-live.ts"), "utf8");
  const lib = fs.readFileSync(path.join("src/lib/bot-activity.ts"), "utf8");

  assert.match(page, /new BotActivityRefresh/);
  assert.match(page, /setHidden/);
  assert.match(page, /visibilitychange/);
  assert.match(page, /poller\.stop\(\)/);
  assert.match(page, /nextBoardState/);
  assert.match(page, /retainReplyDrafts/);
  assert.match(page, /cache:\s*"no-store"/);
  assert.match(page, /Fetched/);
  assert.match(page, /Couldn't refresh/);
  assert.match(page, /Needs you/);
  assert.match(page, /Save \/ Send/);
  assert.match(page, /Dismiss/);
  assert.match(page, /value=\{drafts\[item\.id\]/);
  assert.match(page, /onError=/);
  assert.match(page, /aria-pressed=\{botFilter === bot\.name\}/);
  assert.match(page, /id="ba-bot"/);
  assert.doesNotMatch(page, /setDrafts\(\{\}\)/);
  assert.doesNotMatch(page, /setDrafts\(\s*\{\s*\}\s*\)/);
  assert.match(live, /BOT_ACTIVITY_POLL_MS = 5_000/);
  assert.doesNotMatch(page, /new BotActivityRefresh[\s\S]{0,400}30_000/);
  assert.match(css, /ba-needs/);
  assert.match(css, /ba-team-grid/);
  assert.match(css, /ba-pulse/);
  assert.match(css, /@media \(max-width: 800px\)/);

  const boardFn = lib.slice(
    lib.indexOf("export function botActivityBoard"),
    lib.indexOf("export function botActivityAdminGet")
  );
  assert.equal((boardFn.match(/\.prepare\(/g) || []).length, 5);
  assert.equal((boardFn.match(/repliesFor\(/g) || []).length, 1);
  assert.doesNotMatch(boardFn, /rateAllowed|gateBot/);
  const adminGet = lib.slice(
    lib.indexOf("export function botActivityAdminGet"),
    lib.indexOf("export async function botActivityAdminPost")
  );
  assert.doesNotMatch(adminGet, /rateAllowed|gateBot|BOT_ACTIVITY_RATE/);
});
