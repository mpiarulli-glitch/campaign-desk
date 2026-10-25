import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  BOT_ACTIVITY_POLL_MS,
  BOT_PORTRAIT_NAMES,
  BotActivityRefresh,
  authRedirectForStatus,
  botHoverSummary,
  botPortraitSrc,
  currentAssignment,
  forElapsed,
  teamRank,
  fetchedLabel,
  nextBoardState,
  pollDelayMs,
  statusForBot,
  timeAgo,
  WORKING_FRESH_MS,
  JUST_DONE_MS,
  isUntouchedSeed,
  lastHeardAt,
  heardLabel,
  doingTitle,
} from "../src/lib/bot-activity-live";
import { countFloor, finishedBots, floorSummary, groupByPacificDay, propForTask, timelineStamp } from "../src/lib/bot-activity-office";

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

test("an unchanged board is not applied", () => {
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
  const freshAt = "2026-10-24T22:00:00.000Z";
  const now = Date.parse("2026-10-24T22:10:00.000Z");
  assert.equal(
    statusForBot("David", [], [{ bot: "David", state: "progress", updatedAt: freshAt }], [], now),
    "Working"
  );
  assert.equal(
    statusForBot(
      "Emily",
      [],
      [{ bot: "Emily", state: "progress", at: "2026-10-22T22:10:00.000Z", updatedAt: "2026-10-22T22:10:00.000Z" }],
      [],
      now
    ),
    "Stalled"
  );
  assert.equal(statusForBot("David", [], [{ bot: "David", state: "progress" }], [], now), "Stalled");
  assert.equal(
    statusForBot(
      "Rachel",
      [],
      [{ bot: "Rachel", state: "progress", updatedAt: "2026-10-22T22:10:00.000Z" }],
      [{ bot: "Rachel", at: "2026-10-22T22:10:00.000Z", postedAt: freshAt }],
      now
    ),
    "Working"
  );
  assert.equal(WORKING_FRESH_MS, 30 * 60 * 1000);
  assert.equal(statusForBot("Cody", [], [{ bot: "Cody", state: "done" }], [], now), "Idle");
  assert.equal(statusForBot("Wes", [], [], [], now), "Idle");

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

  const clock = Date.parse("2026-10-24T22:00:00.000Z");
  assert.equal(timeAgo("2026-10-24T21:59:40.000Z", clock), "just now");
  assert.equal(timeAgo("2026-10-24T21:55:00.000Z", clock), "5m ago");
  assert.equal(timeAgo("2026-10-24T20:00:00.000Z", clock), "2h ago");
  assert.equal(timeAgo("2026-10-21T22:00:00.000Z", clock), "3d ago");
  assert.equal(timeAgo("not-a-time", clock), "");

  assert.equal(fetchedLabel(new Date("2026-10-24T22:02:00.000Z")), "Live · Updated 3:02 PM PT");

  for (const name of BOT_PORTRAIT_NAMES) {
    assert.equal(botPortraitSrc(name), `/bots/${name}.jpg`);
    assert.equal(botPortraitSrc(name[0].toUpperCase() + name.slice(1)), `/bots/${name}.jpg`);
  }
  assert.equal(botPortraitSrc("Newbie"), "/bots/newbie.jpg");

  const summary = botHoverSummary(
    "Emily",
    [{ bot: "Emily", title: "Which subject line?", detail: "A or B", at: "2026-10-24T01:00:00.000Z" }],
    [
      { bot: "Emily", title: "Old block", detail: "earlier", state: "blocked", at: "2026-10-23T00:00:00.000Z" },
      { bot: "Emily", title: "Launch copy", detail: "needs a login", state: "blocked", at: "2026-10-24T02:00:00.000Z" },
      { bot: "Emily", title: "Finished draft", detail: "sent", state: "done", at: "2026-10-24T03:00:00.000Z" },
    ],
    [
      { bot: "Emily", text: "Oldest note.", at: "2026-10-22T00:00:00.000Z" },
      { bot: "Emily", text: "Middle note.", at: "2026-10-23T00:00:00.000Z" },
      { bot: "Emily", text: "Newest note.", at: "2026-10-24T04:00:00.000Z" },
      { bot: "Emily", text: "Second newest.", at: "2026-10-24T03:00:00.000Z" },
      { bot: "Jerry", text: "Not Emily.", at: "2026-10-24T05:00:00.000Z" },
    ]
  );
  assert.equal(summary.status, "Blocked");
  assert.equal(summary.line, "");
  assert.equal(summary.task?.title, "Launch copy");
  assert.match(summary.request, /^Launch copy\nneeds a login\n\nWhich subject line\?\nA or B\n\nOld block\nearlier$/);
  const working = botHoverSummary(
    "David",
    [],
    [{ bot: "David", title: "Newsletter", detail: "", state: "progress", at: freshAt, updatedAt: freshAt }],
    [],
    now
  );
  assert.equal(working.status, "Working");
  assert.equal(working.request, "");
  assert.equal(working.line, "Working: last update 10m ago");
  const stalled = botHoverSummary(
    "James",
    [],
    [
      {
        bot: "James",
        title: "Audit",
        detail: "",
        state: "progress",
        at: "2026-10-22T22:10:00.000Z",
        updatedAt: "2026-10-22T22:10:00.000Z",
      },
    ],
    [],
    now
  );
  assert.equal(stalled.status, "Stalled");
  assert.equal(stalled.line, "Stalled: last update 2d ago");
  assert.equal(botHoverSummary("Cody", [], [], [], now).line, "Idle: nothing is running.");
  assert.ok(teamRank("Blocked") < teamRank("Waiting on you"));
  assert.ok(teamRank("Waiting on you") < teamRank("Working"));
  assert.ok(teamRank("Working") < teamRank("Stalled"));
  assert.ok(teamRank("Stalled") < teamRank("Idle"));
  const elapsedNow = Date.parse("2026-10-24T22:12:00.000Z");
  assert.equal(forElapsed("2026-10-24T22:00:00.000Z", elapsedNow), "for 12m");
  assert.equal(forElapsed("2026-10-24T20:12:00.000Z", elapsedNow), "for 2h");

  for (const name of BOT_PORTRAIT_NAMES) {
    const file = path.join("public/bots", `${name}.jpg`);
    const bytes = fs.readFileSync(file);
    assert.ok(bytes.length > 0 && bytes.length <= 60 * 1024, `${name} is ${bytes.length} bytes`);
    assert.equal(bytes[0], 0xff);
    assert.equal(bytes[1], 0xd8);
  }
});

