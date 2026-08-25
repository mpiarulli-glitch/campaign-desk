import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// db.ts resolves its file from process.cwd() when it is first imported, so this
// suite chdirs to a throwaway directory and then imports the modules under test
// dynamically. That keeps it off the real data/campaign-desk.db. Everything
// lives inside one top-level test because tsx compiles to CJS here, where
// top-level await is unavailable.

const GOOD = "purple-tractor-Monday-4";

test("login accounts", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-users-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const users = await import("../src/lib/users");
  const { OWNER_SLUG } = await import("../src/lib/people");
  const { getDb } = await import("../src/lib/db");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await t.test("the roster is seeded and there is exactly one owner", () => {
    const all = users.listUsers();
    assert.ok(all.length >= 10, `expected the full roster, got ${all.length}`);

    const owners = all.filter((u) => u.role === "owner");
    assert.equal(owners.length, 1);
    assert.equal(owners[0].slug, OWNER_SLUG);

    // A slug in both arrays resolves to admin, not forecast.
    assert.equal(users.getUser("cassidy")?.role, "admin");
    assert.equal(users.getUser("kyle_morris")?.role, "admin");
    // A forecast-only person stays forecast.
    assert.equal(users.getUser("jack")?.role, "forecast");
    assert.equal(users.getUser("saqib")?.role, "forecast");
    assert.equal(users.getUser("jerald")?.role, "forecast");
    assert.equal(users.getUser("saqib")?.label, "Saqib");
    assert.equal(users.getUser("jerald")?.label, "Jerald");
  });

  await t.test("nobody starts with a password", () => {
    for (const u of users.listUsers()) {
      assert.equal(u.password_hash, null, `${u.slug} should start with none`);
    }
  });

  await t.test("an invite sets a password and works exactly once", () => {
    const token = users.createInvite("jack");
    assert.ok(token, "invite should be issued");
    assert.equal(users.getUserByInvite(token!)?.slug, "jack");

    assert.equal(users.acceptInvite(token!, GOOD).ok, true);

    // Consumed, so the link cannot be replayed.
    assert.equal(users.getUserByInvite(token!), null);
    assert.equal(users.acceptInvite(token!, "second-choice-phrase-9").ok, false);
    assert.equal(users.hasOwnPassword("jack"), true);
  });

  await t.test("that password authenticates and a wrong one does not", () => {
    assert.equal(users.authenticate("jack", GOOD).ok, true);

    const bad = users.authenticate("jack", "wrong-password-entirely");
    assert.equal(bad.ok, false);
    assert.equal(bad.ok === false && bad.reason, "bad_password");
  });

  await t.test("an invite cannot set a weak password", () => {
    const token = users.createInvite("paula");
    assert.equal(users.acceptInvite(token!, "short").ok, false);
    // The invite survives a rejected attempt so they can try again.
    assert.equal(users.getUserByInvite(token!)?.slug, "paula");
    assert.equal(users.hasOwnPassword("paula"), false);
  });

  await t.test("reissuing an invite kills the previous link", () => {
    const first = users.createInvite("randi");
    const second = users.createInvite("randi");
    assert.notEqual(first, second);
    assert.equal(users.getUserByInvite(first!), null);
    assert.equal(users.getUserByInvite(second!)?.slug, "randi");
  });

  await t.test("changing a password requires the current one", () => {
    const wrong = users.changePassword("jack", "not-mine", "brand-new-tractor-8");
    assert.equal(wrong.ok, false);
    // The old password still works after a failed change.
    assert.equal(users.authenticate("jack", GOOD).ok, true);

    assert.equal(users.changePassword("jack", GOOD, "brand-new-tractor-8").ok, true);
    assert.equal(users.authenticate("jack", "brand-new-tractor-8").ok, true);
    assert.equal(users.authenticate("jack", GOOD).ok, false);
  });

  await t.test("a disabled account cannot log in or use a pending invite", () => {
    const token = users.createInvite("abel");
    users.setUserActive("abel", false);

    // Deactivating clears the invite outright.
    assert.equal(users.getUserByInvite(token!), null);

    const result = users.authenticate("abel", GOOD);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "inactive");
  });

  await t.test("an unknown slug is refused", () => {
    const result = users.authenticate("not-a-real-person", GOOD);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "unknown");
  });

  await t.test("clearing a password forces someone back to an invite", () => {
    users.clearPassword("jack");
    assert.equal(users.hasOwnPassword("jack"), false);
    const result = users.authenticate("jack", "brand-new-tractor-8");
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "no_password");
  });

  await t.test("an expired invite is refused", () => {
    const token = users.createInvite("roy");
    // Backdate the expiry rather than waiting 72 hours.
    getDb()
      .prepare(`UPDATE users SET invite_expires_at = ? WHERE slug = 'roy'`)
      .run(new Date(Date.now() - 1000).toISOString());
    assert.equal(users.getUserByInvite(token!), null);
  });
});
