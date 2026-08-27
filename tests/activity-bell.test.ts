import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "path";
import {
  activityItemKey,
  relativeActivityTime,
} from "../src/lib/activity-read";

test("the app shell has an activity bell in the top bar", () => {
  const shell = fs.readFileSync(
    path.join("src/components/AppShell.tsx"),
    "utf8"
  );
  const bell = fs.readFileSync(
    path.join("src/components/ActivityBell.tsx"),
    "utf8"
  );
  const css = fs.readFileSync(path.join("src/app/globals.css"), "utf8");

  assert.match(shell, /from ["']\.\/ActivityBell["']/);
  assert.match(shell, /session\.role === "admin" \? <ActivityBell \/> : null/);
  assert.match(bell, /\/api\/activity/);
  assert.match(bell, /className="app-notif"/);
  assert.match(bell, /View all activity/);
  assert.match(bell, /Mark all read/);
  assert.match(css, /\.app-bell-badge/);
  assert.match(css, /\.app-notif-item/);
});

test("activity item keys and relative time stay stable for the bell", () => {
  assert.equal(
    activityItemKey({ kind: "feedback", id: "c1" }),
    "feedback-c1"
  );
  assert.equal(
    activityItemKey({ kind: "approved", id: "camp-9" }),
    "approved-camp-9"
  );
  assert.equal(relativeActivityTime(new Date().toISOString()), "just now");
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  assert.equal(relativeActivityTime(hourAgo), "1h ago");
});
