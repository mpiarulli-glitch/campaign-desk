import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.SESSION_SECRET = "test-secret-for-project-cache";
process.env.BASECAMP_CLIENT_ID = "test-client";
process.env.BASECAMP_CLIENT_SECRET = "test-secret";
process.env.BASECAMP_ACCOUNT_ID = "999";

// Basecamp's geared pagination is 15, then 30, then 50, then 100, and the next
// page is whatever the Link header says. A page shorter than 15 is not the end
// when that header still has rel="next". Guessing ?page=2 and stopping on a
// short body is what cut the account list off at 51 (15 + 30 + a short third
// page) and then cached that as the whole catalog.

test("Basecamp project lists follow Link and keep every page", async (t) => {
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

  const base = "https://3.basecampapi.com/999";
  const calls: string[] = [];

  function pageBody(count: number, start: number, name: (i: number) => string) {
    return Array.from({ length: count }, (_, i) => ({
      id: start + i,
      name: name(i),
    }));
  }

  // 15 + 30 + 50 + 20 = 115. The third page is the one a "< 15 means done"
  // walker would have to get past, and the next URL is not ?page=N. A guessed
  // ?page=2 returns a short body with no Link, which is the old stop.
  const chain: Record<string, { count: number; start: number; next: string | null; label: string }> = {
    "/projects.json": { count: 15, start: 1000, next: "/projects.json?page=cursor-2", label: "p1" },
    "/projects.json?page=cursor-2": { count: 30, start: 2000, next: "/projects.json?page=cursor-3", label: "p2" },
    "/projects.json?page=cursor-3": { count: 10, start: 3000, next: "/projects.json?page=cursor-4", label: "p3" },
    "/projects.json?page=cursor-4": { count: 60, start: 4000, next: null, label: "p4" },
  };
  const expected = 15 + 30 + 10 + 60;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const rel = url.pathname.replace(`/999`, "") + url.search;
    calls.push(rel);
    if (rel === "/projects.json?page=2") {
      return new Response(JSON.stringify([{ id: 2, name: "Guessed short page" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const spec = chain[rel];
    if (!spec) {
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const body = pageBody(spec.count, spec.start, (i) =>
      spec.label === "p4" && i === spec.count - 1 ? "NORLO Peptides" : `${spec.label}-${i}`
    );
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (spec.next) headers.Link = `<${base}${spec.next}>; rel="next"`;
    return new Response(JSON.stringify(body), { status: 200, headers });
  }) as typeof fetch;

  const projects = await basecamp.listProjects();
  assert.equal(projects.length, expected);
  assert.equal(projects[projects.length - 1].name, "NORLO Peptides");
  assert.equal(projects[projects.length - 1].id, 4000 + 60 - 1);
  assert.deepEqual(calls, [
    "/projects.json",
    "/projects.json?page=cursor-2",
    "/projects.json?page=cursor-3",
    "/projects.json?page=cursor-4",
  ]);

  const before = calls.length;
  const again = await basecamp.listProjects();
  assert.equal(again.length, projects.length);
  assert.equal(calls.length, before, "a fresh cache must not page Basecamp again");

  await basecamp.listProjects(undefined, { fresh: true });
  assert.equal(calls.length, before + 4);

  // A failed later page is not stored. The next call walks Basecamp again.
  basecamp.clearBasecampProjectCache();
  getDb().prepare(`DELETE FROM app_settings WHERE key LIKE 'basecamp_project_list%'`).run();
  calls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const rel = url.pathname.replace(`/999`, "") + url.search;
    calls.push(rel);
    if (rel === "/projects.json") {
      const body = pageBody(15, 1000, (i) => `only-${i}`);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          Link: `<${base}/projects.json?page=cursor-2>; rel="next"`,
        },
      });
    }
    return new Response("nope", { status: 500 });
  }) as typeof fetch;

  await assert.rejects(() => basecamp.listProjects(), /cut short/);
  const stored = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM app_settings WHERE key LIKE 'basecamp_project_list%'`)
    .get() as { n: number };
  assert.equal(stored.n, 0);

  calls.length = 0;
  globalThis.fetch = (async () => {
    calls.push("retry");
    return new Response(JSON.stringify([{ id: 7, name: "After failure" }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  const retried = await basecamp.listProjects();
  assert.deepEqual(
    retried.map((p) => p.name),
    ["After failure"]
  );
  assert.equal(calls.length, 1);
});
