import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "os";
import path from "path";

test("assign load and warning copy", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-assign-load-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const forecast = await import("../src/lib/forecast");
  const assign = await import("../src/lib/assign-todo");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await t.test("needed hours default to 1 and reject junk", () => {
    assert.equal(assign.parseNeededHours(undefined), 1);
    assert.equal(assign.parseNeededHours(""), 1);
    assert.equal(assign.parseNeededHours("2.5"), 2.5);
    assert.equal(assign.parseNeededHours(0), 0);
    assert.equal(assign.parseNeededHours(-3), 1);
    assert.equal(assign.parseNeededHours("nope"), 1);
  });

  await t.test("workdays on or before skip weekends", () => {
    assert.deepEqual(assign.workdaysOnOrBefore("2026-08-28", "2026-08-30"), ["2026-08-28"]);
    assert.deepEqual(assign.workdaysOnOrBefore("2026-08-29", "2026-08-30"), []);
    assert.equal(assign.workdaysOnOrBefore("2026-08-24", "2026-08-28").length, 5);
  });

  await t.test("pickAssigneeOnRoster matches the same way internal review maps an AM", () => {
    const roster = [
      { id: 1, name: "Katie Client", email_address: "katie@client.com", client: true },
      { id: 2, name: "Cassidy Merideth", email_address: "cassidy@meg.com", client: false, employee: true },
      { id: 3, name: "Morris Kyle", email_address: "kyle@meg.com", client: false, employee: true },
      { id: 4, name: "Jack", email_address: "jack@meg.com", client: false, employee: true },
    ];
    assert.equal(assign.pickAssigneeOnRoster(roster, "cassidy")?.id, 2);
    assert.equal(assign.pickAssigneeOnRoster(roster, "kyle_morris")?.id, 3);
    assert.equal(assign.pickAssigneeOnRoster(roster, "jack")?.id, 4);
    assert.equal(assign.pickAssigneeOnRoster(roster, "randi")?.id, undefined);
  });

  await t.test("empty forecast still has room and proceeds", () => {
    const load = assign.assignLoadForPerson({
      person: "jack",
      dueOn: "2026-08-28",
      neededHours: 1,
      asOf: "2026-08-24",
    });
    assert.equal(load.count, 0);
    assert.equal(load.plannedHours, 0);
    assert.equal(load.workdays, 5);
    assert.equal(load.capacity, 40);
    assert.equal(load.freeHours, 40);
    assert.equal(load.hasRoom, true);
    const warning = assign.assignWarningCopy(load);
    assert.match(warning.headline, /nothing on their forecast on or before Aug 28/i);
    assert.match(warning.headline, /about 40h free/i);
    assert.match(warning.headline, /Proceed\?/);
    assert.equal(warning.detail, "");
    assert.doesNotMatch(warning.headline, /priority/i);
    assert.doesNotMatch(warning.headline, /shuffle/i);
  });

  await t.test("counts hours, clients, and dates on or before due", () => {
    forecast.createTask({
      person: "paula",
      taskDate: "2026-08-24",
      client: "Vitatherapy",
      notes: "Mon work",
      hours: 4,
    });
    forecast.createTask({
      person: "paula",
      taskDate: "2026-08-26",
      client: "Krak Boba",
      notes: "Wed work",
      hours: 3.5,
    });
    forecast.createTask({
      person: "paula",
      taskDate: "2026-08-31",
      client: "Later",
      notes: "after due",
      hours: 8,
    });
    const done = forecast.createTask({
      person: "paula",
      taskDate: "2026-08-25",
      client: "Done already",
      notes: "finished",
      hours: 8,
    });
    forecast.updateTask(done.id, { completed: true });
    forecast.createTask({
      person: "jack",
      taskDate: "2026-08-24",
      client: "Someone else",
      hours: 8,
    });

    const load = assign.assignLoadForPerson({
      person: "paula",
      dueOn: "2026-08-28",
      neededHours: 1,
      asOf: "2026-08-24",
    });
    assert.equal(load.count, 2);
    assert.equal(load.plannedHours, 7.5);
    assert.deepEqual(load.dates, ["2026-08-24", "2026-08-26"]);
    assert.deepEqual(load.clients, ["Krak Boba", "Vitatherapy"]);
    assert.equal(load.capacity, 40);
    assert.equal(load.freeHours, 32.5);
    assert.equal(load.hasRoom, true);

    const warning = assign.assignWarningCopy(load);
    assert.equal(
      warning.headline,
      "They have about 32.5h free before Aug 28 (7.5h already planned). Proceed?"
    );
    assert.match(warning.detail, /Aug 24/);
    assert.match(warning.detail, /Aug 26/);
    assert.match(warning.detail, /Krak Boba and Vitatherapy occupy that calendar/);
    assert.doesNotMatch(warning.headline + warning.detail, /priority/i);
    assert.doesNotMatch(warning.headline + warning.detail, /shuffle/i);
  });

  await t.test("no room asks the human to notify the team to reprioritize", () => {
    forecast.createTask({
      person: "roy",
      taskDate: "2026-08-24",
      client: "MEG Web HQ",
      hours: 8,
    });
    forecast.createTask({
      person: "roy",
      taskDate: "2026-08-25",
      client: "MEG Web HQ",
      hours: 8,
    });
    forecast.createTask({
      person: "roy",
      taskDate: "2026-08-26",
      client: "MEG Web HQ",
      hours: 8,
    });
    forecast.createTask({
      person: "roy",
      taskDate: "2026-08-27",
      client: "MEG Web HQ",
      hours: 8,
    });
    forecast.createTask({
      person: "roy",
      taskDate: "2026-08-28",
      client: "MEG Web HQ",
      hours: 8,
    });
    const load = assign.assignLoadForPerson({
      person: "roy",
      dueOn: "2026-08-28",
      neededHours: 2,
      asOf: "2026-08-24",
    });
    assert.equal(load.plannedHours, 40);
    assert.equal(load.freeHours, 0);
    assert.equal(load.hasRoom, false);
    const warning = assign.assignWarningCopy(load);
    assert.equal(
      warning.headline,
      "They don't have enough open time before Aug 28 — 40h planned, this needs 2h. You'll need to notify the team to reprioritize if you assign this. Still proceed?"
    );
    assert.match(warning.detail, /MEG Web HQ occupies that calendar/);
    assert.doesNotMatch(warning.headline, /will (shuffle|reprioritize)/i);
    assert.doesNotMatch(warning.headline, /priority/i);
  });

  process.env.BASECAMP_CLIENT_ID = "test-client";
  process.env.BASECAMP_CLIENT_SECRET = "test-secret";
  process.env.BASECAMP_ACCOUNT_ID = "999";
  const { getDb, nowIso } = await import("../src/lib/db");
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(
      "basecamp_tokens",
      JSON.stringify({
        access_token: "TEST-TOKEN",
        refresh_token: "refresh",
        expires_at: Date.now() + 3600_000,
      }),
      nowIso()
    );

  forecast.createTask({
    person: "lana",
    taskDate: "2026-08-24",
    client: "Packed week",
    hours: 40,
  });

  let createdListName = "";
  let lastTodo: { content?: string; assignee_ids?: number[]; due_on?: string } | null = null;
  const lists = [{ id: 11, title: "To-dos" }];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || "GET").toUpperCase();
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (url.includes("/people.json") || url.includes("/circles/people.json")) {
      return json([
        {
          id: 44,
          name: "Lana Verrecchio",
          email_address: "lana@meg.com",
          client: false,
          employee: true,
        },
        {
          id: 45,
          name: "Abel",
          email_address: "abel@meg.com",
          client: false,
          employee: true,
        },
      ]);
    }
    if (url.includes("/projects/") && method === "GET") {
      return json({ dock: [{ id: 9, name: "todoset", enabled: true }] });
    }
    if (url.includes("/todolists.json") && method === "GET") {
      return json(lists);
    }
    if (url.includes("/todolists.json") && method === "POST") {
      const body = JSON.parse(String(init?.body || "{}"));
      createdListName = body.name || "";
      lists.push({ id: 22, title: createdListName });
      return json({ id: 22, title: createdListName });
    }
    if (url.includes("/todos.json") && method === "POST") {
      lastTodo = JSON.parse(String(init?.body || "{}"));
      assert.match(url, /todolists\/22\/todos/);
      return json({ id: 101, app_url: "https://3.basecamp.com/todo/101" });
    }
    return json([]);
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  await t.test("full forecast still creates on Tasks when the human proceeds", async () => {
    const result = await assign.createOpsAssignedTodo({
      title: "Write the Q3 wrap",
      dueOn: "2026-08-28",
      assignee: "lana",
      basecampProjectId: "proj-9",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.listName, "Tasks");
    assert.equal(createdListName, "Tasks");
    assert.notEqual(createdListName, "Campaign Review");
    assert.equal(lastTodo?.content, "Write the Q3 wrap");
    assert.equal(lastTodo?.assignee_ids?.[0], 44);
    assert.equal(lastTodo?.due_on, "2026-08-28");
    assert.equal(result.todoUrl, "https://3.basecamp.com/todo/101");
    const still = forecast.listTasksForPersonWeek("lana", "2026-08-24");
    assert.equal(still.length, 1);
    assert.equal(still[0].hours, 40);
    assert.equal(still[0].client, "Packed week");
  });

  await t.test("empty forecast still creates when the human proceeds", async () => {
    const result = await assign.createOpsAssignedTodo({
      title: "Quick check-in",
      dueOn: "2026-08-28",
      assignee: "abel",
      basecampProjectId: "proj-9",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(lastTodo?.assignee_ids?.[0], 45);
    assert.equal(forecast.listTasksForPersonWeek("abel", "2026-08-24").length, 0);
  });

  await t.test("unknown assignee fails clearly without creating a to-do", async () => {
    lastTodo = null;
    const result = await assign.createOpsAssignedTodo({
      title: "Should not land",
      dueOn: "2026-08-28",
      assignee: "randi",
      basecampProjectId: "proj-9",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /Randi isn't on that Basecamp project/);
    assert.equal(lastTodo, null);
  });
});

test("admin assign API is admin-gated and warning-only", () => {
  const assignSrc = fs.readFileSync(
    path.join("src/app/api/admin/assign/route.ts"),
    "utf8"
  );
  const loadSrc = fs.readFileSync(
    path.join("src/app/api/admin/assign/load/route.ts"),
    "utf8"
  );
  const ui = fs.readFileSync(
    path.join("src/components/AssignTodoPanel.tsx"),
    "utf8"
  );
  const adminHome = fs.readFileSync(path.join("src/app/admin/page.tsx"), "utf8");
  const leadership = fs.readFileSync(
    path.join("src/components/LeadershipHome.tsx"),
    "utf8"
  );
  assert.match(assignSrc, /isAdminAuthenticated/);
  assert.match(loadSrc, /isAdminAuthenticated/);
  assert.match(assignSrc, /createOpsAssignedTodo/);
  assert.match(loadSrc, /assignLoadForPerson/);
  assert.match(ui, /\/api\/admin\/assign\/load/);
  assert.match(ui, /You'll need to notify the team|warning\.headline/);
  assert.match(ui, /onSubmit=\{openWarning\}/);
  assert.doesNotMatch(ui, /shuffle/i);
  assert.match(adminHome, /AssignTodoPanel/);
  assert.match(leadership, /AssignTodoPanel/);
  const teamHome = adminHome.slice(adminHome.indexOf("function TeamMemberHome"));
  assert.doesNotMatch(teamHome, /AssignTodoPanel/);
});
