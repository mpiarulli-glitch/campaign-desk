import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Same shape as users.test.ts: db.ts resolves its file from process.cwd() at
// import time, so this chdirs to a throwaway directory first and imports the
// modules under test dynamically.

const STEP_MS = 30_000;

test("totp primitives", async (t) => {
  const totp = await import("../src/lib/totp");

  await t.test("base32 round trips", () => {
    const buf = Buffer.from("the quick brown fox", "utf8");
    assert.deepEqual(totp.base32Decode(totp.base32Encode(buf)), buf);
  });

  await t.test("base32 rejects rubbish", () => {
    assert.equal(totp.base32Decode("not base32!"), null);
    // 0, 1 and 8 are not in the alphabet.
    assert.equal(totp.base32Decode("ABC018"), null);
  });

  await t.test("matches the RFC 6238 SHA-1 test vectors", () => {
    // The RFC's shared secret is the ASCII "12345678901234567890".
    const secret = totp.base32Encode(Buffer.from("12345678901234567890", "utf8"));
    const vectors: Array<[number, string]> = [
      [59, "287082"],
      [1111111109, "081804"],
      [1111111111, "050471"],
      [1234567890, "005924"],
      [2000000000, "279037"],
    ];
    for (const [seconds, expected] of vectors) {
      assert.equal(
        totp.totpCodeAt(secret, seconds * 1000),
        expected,
        `t=${seconds}`
      );
    }
  });

  await t.test("accepts the current code and one step of clock drift", () => {
    const secret = totp.generateTotpSecret();
    const now = 1_700_000_000_000;
    for (const drift of [-1, 0, 1]) {
      const at = now + drift * STEP_MS;
      const code = totp.totpCodeAt(secret, at)!;
      assert.equal(totp.verifyTotp(secret, code, now).ok, true, `drift ${drift}`);
    }
  });

  await t.test("refuses a code from further out than that", () => {
    const secret = totp.generateTotpSecret();
    const now = 1_700_000_000_000;
    for (const drift of [-3, -2, 2, 3]) {
      const code = totp.totpCodeAt(secret, now + drift * STEP_MS)!;
      assert.equal(totp.verifyTotp(secret, code, now).ok, false, `drift ${drift}`);
    }
  });

  await t.test("refuses anything that is not six digits", () => {
    const secret = totp.generateTotpSecret();
    for (const bad of ["", "12345", "1234567", "abcdef", "12 34 56 78"]) {
      assert.equal(totp.verifyTotp(secret, bad).ok, false, bad);
    }
  });

  await t.test("reports which step matched, so replay can be blocked", () => {
    const secret = totp.generateTotpSecret();
    const now = 1_700_000_000_000;
    const result = totp.verifyTotp(secret, totp.totpCodeAt(secret, now)!, now);
    assert.equal(result.ok, true);
    assert.equal(
      result.ok && result.counter,
      Math.floor(now / 1000 / totp.TOTP_STEP_SECONDS)
    );
  });

  await t.test("backup codes are unique and consumed one at a time", () => {
    const codes = totp.generateBackupCodes();
    assert.equal(codes.length, totp.BACKUP_CODE_COUNT);
    assert.equal(new Set(codes).size, codes.length);

    const hashes = codes.map(totp.hashBackupCode);
    const after = totp.consumeBackupCodeHash(hashes, codes[3]);
    assert.ok(after);
    assert.equal(after!.length, hashes.length - 1);
    // The same code cannot be spent twice.
    assert.equal(totp.consumeBackupCodeHash(after!, codes[3]), null);
    // Formatting and case do not matter.
    assert.ok(totp.consumeBackupCodeHash(hashes, codes[0].toLowerCase()));
    assert.ok(totp.consumeBackupCodeHash(hashes, codes[0].replace("-", " ")));
    assert.equal(totp.consumeBackupCodeHash(hashes, "ZZZZZ-ZZZZZ"), null);
  });

  await t.test("the otpauth uri carries what an app needs", () => {
    const secret = totp.generateTotpSecret();
    const url = new URL(totp.otpauthUrl("jack@example.com", secret));
    assert.equal(url.protocol, "otpauth:");
    assert.equal(url.searchParams.get("secret"), secret);
    assert.equal(url.searchParams.get("digits"), "6");
    assert.equal(url.searchParams.get("period"), "30");
    assert.equal(url.searchParams.get("issuer"), "Campaign Desk");
  });
});

