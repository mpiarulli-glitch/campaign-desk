import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-secret-for-token-encryption";

test("token encryption at rest", async () => {
  const { encryptSecret, decryptSecret } = await import("../src/lib/secrets");

  const token = "BAhbB0kiAbB7ImNsaWVudF9pZCI6";
  const a = encryptSecret(token);
  assert.equal(decryptSecret(a), token);

  // Nonce per encryption, so the same token never produces the same ciphertext.
  assert.notEqual(a, encryptSecret(token));
  // Nothing resembling the plaintext survives.
  assert.ok(!a.includes(token.slice(0, 12)));

  // Malformed input returns null instead of throwing, because a token that
  // cannot be read has to mean "reconnect", not "crash the request".
  assert.equal(decryptSecret(null), null);
  assert.equal(decryptSecret(""), null);
  assert.equal(decryptSecret("garbage"), null);
  assert.equal(decryptSecret("v1.a.b.c"), null);
  assert.equal(decryptSecret("v2." + a.split(".").slice(1).join(".")), null);

  // Tampering with the ciphertext fails the auth tag rather than decrypting to
  // something wrong. That is the reason for GCM over plain CBC.
  const parts = a.split(".");
  const flipped = Buffer.from(parts[3], "base64url");
  flipped[0] ^= 0xff;
  const tampered = [parts[0], parts[1], parts[2], flipped.toString("base64url")].join(".");
  assert.equal(decryptSecret(tampered), null);
});

test("OAuth state binds a code to the person who started the flow", async () => {
  const { makeState, readState } = await import("../src/lib/basecamp-oauth");

  const state = makeState("jack");
  assert.deepEqual(readState(state), { person: "jack" });

  // Rewriting the person invalidates the signature, which is the whole point:
  // otherwise a returning code could be redeemed into somebody else's account.
  const forged = ["michael", ...state.split(".").slice(1)].join(".");
  assert.equal(readState(forged), null);

  // A tampered signature is refused.
  const parts = state.split(".");
  assert.equal(readState([...parts.slice(0, 3), "deadbeef"].join(".")), null);

  // Shape checks.
  assert.equal(readState(""), null);
  assert.equal(readState("a.b.c"), null);
  assert.equal(readState("a.b.c.d.e"), null);

  // An old state is refused. 31 minutes against a 30 minute window.
  const stale = `jack.abc.${Date.now() - 31 * 60 * 1000}`;
  const { createHmac } = await import("crypto");
  const sig = createHmac("sha256", process.env.SESSION_SECRET!).update(stale).digest("hex");
  assert.equal(readState(`${stale}.${sig}`), null);
});

test("per-person connections", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-bcid-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const id = await import("../src/lib/basecamp-identity");
  const { getDb } = await import("../src/lib/db");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await t.test("saving a connection stores ciphertext, not the token", () => {
    id.saveConnection({
      person: "jack",
      bcPersonId: 44903667,
      bcName: "Jack Smith",
      bcEmail: "jack@example.com",
      accessToken: "access-plaintext-token",
      refreshToken: "refresh-plaintext-token",
      expiresIn: 1209600,
    });
    const row = getDb()
      .prepare(`SELECT access_token, refresh_token FROM basecamp_connections WHERE person = 'jack'`)
      .get() as { access_token: string; refresh_token: string };
    assert.ok(!row.access_token.includes("access-plaintext-token"));
    assert.ok(!row.refresh_token.includes("refresh-plaintext-token"));
    assert.ok(row.access_token.startsWith("v1."));
  });

  await t.test("a live connection reads back and reports as connected", async () => {
    assert.equal(id.hasConnection("jack"), true);
    assert.equal(await id.personAccessToken("jack"), "access-plaintext-token");
    const conn = id.getConnection("jack")!;
    assert.equal(conn.bc_person_id, 44903667);
    assert.equal(conn.bc_name, "Jack Smith");
    assert.equal(conn.last_error, null);
  });

  await t.test("somebody with no row is not connected", async () => {
    assert.equal(id.hasConnection("paula"), false);
    assert.equal(id.hasConnection(null), false);
    assert.equal(await id.personAccessToken("paula"), null);
  });

  await t.test("a row whose tokens cannot be decrypted is not a connection", () => {
    // What a changed SESSION_SECRET looks like from here.
    getDb()
      .prepare(`UPDATE basecamp_connections SET access_token = 'v1.aa.bb.cc' WHERE person = 'jack'`)
      .run();
    assert.equal(
      id.hasConnection("jack"),
      false,
      "an unreadable token must read as disconnected, not as connected"
    );
  });

  await t.test("disconnecting removes the row entirely", () => {
    id.saveConnection({
      person: "paula", bcPersonId: 7, bcName: "Paula", bcEmail: "p@example.com",
      accessToken: "a", refreshToken: "r",
    });
    assert.equal(id.hasConnection("paula"), true);
    id.disconnectPerson("paula");
    assert.equal(id.getConnection("paula"), null);
    assert.equal(id.hasConnection("paula"), false);
  });

  await t.test("reconnecting replaces the tokens and clears the error", () => {
    getDb()
      .prepare(`UPDATE basecamp_connections SET last_error = 'expired' WHERE person = 'jack'`)
      .run();
    id.saveConnection({
      person: "jack", bcPersonId: 44903667, bcName: "Jack Smith",
      bcEmail: "jack@example.com", accessToken: "second-token", refreshToken: "second-refresh",
    });
    const conn = id.getConnection("jack")!;
    assert.equal(conn.last_error, null);
    assert.equal(id.hasConnection("jack"), true);
  });

  await t.test("identity keys distinguish the service from each person", () => {
    assert.equal(id.identityKey(id.SERVICE), "service");
    assert.equal(id.identityKey(id.asPerson("jack")), "person:jack");
    assert.notEqual(id.identityKey(id.asPerson("jack")), id.identityKey(id.asPerson("paula")));
  });

  await t.test("listConnections reports everyone who has connected", () => {
    id.saveConnection({
      person: "randi", bcPersonId: 9, bcName: "Randi", bcEmail: "r@example.com",
      accessToken: "a", refreshToken: "r",
    });
    const slugs = id.listConnections().map((c) => c.person).sort();
    assert.deepEqual(slugs, ["jack", "randi"]);
  });
});