test("untouched seed rows are not live, and a fresh bot write is", () => {
  const now = Date.parse("2026-10-24T22:10:00.000Z");
  const fresh = "2026-10-24T22:00:00.000Z";
  const old = "2026-10-22T22:10:00.000Z";
  assert.equal(JUST_DONE_MS, 2 * 60 * 1000);
  assert.equal(isUntouchedSeed({ id: "seed-k-5", at: old, updatedAt: old }), true);
  assert.equal(isUntouchedSeed({ id: "seed-t-3", at: old, updatedAt: fresh }), true);
  assert.equal(isUntouchedSeed({ id: "seed-k-5", at: old, updatedAt: fresh }), false);
  assert.equal(isUntouchedSeed({ id: "abc", at: old, updatedAt: old }), false);

  assert.equal(
    statusForBot("Emily", [], [{ id: "seed-k-11", bot: "Emily", state: "progress", at: old, updatedAt: old }], [], now),
    "Idle"
  );
  assert.equal(
    statusForBot(
      "Jerry",
      [{ id: "seed-w-1", bot: "Jerry", at: old, updatedAt: old }],
      [{ id: "seed-k-3", bot: "Jerry", state: "blocked", at: old, updatedAt: old }],
      [],
      now
    ),
    "Idle"
  );
  assert.equal(
    statusForBot(
      "David",
      [],
      [{ id: "seed-k-5", bot: "David", state: "progress", at: old, updatedAt: fresh }],
      [],
      now
    ),
    "Working"
  );
  assert.equal(
    statusForBot(
      "Rachel",
      [],
      [{ id: "post-1", bot: "Rachel", state: "progress", at: old, updatedAt: old }],
      [],
      now
    ),
    "Stalled"
  );
  assert.equal(
    statusForBot(
      "David",
      [],
      [{ id: "seed-k-5", bot: "David", state: "progress", at: fresh, updatedAt: fresh }],
      [],
      now
    ),
    "Working"
  );
  assert.equal(lastHeardAt("David", [], [{ id: "seed-k-5", bot: "David", at: old, updatedAt: old }], []), "");
  assert.equal(
    lastHeardAt("David", [], [{ id: "seed-k-5", bot: "David", at: old, updatedAt: fresh }], []),
    fresh
  );
  assert.match(
    heardLabel("Emily", [], [{ id: "seed-k-11", bot: "Emily", at: old, updatedAt: old }], [], now),
    /^Not updated since /
  );
  assert.equal(
    heardLabel("David", [], [{ id: "seed-k-5", bot: "David", at: old, updatedAt: fresh }], [], now),
    "Last heard 10m ago"
  );
  assert.equal(doingTitle("David", [{ id: "seed-k-5", bot: "David", title: "Newsletter", state: "progress", at: old, updatedAt: fresh }], now), "Newsletter");
  assert.equal(propForTask("Weekly newsletter"), "envelope");
  assert.equal(propForTask("booking automation"), "flow");
  assert.equal(propForTask("Basecamp todo"), "clipboard");
  assert.equal(propForTask("DNS record for the site"), "globe");
  assert.equal(propForTask("audit report"), "search");
  assert.equal(propForTask("something else"), "gear");
  assert.equal(floorSummary({ working: 9, need: 2, idle: 2, stalled: 1 }), "9 working · 2 need you · 2 idle · 1 stalled");
  assert.equal(floorSummary(countFloor(["David", "Emily"], [], [
    { id: "seed-k-5", bot: "David", state: "progress", at: old, updatedAt: fresh },
    { id: "seed-k-11", bot: "Emily", state: "progress", at: old, updatedAt: old },
  ], [], now)), "1 working · 0 need you · 1 idle · 0 stalled");

  const late = "2026-10-24T18:00:00.000Z";
  const early = "2026-10-24T06:30:00.000Z";
  const groups = groupByPacificDay([
    { at: early, text: "night" },
    { at: late, text: "morning" },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].entries[0].text, "morning");
  assert.equal(groups[1].entries[0].text, "night");
  assert.match(timelineStamp(fresh, now), /· 10m ago$/);

  const doneOld = [{ id: "w1", bot: "Jessica", state: "done", at: old, updatedAt: old }];
  assert.deepEqual(finishedBots(null, { work: doneOld, lines: [] }, now), []);
  const just = "2026-10-24T22:09:30.000Z";
  assert.deepEqual(
    finishedBots(null, { work: [{ id: "w1", bot: "Jessica", state: "done", at: just, updatedAt: just }], lines: [] }, now),
    ["Jessica"]
  );
  assert.deepEqual(
    finishedBots(
      { work: [{ id: "w1", bot: "Daniel", state: "progress", at: old, updatedAt: old }], lines: [] },
      { work: [{ id: "w1", bot: "Daniel", state: "done", at: old, updatedAt: fresh }], lines: [] },
      now
    ),
    ["Daniel"]
  );
});