test("two-factor on an account", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-totp-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const users = await import("../src/lib/users");
  const totp = await import("../src/lib/totp");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const slug = "jack";

  await t.test("starts off", () => {
    assert.equal(users.totpEnabled(slug), false);
  });

  await t.test("a started enrollment does not switch it on", () => {
    const secret = users.beginTotpEnrollment(slug);
    assert.ok(secret);
    assert.equal(users.totpEnabled(slug), false);
    // The pending secret survives a page reload.
    assert.equal(users.pendingTotpSecret(slug), secret);
  });

  await t.test("a wrong code leaves it off", () => {
    const result = users.confirmTotpEnrollment(slug, "000000");
    assert.equal(result.ok, false);
    assert.equal(users.totpEnabled(slug), false);
  });

  let backupCodes: string[] = [];

  await t.test("the right code switches it on and hands over backup codes", () => {
    const secret = users.pendingTotpSecret(slug)!;
    const result = users.confirmTotpEnrollment(slug, totp.totpCodeAt(secret, Date.now())!);
    assert.equal(result.ok, true);
    backupCodes = result.ok ? result.backupCodes : [];
    assert.equal(backupCodes.length, totp.BACKUP_CODE_COUNT);
    assert.equal(users.totpEnabled(slug), true);
    // The pending slot is emptied once it is live.
    assert.equal(users.pendingTotpSecret(slug), null);
  });

  await t.test("the secret is not stored in the clear", () => {
    const row = users.getUser(slug)!;
    assert.ok(row.totp_secret);
    assert.ok(row.totp_secret!.startsWith("v1."));
  });

  await t.test("a code cannot be used twice", () => {
    // Enroll a fresh account so this test owns its own counter.
    const secret = users.beginTotpEnrollment("abel")!;
    users.confirmTotpEnrollment("abel", totp.totpCodeAt(secret, Date.now())!);

    // The code that confirmed enrollment is already spent.
    const replay = users.verifyTotpForLogin("abel", totp.totpCodeAt(secret, Date.now())!);
    assert.equal(replay.ok, false);
    assert.match(
      replay.ok ? "" : replay.error,
      /already been used/,
      "should say the code is spent, not that it is wrong"
    );
  });

  await t.test("backup codes sign in once each", () => {
    const first = users.verifyTotpForLogin(slug, backupCodes[0]);
    assert.equal(first.ok, true);
    assert.equal(first.ok && first.usedBackupCode, true);
    assert.equal(users.backupCodesRemaining(slug), totp.BACKUP_CODE_COUNT - 1);

    const again = users.verifyTotpForLogin(slug, backupCodes[0]);
    assert.equal(again.ok, false);
  });

  await t.test("regenerating replaces the whole set", () => {
    const fresh = users.regenerateBackupCodes(slug);
    assert.ok(fresh);
    assert.equal(users.backupCodesRemaining(slug), totp.BACKUP_CODE_COUNT);
    // An old one no longer works.
    assert.equal(users.verifyTotpForLogin(slug, backupCodes[1]).ok, false);
    assert.equal(users.verifyTotpForLogin(slug, fresh![0]).ok, true);
  });

  await t.test("disabling wipes everything and reopens setup", () => {
    users.markSetupComplete(slug);
    assert.ok(users.setupCompletedAt(slug));

    users.disableTotp(slug);
    assert.equal(users.totpEnabled(slug), false);
    assert.equal(users.backupCodesRemaining(slug), 0);
    assert.equal(users.setupCompletedAt(slug), null);
    assert.equal(users.getUser(slug)!.totp_secret, null);
  });

  await t.test("verifying against an account with no 2FA fails cleanly", () => {
    const result = users.verifyTotpForLogin(slug, "123456");
    assert.equal(result.ok, false);
  });
});
