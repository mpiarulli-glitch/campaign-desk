import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  activitiesFromRecordings,
  isCompletedCard,
  isDoneColumn,
  recordingCompletedAt,
  recordingOlderThanWeek,
  type BcRecording,
} from "../src/lib/snapshot-basecamp-recordings";

const WEEK = "2026-11-02";

test("card completion and the week cutoff", () => {
  assert.equal(isDoneColumn({ type: "Kanban::DoneColumn", title: "Done" }), true);
  assert.equal(isDoneColumn({ type: "Kanban::Column", title: "Done" }), true);
  assert.equal(isDoneColumn({ type: "Kanban::Column", title: "Completed" }), true);
  assert.equal(isDoneColumn({ type: "Kanban::Column", title: "Done — SEO" }), true);
  assert.equal(isDoneColumn({ type: "Kanban::Column", title: "Triage" }), false);
  assert.equal(isDoneColumn({ type: "Kanban::Column", title: "Not done" }), false);

  const doneColumn: BcRecording = {
    id: 88001,
    title: "Update the website hero",
    completed: false,
    updated_at: "2026-11-04T18:00:00Z",
    parent: { title: "Done", type: "Kanban::DoneColumn" },
  };
  const marked: BcRecording = {
    id: 88002,
    title: "Ship the footer",
    completed: true,
    updated_at: "2026-11-04T18:00:00Z",
    parent: { title: "Review", type: "Kanban::Column" },
  };
  const triage: BcRecording = {
    id: 88003,
    title: "Draft the homepage",
    completed: false,
    updated_at: "2026-11-05T12:00:00Z",
    parent: { title: "Triage", type: "Kanban::Column" },
  };
  const commentedLater: BcRecording = {
    id: 88004,
    title: "Film the testimonial",
    completed: true,
    updated_at: "2026-11-04T16:00:00Z",
    completion: { created_at: "2026-10-15T12:00:00Z" },
    parent: { title: "Done", type: "Kanban::DoneColumn" },
  };

  assert.equal(isCompletedCard(doneColumn), true);
  assert.equal(isCompletedCard(marked), true);
  assert.equal(isCompletedCard(triage), false);
  assert.equal(isCompletedCard(commentedLater), true);
  assert.equal(recordingCompletedAt(doneColumn), "2026-11-04T18:00:00Z");
  assert.equal(recordingCompletedAt(commentedLater), "2026-10-15T12:00:00Z");

  const activities = activitiesFromRecordings(
    [doneColumn, marked, triage, commentedLater],
    "card"
  );
  assert.deepEqual(
    activities.map((row) => row.sourceKey),
    ["card:88001", "card:88002", "card:88004"]
  );
  assert.equal(activities[0].place, "Done");
  assert.equal(activities[0].completedAt, "2026-11-04T18:00:00Z");

  assert.equal(recordingOlderThanWeek("2026-11-03T20:02:54Z", WEEK), false);
  assert.equal(recordingOlderThanWeek("2026-11-02T07:59:59Z", WEEK), true);
  assert.equal(recordingOlderThanWeek("2026-10-20T12:00:00Z", WEEK), true);
  assert.equal(recordingOlderThanWeek("", WEEK), false);
});

