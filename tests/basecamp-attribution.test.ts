import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Which Basecamp login each call goes out on.
//
// The rule this pins down: a person's own connection is used for anything they
// did, the shared service account covers work with no human behind it, and one
// team member's token is never used to act for another. The interesting part is
// not the happy path but the fallbacks, so these tests intercept fetch and
// assert on the bearer token that actually went over the wire.

process.env.SESSION_SECRET = "test-secret-for-attribution";
process.env.BASECAMP_CLIENT_ID = "test-client";
process.env.BASECAMP_CLIENT_SECRET = "test-secret";
process.env.BASECAMP_ACCOUNT_ID = "999";

test("basecamp attribution", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-attr-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const identity = await import("../src/lib/basecamp-identity");
  const basecamp = await import("../src/lib/basecamp");
  const { getDb, nowIso } = await import("../src/lib/db");

  const realFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // Every bearer token seen since the last reset.
  let seen: string[] = [];
  function stubFetch(body: unknown = []) {
    seen = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push((headers.get("Authorization") || "").replace("Bearer ", ""));
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
  }

  // A stored service connection, standing in for the mascot account.
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(
      "basecamp_tokens",
      JSON.stringify({
        access_token: "MASCOT-TOKEN",
        refresh_token: "mascot-refresh",
        expires_at: Date.now() + 3600_000,
      }),
      nowIso()
    );

  identity.saveConnection({
    person: "jack",
    bcPersonId: 111,
    bcName: "Jack Smith",
    bcEmail: "jack@example.com",
    accessToken: "JACK-TOKEN",
    refreshToken: "jack-refresh",
    expiresIn: 3600,
  });

  await t.test("a person's read uses their own token, not the mascot's", async () => {
    stubFetch([]);
    await basecamp.listProjects(basecamp.asPerson("jack"));
    assert.ok(seen.length > 0, "expected at least one request");
    assert.ok(!seen.includes("MASCOT-TOKEN"), "must not borrow the mascot token");
    assert.ok(
      seen.every((tok) => tok === "JACK-TOKEN"),
      `every call should be Jack's, saw ${JSON.stringify(seen)}`
    );
  });

  await t.test("system work uses the mascot account", async () => {
    stubFetch([]);
    await basecamp.listProjects();
    assert.ok(seen.every((tok) => tok === "MASCOT-TOKEN"), JSON.stringify(seen));
  });

  await t.test("the todo picker reads entirely as the person", async () => {
    // A project payload with no todoset short-circuits after one call, which is
    // all this needs: the point is whose token made it.
    stubFetch({ dock: [] });
    await basecamp.listPersonProjectTodos("123", ["Jack Smith"], {
      bcPersonId: 111,
      identity: basecamp.asPerson("jack"),
    });
    assert.ok(seen.length > 0);
    assert.ok(
      seen.every((tok) => tok === "JACK-TOKEN"),
      `no call may fall back to the mascot, saw ${JSON.stringify(seen)}`
    );
  });

  await t.test("an unconnected person is refused, never silently swapped", async () => {
    stubFetch([]);
    await assert.rejects(
      () => basecamp.listProjects(basecamp.asPerson("randi")),
      (err: Error) => err.name === "BasecampNotConnectedError",
      "should refuse rather than borrow another token"
    );
    assert.equal(seen.length, 0, "nothing should have been sent");
  });

  await t.test("hasConnection is about a usable token, not a row", () => {
    assert.equal(basecamp.hasConnection("jack"), true);
    assert.equal(basecamp.hasConnection("randi"), false);
    assert.equal(basecamp.hasConnection(null), false);
  });

  await t.test("the approval card posts as the sender when they are connected", async () => {
    stubFetch({ dock: [] });
    await basecamp.sendApprovalToDeliverables({
      projectId: "123",
      campaignTitle: "Test",
      buildContent: () => "<p>hi</p>",
      recipientIdentifiers: ["client@example.com"],
      identity: basecamp.asPerson("jack"),
    });
    assert.ok(seen.length > 0);
    assert.ok(seen.every((tok) => tok === "JACK-TOKEN"), JSON.stringify(seen));
  });

  await t.test("the approval card falls back to the mascot, not to a person", async () => {
    stubFetch({ dock: [] });
    await basecamp.sendApprovalToDeliverables({
      projectId: "123",
      campaignTitle: "Test",
      buildContent: () => "<p>hi</p>",
      recipientIdentifiers: ["client@example.com"],
    });
    assert.ok(seen.length > 0);
    assert.ok(!seen.includes("JACK-TOKEN"), "must not post as a team member");
    assert.ok(seen.every((tok) => tok === "MASCOT-TOKEN"), JSON.stringify(seen));
  });

  await t.test("disconnecting one person leaves everybody else alone", () => {
    identity.saveConnection({
      person: "randi",
      bcPersonId: 222,
      bcName: "Randi",
      bcEmail: "randi@example.com",
      accessToken: "RANDI-TOKEN",
      refreshToken: "randi-refresh",
      expiresIn: 3600,
    });
    assert.equal(basecamp.hasConnection("randi"), true);

    identity.disconnectPerson("randi");
    assert.equal(basecamp.hasConnection("randi"), false);
    assert.equal(basecamp.hasConnection("jack"), true, "Jack must be untouched");
  });
});