test("the page wires a quiet refresh and the team layout without a second filter", () => {
  const page = [
    fs.readFileSync(path.join("src/app/admin/bot-activity/page.tsx"), "utf8"),
    fs.readFileSync(path.join("src/app/admin/bot-activity/office-floor.tsx"), "utf8"),
  ].join("\n");
  const css = fs.readFileSync(path.join("src/app/globals.css"), "utf8");
  const live = fs.readFileSync(path.join("src/lib/bot-activity-live.ts"), "utf8");
  const lib = fs.readFileSync(path.join("src/lib/bot-activity.ts"), "utf8");

  assert.match(page, /new BotActivityRefresh/);
  assert.match(page, /setHidden/);
  assert.match(page, /visibilitychange/);
  assert.match(page, /poller\.stop\(\)/);
  assert.match(page, /nextBoardState/);
  assert.doesNotMatch(page, /retainReplyDrafts/);
  assert.doesNotMatch(live, /retainReplyDrafts/);
  assert.match(page, /cache:\s*"no-store"/);
  assert.match(page, /Live · Updated/);
  assert.match(page, /ba-live-dot/);
  assert.match(page, /Last update/);
  assert.match(page, /ba-board/);
  assert.match(page, /Couldn't refresh/);
  assert.match(page, /Needs you/);
  assert.doesNotMatch(page, /Save \/ Send/);
  assert.doesNotMatch(page, /textarea/);
  assert.doesNotMatch(page, /action: "reply"/);
  assert.match(page, /Dismiss/);
  assert.match(page, /item\.chatHref \|\| grokBotHref\(item\.bot\)/);
  assert.match(page, /className="btn ba-open-chat"/);
  assert.match(page, /onError=/);
  assert.match(page, /alt=\{name\}/);
  assert.match(css, /\.ba-avatar \{[^}]*border-radius: 50%/);
  assert.match(css, /\.ba-avatar img \{[^}]*object-fit: cover/);
  assert.match(page, /id="ba-bot"/);
  assert.match(page, /grokBotHref/);
  assert.match(page, /Open chat/);
  assert.match(page, /doing:/);
  assert.match(live, /Last heard/);
  assert.match(page, /Not updated since/);
  assert.match(page, /Old request/);
  assert.match(page, /ba-floor/);
  assert.match(page, /Michael/);
  assert.match(page, /is-\$\{tone\}/);
  assert.match(page, /ba-bubble/);
  assert.match(page, /onMouseEnter=/);
  assert.match(page, /onFocus=\{\(\) => setOpen\(bot\.name\)\}/);
  const icons = fs.readFileSync(path.join("src/lib/bot-activity-icons.ts"), "utf8");
  assert.match(icons, /grokbot:\/\/app\/v1\/agent\?id=/);
  assert.match(icons, /Jerry: "74308129-2f1d-43a1-973e-029bc428d239"/);
  assert.match(icons, /Cody: "5e4e3635-7589-4b3e-9782-6a00d07b53e0"/);
  assert.doesNotMatch(icons, /Emily:/);
  assert.doesNotMatch(icons, /Wes:/);
  assert.match(css, /ba-glow-amber/);
  assert.match(css, /ba-bob/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(page, /role="tooltip"/);
  assert.doesNotMatch(page, /createPortal/);
  assert.match(css, /\.ba-pop \{[^}]*position: absolute/);
  assert.doesNotMatch(css, /\.ba-pop \{[^}]*position: fixed/);
  assert.match(css, /\.ba-board \{[^}]*1\.55fr/);
  assert.doesNotMatch(css, /ba-send/);
  assert.doesNotMatch(css, /ba-reply-form/);
  assert.match(css, /\.ba-open-chat \{[^}]*min-height: 44px/);
  assert.match(page, /id="ba-bot"/);
  assert.doesNotMatch(page, /setDrafts/);
  assert.match(live, /BOT_ACTIVITY_POLL_MS = 5_000/);
  assert.doesNotMatch(page, /new BotActivityRefresh[\s\S]{0,400}30_000/);
  assert.match(css, /ba-needs/);
  assert.match(css, /ba-desks/);
  assert.match(css, /ba-floor/);
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
