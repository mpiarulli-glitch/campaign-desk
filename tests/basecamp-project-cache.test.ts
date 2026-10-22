import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.SESSION_SECRET = "test-secret-for-project-cache";
process.env.BASECAMP_CLIENT_ID = "test-client";
process.env.BASECAMP_CLIENT_SECRET = "test-secret";
process.env.BASECAMP_ACCOUNT_ID = "999";

test("Basecamp project lists are cached and paged together", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-project-cache-"));
  const originalCwd = process.cwd();
  const realFetch = globalThis.fetch;
  process.chdir(tmp);

  const { getDb, nowIso } = await import("../src/lib/db");
  const basecamp = await import("../src/lib/basecamp");

  t.after(() => {
    globalThis.fetch = realFetch;
    basecamp.clearBasecampProjectCache();
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('basecamp_tokens', ?, ?)`
    )
    .run(
      JSON.stringify({
        access_token: "MASCOT-TOKEN",
        refresh_token: "mascot-refresh",
        expires_at: Date.now() + 3_600_000,
      }),
      nowIso()
    );

  const calls: Array<{ page: number; at: number }> = [];
  const PAGE_MS = 40;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get("page") || "1");
    calls.push({ page, at: performance.now() });
    await new Promise((resolve) => setTimeout(resolve, PAGE_MS));
    const full = page <= 7;
    const body = full
      ? Array.from({ length: 15 }, (_, i) => ({ id: page * 100 + i, name: `P${page}-${i}` }))
      : page === 8
        ? [{ id: 800, name: "Last" }]
        : [];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const started = performance.now();
  const projects = await basecamp.listProjects();
  const cold = performance.now() - started;
  assert.equal(projects.length, 7 * 15 + 1);
  assert.equal(projects[projects.length - 1].name, "Last");
  // Page 1, then the next eight pages in one wave. The short page stops the list
  // before the empty page is included, but that request is already in flight.
  assert.equal(calls.length, 9);

  const first = calls.find((call) => call.page === 1)!;
  const later = calls.filter((call) => call.page > 1);
  const laterSpread = Math.max(...later.map((call) => call.at)) - Math.min(...later.map((call) => call.at));
  assert.ok(later.every((call) => call.at >= first.at + PAGE_MS - 5));
  assert.ok(laterSpread < PAGE_MS, `later pages should share a round trip, spread ${laterSpread.toFixed(0)}ms`);
  // Eight sequential pages would be about 8 * PAGE_MS. Two waves land well under that.
  assert.ok(cold < PAGE_MS * 4, `cold list took ${cold.toFixed(0)}ms`);

  const before = calls.length;
  const warmStarted = performance.now();
  const again = await basecamp.listProjects();
  const warm = performance.now() - warmStarted;
  assert.equal(again.length, projects.length);
  assert.equal(calls.length, before);
  assert.ok(warm < 20, `warm list took ${warm.toFixed(1)}ms`);

  await basecamp.listProjects(undefined, { fresh: true });
  assert.equal(calls.length, before + 9);
});
