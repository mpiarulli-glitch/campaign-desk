import assert from "node:assert/strict";
import test from "node:test";
import {
  addCalendarDays,
  campaignCountsTowardQuota,
  contractPace,
  emailPlatformLabel,
  isEmailPlatform,
  lastYmdOfPeriod,
  previewLaunchTodos,
  sameLifecycleAccount,
  weekdayOnOrAfter,
} from "../src/lib/email-launch";

test("automation packages and welcome series do not count toward quota", () => {
  assert.equal(campaignCountsTowardQuota("package", "August broadcasts"), true);
  assert.equal(campaignCountsTowardQuota("automation", "August broadcasts"), false);
  assert.equal(campaignCountsTowardQuota("package", "Our Watch Welcome Series V2"), false);
  assert.equal(campaignCountsTowardQuota("package", "First Look Automation"), false);
  assert.equal(campaignCountsTowardQuota("package", "Browse Return Flow"), false);
});

test("contact-suffix aliases are the same lifecycle account", () => {
  assert.equal(sameLifecycleAccount("Our Watch", "Our Watch w/Tim Thompson"), true);
  assert.equal(sameLifecycleAccount("Looda House Pawn", "Looda House Pawn"), true);
  assert.equal(sameLifecycleAccount("Krak Boba", "Krak Boba Oceanside"), false);
  assert.equal(sameLifecycleAccount("Looda House Auction", "Looda House Pawn"), false);
});

test("email platforms are the five ESPs we ask for", () => {
  assert.equal(isEmailPlatform("ghl"), true);
  assert.equal(isEmailPlatform("klaviyo"), true);
  assert.equal(isEmailPlatform("mailchimp"), true);
  assert.equal(isEmailPlatform("hubspot"), true);
  assert.equal(isEmailPlatform("instantly"), true);
  assert.equal(isEmailPlatform("skylead"), false);
  assert.equal(isEmailPlatform(""), false);
  assert.equal(emailPlatformLabel("instantly"), "Instantly.ai");
  assert.equal(emailPlatformLabel("ghl"), "GHL");
});

test("weekend due dates slide to Monday", () => {
  assert.equal(weekdayOnOrAfter("2026-08-28"), "2026-08-28"); // Friday
  assert.equal(weekdayOnOrAfter("2026-08-29"), "2026-08-31"); // Saturday
  assert.equal(weekdayOnOrAfter("2026-08-30"), "2026-08-31"); // Sunday
});

test("launch todos fall 2, 3, and 4 weeks after launch", () => {
  const preview = previewLaunchTodos("2026-08-26");
  assert.equal(preview.length, 3);
  assert.equal(preview[0].title, "Editorial campaign calendar");
  assert.equal(preview[0].dueDate, "2026-09-09");
  assert.equal(preview[1].title, "First round of campaigns");
  assert.equal(preview[1].dueDate, "2026-09-16");
  assert.equal(preview[2].title, "Automations");
  assert.equal(preview[2].dueDate, "2026-09-23");
});

test("weekend due dates from a Saturday launch slide to Monday", () => {
  const preview = previewLaunchTodos("2026-08-29");
  assert.equal(preview[0].dueDate, "2026-09-14"); // +2 weeks Sat -> Mon
  assert.equal(preview[1].dueDate, "2026-09-21");
  assert.equal(preview[2].dueDate, "2026-09-28");
});

test("launch preview ignores a bad start date", () => {
  assert.deepEqual(previewLaunchTodos("next week"), []);
});

test("last day of August 2026", () => {
  assert.equal(lastYmdOfPeriod("2026-08"), "2026-08-31");
  assert.equal(lastYmdOfPeriod("2026-02"), "2026-02-28");
});

test("addCalendarDays crosses months", () => {
  assert.equal(addCalendarDays("2026-08-26", 12), "2026-09-07");
});

test("no quota is not behind", () => {
  const pace = contractPace(0, 0, 26, 31);
  assert.equal(pace.status, "no_quota");
  assert.equal(pace.remaining, 0);
});

test("quota met is met even late in the month", () => {
  const pace = contractPace(4, 4, 28, 31);
  assert.equal(pace.status, "met");
  assert.equal(pace.remaining, 0);
});

test("start of the month with nothing sent is still on track", () => {
  const pace = contractPace(4, 0, 2, 31);
  assert.equal(pace.status, "on_track");
  assert.equal(pace.remaining, 4);
});

test("two emails still owed in the last week is behind", () => {
  const pace = contractPace(4, 2, 26, 31);
  assert.equal(pace.status, "behind");
  assert.equal(pace.remaining, 2);
});

test("one email left with a week to go is on track", () => {
  const pace = contractPace(4, 3, 24, 31);
  assert.equal(pace.status, "on_track");
  assert.equal(pace.remaining, 1);
});
