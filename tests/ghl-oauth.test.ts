import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_GHL_REDIRECT_URI,
  GHL_OAUTH_SCOPES,
  completeGhlConnect,
  ghlAuthorizeUrl,
  ghlRedirectUri,
  handleGhlCallback,
  makeGhlState,
  readGhlState,
} from "../src/lib/ghl-oauth";

const ENV_KEYS = [
  "GHL_CLIENT_ID",
  "GHL_CLIENT_SECRET",
  "GHL_COMPANY_ID",
  "GHL_REDIRECT_URI",
  "GHL_REFRESH_TOKEN",
  "GHL_AGENCY_ACCESS_TOKEN",
  "SESSION_SECRET",
] as const;

test("agency connect replaces a dead ghl_tokens row and the callback says so", async (t) => {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const originalCwd = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-ghl-oauth-"));
  const logs: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const capture = (...args: unknown[]) => {
    logs.push(args.map((item) => String(item)).join(" "));
  };

  process.env.GHL_CLIENT_ID = "client-id";
  process.env.GHL_CLIENT_SECRET = "client-secret-value";
  process.env.GHL_COMPANY_ID = "company-1";
  process.env.SESSION_SECRET = "test-session-secret";
  delete process.env.GHL_REDIRECT_URI;
  delete process.env.GHL_REFRESH_TOKEN;
  delete process.env.GHL_AGENCY_ACCESS_TOKEN;
  console.log = capture;
  console.error = capture;
  console.info = capture;
  console.warn = capture;

  process.chdir(tmp);
  const { closeDbForTests, getDb, nowIso } = await import("../src/lib/db");
  const { clearGhlCache, ghlConnectionStatus, getAgencyToken } = await import("../src/lib/ghl");
  closeDbForTests();
  clearGhlCache();

  t.after(() => {
    console.log = originalLog;
    console.error = originalError;
    console.info = originalInfo;
    console.warn = originalWarn;
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    closeDbForTests();
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  assert.equal(ghlRedirectUri(), DEFAULT_GHL_REDIRECT_URI);
  process.env.GHL_REDIRECT_URI = "http://localhost:8889/callback";
  assert.equal(ghlRedirectUri(), DEFAULT_GHL_REDIRECT_URI);
  delete process.env.GHL_REDIRECT_URI;
  const state = makeGhlState("michael");
  assert.deepEqual(readGhlState(state), { person: "michael" });
  assert.equal(readGhlState(`${state}x`), null);
  const authorize = new URL(ghlAuthorizeUrl("michael"));
  assert.equal(authorize.origin + authorize.pathname, "https://marketplace.gohighlevel.com/v2/oauth/chooselocation");
  assert.equal(authorize.searchParams.get("response_type"), "code");
  assert.equal(authorize.searchParams.get("redirect_uri"), DEFAULT_GHL_REDIRECT_URI);
  assert.equal(authorize.searchParams.get("client_id"), "client-id");
  const scopes = authorize.searchParams.get("scope") || "";
  for (const scope of ["locations.readonly", "oauth.write", "conversations/message.write", "phonenumbers.read", "workflows.readonly"]) {
    assert.ok(scopes.includes(scope), scope);
  }
  assert.equal(scopes.split(" ").length, GHL_OAUTH_SCOPES.length);
  assert.ok(readGhlState(authorize.searchParams.get("state") || ""));

  process.env.GHL_REDIRECT_URI = "https://hub.marketingempiregroup.com/api/ghl/callback";
  assert.equal(ghlRedirectUri(), "https://hub.marketingempiregroup.com/api/ghl/callback");

  const access = "access-new-value";
  const refresh = "refresh-new-value";
  let tokenCalls = 0;
  const fetchImpl: typeof fetch = async (url, init) => {
    tokenCalls += 1;
    const body = String(init?.body || "");
    assert.equal(String(url), "https://services.leadconnectorhq.com/oauth/token");
    assert.match(body, /grant_type=authorization_code/);
    assert.match(body, /user_type=Company/);
    assert.match(body, /redirect_uri=https%3A%2F%2Fhub\.marketingempiregroup\.com%2Fapi%2Fghl%2Fcallback/);
    assert.equal(body.includes(refresh), false);
    return new Response(
      JSON.stringify({
        access_token: access,
        refresh_token: refresh,
        expires_in: 3600,
        userType: "Company",
        companyId: "company-1",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('ghl_tokens', ?, ?)`
    )
    .run(
      JSON.stringify({
        access_token: "dead-access",
        refresh_token: "dead-refresh",
        expires_at: 1,
      }),
      nowIso()
    );
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('ghl_auth_error', ?, ?)`
    )
    .run("GoHighLevel refused the refresh token (400).", nowIso());

  const denied = await handleGhlCallback({
    isAdmin: false,
    person: null,
    code: "auth-code",
    state,
    error: null,
    errorDescription: null,
    fetchImpl,
  });
  assert.equal(denied.status, 401);
  assert.match(denied.html, /Sign in as an admin/);
  assert.equal(tokenCalls, 0);

  const mismatched = await handleGhlCallback({
    isAdmin: true,
    person: "michael",
    code: "auth-code",
    state: makeGhlState("cassidy"),
    error: null,
    errorDescription: null,
    fetchImpl,
  });
  assert.equal(mismatched.status, 400);
  assert.match(mismatched.html, /did not match this login/);
  assert.equal(tokenCalls, 0);

  const injected = await handleGhlCallback({
    isAdmin: true,
    person: "michael",
    code: null,
    state: makeGhlState("michael"),
    error: "access_denied",
    errorDescription: `<script>alert("x")</script> refresh_token=should-not-show`,
    fetchImpl,
  });
  assert.equal(injected.status, 400);
  assert.equal(injected.html.includes("<script>"), false);
  assert.equal(injected.html.includes("should-not-show"), false);
  assert.match(injected.html, /was not connected/);

  const connected = await handleGhlCallback({
    isAdmin: true,
    person: "michael",
    code: "auth-code",
    state: makeGhlState("michael"),
    error: null,
    errorDescription: null,
    fetchImpl,
  });
  assert.equal(connected.status, 200);
  assert.match(connected.html, /GoHighLevel is connected/);
  assert.match(connected.html, /Back to Productions/);
  assert.equal(connected.html.includes(access), false);
  assert.equal(connected.html.includes(refresh), false);
  assert.equal(connected.html.includes("client-secret-value"), false);
  assert.equal(tokenCalls, 1);

  const row = getDb()
    .prepare(`SELECT value FROM app_settings WHERE key = 'ghl_tokens'`)
    .get() as { value: string };
  const stored = JSON.parse(row.value) as Record<string, unknown>;
  assert.deepEqual(Object.keys(stored).sort(), ["access_token", "expires_at", "refresh_token"]);
  assert.equal(stored.access_token, access);
  assert.equal(stored.refresh_token, refresh);
  assert.equal(row.value.includes("dead-refresh"), false);
  assert.ok(Number(stored.expires_at) > Date.now());
  const status = ghlConnectionStatus();
  assert.equal(status.connected, true);
  assert.equal(status.lastError, "");

  const leakBody = JSON.stringify({
    error: "invalid_grant",
    error_description: "Integration is not valid or has been removed",
    access_token: "leaked-access",
    refresh_token: "leaked-refresh",
  });
  const leaked = await completeGhlConnect("another-code", ghlRedirectUri(), async () => {
    return new Response(leakBody, { status: 400 });
  });
  assert.equal(leaked.ok, false);
  if (!leaked.ok) {
    assert.match(leaked.error, /invalid_grant/);
    assert.equal(leaked.error.includes("leaked-access"), false);
    assert.equal(leaked.error.includes("leaked-refresh"), false);
  }
  const still = JSON.parse(
    (getDb().prepare(`SELECT value FROM app_settings WHERE key = 'ghl_tokens'`).get() as { value: string }).value
  ) as { refresh_token: string };
  assert.equal(still.refresh_token, refresh);

  const locationInstall = await completeGhlConnect("location-code", ghlRedirectUri(), async () => {
    return new Response(
      JSON.stringify({
        access_token: "location-access",
        refresh_token: "location-refresh",
        expires_in: 3600,
        userType: "Location",
        companyId: "company-1",
      }),
      { status: 200 }
    );
  });
  assert.equal(locationInstall.ok, false);
  const afterLocation = JSON.parse(
    (getDb().prepare(`SELECT value FROM app_settings WHERE key = 'ghl_tokens'`).get() as { value: string }).value
  ) as { refresh_token: string };
  assert.equal(afterLocation.refresh_token, refresh);

  clearGhlCache();
  getDb()
    .prepare(`UPDATE app_settings SET value = ? WHERE key = 'ghl_tokens'`)
    .run(JSON.stringify({ access_token: "dead-access", refresh_token: "dead-refresh", expires_at: 1 }));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: "invalid_grant",
        error_description: "Integration is not valid or has been removed",
        refresh_token: "should-not-store",
      }),
      { status: 400 }
    );
  try {
    await getAgencyToken();
    assert.fail("refresh should have been refused");
  } catch (err) {
    assert.match((err as Error).message, /refused the refresh token/);
    assert.equal((err as Error).message.includes("should-not-store"), false);
  } finally {
    globalThis.fetch = realFetch;
  }
  const broken = ghlConnectionStatus();
  assert.equal(broken.connected, false);
  assert.match(broken.lastError, /invalid_grant/);
  assert.equal(broken.lastError.includes("should-not-store"), false);
  assert.equal(logs.join("\n").includes(access), false);
  assert.equal(logs.join("\n").includes(refresh), false);
  assert.equal(logs.join("\n").includes("client-secret-value"), false);
  assert.equal(logs.join("\n").includes("should-not-store"), false);
});