test("suggestion loading reports status and does not cache a failed read", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-snap-suggest-"));
  const originalCwd = process.cwd();
  const realFetch = globalThis.fetch;
  const realError = console.error;
  const previousEnv = {
    id: process.env.BASECAMP_CLIENT_ID,
    secret: process.env.BASECAMP_CLIENT_SECRET,
    account: process.env.BASECAMP_ACCOUNT_ID,
  };
  process.env.BASECAMP_CLIENT_ID = "test-client";
  process.env.BASECAMP_CLIENT_SECRET = "test-secret";
  process.env.BASECAMP_ACCOUNT_ID = "999";
  process.chdir(tmp);

  const { closeDbForTests, getDb, nowIso } = await import("../src/lib/db");
  closeDbForTests();
  const revenue = await import("../src/lib/revenue");
  const suggest = await import("../src/lib/snapshot-basecamp-suggest");

  const logs: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    logs.push(args);
  };

  t.after(() => {
    globalThis.fetch = realFetch;
    console.error = realError;
    suggest.clearBasecampSuggestionCache();
    closeDbForTests();
    process.chdir(originalCwd);
    if (previousEnv.id === undefined) delete process.env.BASECAMP_CLIENT_ID;
    else process.env.BASECAMP_CLIENT_ID = previousEnv.id;
    if (previousEnv.secret === undefined) delete process.env.BASECAMP_CLIENT_SECRET;
    else process.env.BASECAMP_CLIENT_SECRET = previousEnv.secret;
    if (previousEnv.account === undefined) delete process.env.BASECAMP_ACCOUNT_ID;
    else process.env.BASECAMP_ACCOUNT_ID = previousEnv.account;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  getDb()
    .prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('basecamp_tokens', ?, ?)`)
    .run(
      JSON.stringify({
        access_token: "MASCOT-TOKEN",
        refresh_token: "mascot-refresh",
        expires_at: Date.now() + 3_600_000,
      }),
      nowIso()
    );

  const linked = revenue.createRevClient({ name: "Hendo", businessModel: "home_service" });
  revenue.updateRevClient(linked.id, { basecampProjectId: "47628800" });
  const unlinked = revenue.createRevClient({ name: "No Project", businessModel: "home_service" });

  const base = "https://3.basecampapi.com/999";
  const hendo = {
    id: 10472139656,
    title: "Update current blog content",
    completed: true,
    completion: { created_at: "2026-11-03T20:02:54Z" },
    updated_at: "2026-11-03T20:02:54Z",
    parent: { id: 1, title: "SEO", type: "Todolist" },
    assignees: [{ id: 9, name: "Hendo" }],
  };
  const laterTodo = {
    id: 200,
    title: "Schedule Instagram reels",
    completed: true,
    completion: { created_at: "2026-11-05T20:00:00Z" },
    updated_at: "2026-11-05T20:00:00Z",
    parent: { title: "Social", type: "Todolist" },
  };
  const touchedButFinishedLastWeek = {
    id: 42,
    title: "Send the newsletter",
    completed: true,
    completion: { created_at: "2026-10-28T15:00:00Z" },
    updated_at: "2026-11-04T12:00:00Z",
    parent: { title: "Lifecycle", type: "Todolist" },
  };
  const openTodo = {
    id: 7,
    title: "Publish the blog later",
    completed: false,
    updated_at: "2026-11-04T19:00:00Z",
    parent: { title: "SEO", type: "Todolist" },
  };
  const oldTodo = {
    id: 1,
    title: "Last month's blog",
    completed: true,
    completion: { created_at: "2026-10-20T12:00:00Z" },
    updated_at: "2026-10-20T12:00:00Z",
    parent: { title: "SEO", type: "Todolist" },
  };
  const doneCard = {
    id: 88001,
    title: "Update the website hero",
    completed: false,
    updated_at: "2026-11-04T18:00:00Z",
    parent: { title: "Done", type: "Kanban::DoneColumn" },
  };
  const oldCard = {
    id: 88004,
    title: "Film the testimonial",
    completed: true,
    completion: { created_at: "2026-10-15T12:00:00Z" },
    updated_at: "2026-11-04T16:00:00Z",
    parent: { title: "Done", type: "Kanban::DoneColumn" },
  };
  const triageCard = {
    id: 3,
    title: "Draft the homepage",
    completed: false,
    updated_at: "2026-11-05T12:00:00Z",
    parent: { title: "Triage", type: "Kanban::Column" },
  };
  const ancientCard = {
    id: 4,
    title: "Ancient card",
    completed: true,
    updated_at: "2026-10-01T12:00:00Z",
    parent: { title: "Done", type: "Kanban::DoneColumn" },
  };

  function rel(input: RequestInfo | URL): string {
    const url = new URL(String(input));
    return url.pathname.replace(/^\/999/, "") + url.search;
  }

  function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    });
  }

  await t.test("a linked project returns this week's to-dos and done cards", async () => {
    suggest.clearBasecampSuggestionCache();
    const calls: string[] = [];
    let todoFirst = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const path = rel(input);
      calls.push(path);
      if (path.includes("page=todo-3") || path.includes("page=card-3")) {
        throw new Error("paged past the week");
      }
      const type = url.searchParams.get("type");
      const page = url.searchParams.get("page");
      if (type === "Todo" && !page) {
        todoFirst += 1;
        if (todoFirst === 1) {
          return new Response("", { status: 429, headers: { "Retry-After": "0" } });
        }
        return json([openTodo, touchedButFinishedLastWeek, hendo], 200, {
          Link: `<${base}/projects/recordings.json?page=todo-2>; rel="next"`,
        });
      }
      if (page === "todo-2") {
        return json([laterTodo, oldTodo], 200, {
          Link: `<${base}/projects/recordings.json?page=todo-3>; rel="next"`,
        });
      }
      if (type === "Kanban::Card" && !page) {
        return json([triageCard, doneCard, oldCard], 200, {
          Link: `<${base}/projects/recordings.json?page=card-2>; rel="next"`,
        });
      }
      if (page === "card-2") {
        return json([ancientCard], 200, {
          Link: `<${base}/projects/recordings.json?page=card-3>; rel="next"`,
        });
      }
      return json([]);
    }) as typeof fetch;

    const first = await suggest.weekBasecampSuggestions(linked.id, WEEK);
    assert.equal(first.status, "ok");
    assert.equal(first.message, undefined);
    assert.deepEqual(
      first.suggestions.map((row) => [row.sourceKey, row.department, row.place]),
      [
        ["todo:200", "social", "Social"],
        ["card:88001", "web", "Done"],
        ["todo:10472139656", "seo", "SEO"],
      ]
    );
    assert.equal(calls.some((path) => path.includes("page=todo-2")), true);
    assert.equal(calls.some((path) => path.includes("page=card-2")), true);
    assert.equal(calls.some((path) => path.includes("page=todo-3")), false);
    assert.equal(calls.some((path) => path.includes("page=card-3")), false);
    assert.equal(todoFirst, 2);

    const before = calls.length;
    const cached = await suggest.weekBasecampSuggestions(linked.id, WEEK);
    assert.equal(cached.status, "ok");
    assert.equal(calls.length, before);
    assert.equal(cached.suggestions.length, first.suggestions.length);

    const refreshed = await suggest.weekBasecampSuggestions(linked.id, WEEK, { refresh: true });
    assert.equal(refreshed.status, "ok");
    assert.ok(calls.length > before);
    assert.equal(refreshed.suggestions.length, first.suggestions.length);
  });

  await t.test("a failed read is not cached as an empty week", async () => {
    suggest.clearBasecampSuggestionCache();
    logs.length = 0;
    const calls: string[] = [];
    let fail = true;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      calls.push(rel(input));
      const type = url.searchParams.get("type");
      if (fail && type === "Todo") return new Response("nope", { status: 500 });
      if (type === "Todo") return json([hendo]);
      if (type === "Kanban::Card") return json([doneCard]);
      return json([]);
    }) as typeof fetch;

    const failed = await suggest.weekBasecampSuggestions(linked.id, WEEK);
    assert.equal(failed.status, "error");
    assert.equal(failed.message, "Couldn't reach Basecamp");
    assert.deepEqual(failed.suggestions, []);
    assert.equal(logs.length > 0, true);
    assert.equal(logs[0][0], "[basecamp] suggestions");
    const dumped = JSON.stringify(logs);
    assert.equal(dumped.includes("MASCOT-TOKEN"), false);
    assert.equal(dumped.includes("Bearer"), false);
    assert.equal(dumped.includes("nope"), false);

    fail = false;
    const again = await suggest.weekBasecampSuggestions(linked.id, WEEK);
    assert.equal(again.status, "ok");
    assert.deepEqual(
      again.suggestions.map((row) => row.sourceKey),
      ["card:88001", "todo:10472139656"]
    );
    assert.ok(calls.length >= 3);
  });

  await t.test("no linked project is its own status and does not call Basecamp", async () => {
    suggest.clearBasecampSuggestionCache();
    let called = 0;
    globalThis.fetch = (async () => {
      called += 1;
      return json([]);
    }) as typeof fetch;
    const missing = await suggest.weekBasecampSuggestions(unlinked.id, WEEK);
    assert.equal(missing.status, "no_project");
    assert.equal(missing.message, "No Basecamp project linked");
    assert.deepEqual(missing.suggestions, []);
    const unknown = await suggest.weekBasecampSuggestions("missing-client", WEEK);
    assert.equal(unknown.status, "no_project");
    assert.equal(called, 0);
  });

  await t.test("an empty successful read is cached, and refresh asks again", async () => {
    suggest.clearBasecampSuggestionCache();
    const calls: string[] = [];
    let serve = false;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      calls.push(rel(input));
      if (!serve) return json([]);
      if (url.searchParams.get("type") === "Todo") return json([hendo]);
      return json([]);
    }) as typeof fetch;

    const empty = await suggest.weekBasecampSuggestions(linked.id, WEEK);
    assert.equal(empty.status, "ok");
    assert.deepEqual(empty.suggestions, []);
    const again = await suggest.weekBasecampSuggestions(linked.id, WEEK);
    assert.deepEqual(again.suggestions, []);
    assert.equal(calls.length, 2);

    serve = true;
    const stale = await suggest.weekBasecampSuggestions(linked.id, WEEK);
    assert.deepEqual(stale.suggestions, []);
    assert.equal(calls.length, 2);
    const fresh = await suggest.weekBasecampSuggestions(linked.id, WEEK, { refresh: true });
    assert.equal(fresh.status, "ok");
    assert.equal(fresh.suggestions.some((row) => row.sourceKey === "todo:10472139656"), true);
    assert.ok(calls.length > 2);
  });

  await t.test("Basecamp reads for suggestions stay within a small concurrency cap", async () => {
    suggest.clearBasecampSuggestionCache();
    let active = 0;
    let max = 0;
    globalThis.fetch = (async () => {
      active += 1;
      max = Math.max(max, active);
      await new Promise((resolve) => setTimeout(resolve, 40));
      active -= 1;
      return json([]);
    }) as typeof fetch;

    const clients = ["c1", "c2", "c3", "c4"].map((name, index) => {
      const client = revenue.createRevClient({ name, businessModel: "home_service" });
      revenue.updateRevClient(client.id, { basecampProjectId: String(7000 + index) });
      return client.id;
    });
    const results = await Promise.all(
      clients.map((id) => suggest.weekBasecampSuggestions(id, WEEK))
    );
    assert.equal(results.every((result) => result.status === "ok"), true);
    assert.equal(max, 3);
  });
});
