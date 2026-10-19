import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "path";
import {
  filterInternalReviewFollowups,
  internalReviewNotificationsEnabled,
} from "../src/lib/review-notifications";

test("the owner is not notified about pending internal reviews by default", () => {
  assert.equal(
    internalReviewNotificationsEnabled({ slug: "michael", role: "owner", stored: null }),
    false
  );
  assert.equal(
    internalReviewNotificationsEnabled({ slug: "cassidy", role: "admin", stored: null }),
    true
  );
  assert.equal(
    internalReviewNotificationsEnabled({ slug: "michael", role: "owner", stored: 1 }),
    true
  );
  assert.equal(
    internalReviewNotificationsEnabled({ slug: "cassidy", role: "admin", stored: 0 }),
    false
  );
  assert.equal(
    internalReviewNotificationsEnabled({ slug: null, stored: null }),
    false
  );
});

test("turning internal reminders off keeps client-review reminders", () => {
  const items = [
    { kind: "followup", followup_kind: "internal", id: "internal" },
    { kind: "followup", followup_kind: "external", id: "client" },
    { kind: "feedback", followup_kind: null, id: "note" },
    { kind: "approved", id: "yes" },
  ];
  const quiet = filterInternalReviewFollowups(items, false);
  assert.deepEqual(
    quiet.map((item) => item.id),
    ["client", "note", "yes"]
  );
  assert.equal(filterInternalReviewFollowups(items, true).length, 4);
});

test("a stored preference overrides the owner default", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-review-notes-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const users = await import("../src/lib/users");
  assert.equal(users.wantsInternalReviewNotifications("michael"), false);
  assert.equal(users.wantsInternalReviewNotifications("cassidy"), true);

  assert.equal(users.setInternalReviewNotifications("michael", true), true);
  assert.equal(users.wantsInternalReviewNotifications("michael"), true);
  assert.equal(users.setInternalReviewNotifications("cassidy", false), true);
  assert.equal(users.wantsInternalReviewNotifications("cassidy"), false);
});
