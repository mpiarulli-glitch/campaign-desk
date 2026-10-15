import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "os";
import path from "path";
import { dayBarHours } from "../src/lib/forecast-sync-view";

const SECRET = "synthetic-forecast-sync-secret";
const ORG = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const TASK = "44444444-4444-4444-8444-444444444444";
const LOG = "55555555-5555-4555-8555-555555555555";
const EVENT = "66666666-6666-4666-8666-666666666666";
const RUN_V1 = "14141414-1414-4141-8141-141414141414";
const RUN_V2 = "12121212-1212-4121-8121-121212121212";
const RUN_V2B = "13131313-1313-4131-8131-131313131313";
const WEEK = "2026-10-12";
const NEXT = "2026-10-19";

test("day bars add timesheet hours and synced hours", () => {
  assert.equal(dayBarHours(0, 1.5), 1.5);
  assert.equal(dayBarHours(2, 1.5), 3.5);
  assert.equal(dayBarHours(0, 0), 0);
});

test("SEO Ops forecast sync v2", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-forecast-v2-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  process.env.CAMPAIGN_DESK_API_TOKEN = SECRET;

  const dbMod = await import("../src/lib/db");
  dbMod.closeDbForTests();
  const sync = await import("../src/lib/forecast-sync");
  const forecast = await import("../src/lib/forecast");
  const week = await import("../src/lib/week");
  const runsRoute = await import("../src/app/v1/forecast-runs/[runId]/route");
  const peopleRoute = await import("../src/app/v1/people/route");
  const clientsRoute = await import("../src/app/v1/clients/route");

  t.after(() => {
    dbMod.closeDbForTests();
    process.chdir(originalCwd);
    delete process.env.CAMPAIGN_DESK_API_TOKEN;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const current = week.currentWeek();
  const db = dbMod.getDb();
  const now = dbMod.nowIso();
  db.prepare(
    `INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`
  ).run("rc_pipe", "Pipe It Right", now, now);
  db.prepare(
    `INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`
  ).run("rc_north", "Northwind Plumbing", now, now);
  db.prepare(
    `INSERT INTO rev_clients (id, name, active, created_at, updated_at) VALUES (?, ?, 0, ?, ?)`
  ).run("rc_paused", "Paused Co", now, now);
  db.prepare(
    `INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`
  ).run("rc_twin_a", "Twin Co", now, now);
  db.prepare(
    `INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`
  ).run("rc_twin_b", "Twin Co", now, now);

  function auth() {
    return { authorization: `Bearer ${SECRET}` };
  }

  async function put(runId: string, body: unknown) {
    const res = await runsRoute.PUT(
      new Request(`http://desk.example/v1/forecast-runs/${runId}`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...auth() },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ runId }) }
    );
    const json = (await res.json()) as { error?: string; message?: string; idempotent?: boolean };
    return { status: res.status, json };
  }

  async function del(runId: string) {
    const res = await runsRoute.DELETE(
      new Request(`http://desk.example/v1/forecast-runs/${runId}`, {
        method: "DELETE",
        headers: auth(),
      }),
      { params: Promise.resolve({ runId }) }
    );
    return { status: res.status, json: (await res.json()) as { idempotent?: boolean } };
  }

  function clientItem(input: {
    key: string;
    date?: string;
    kind?: "task" | "event";
    name: string;
    minutes: number;
    campaignDeskClientId?: string | null;
    title?: string;
    startTime?: string | null;
  }) {
    return {
      itemKey: input.key,
      kind: input.kind || "task",
      bucket: "client" as const,
      client: {
        seoOpsClientId: CLIENT,
        name: input.name,
        domain: null,
        campaignDeskClientId:
          input.campaignDeskClientId === undefined ? null : input.campaignDeskClientId,
      },
      title: input.title || "Service pages",
      source: "actual" as const,
      minutes: input.minutes,
      hours: sync.hoursForMinutes(input.minutes),
      startTime: input.startTime === undefined ? null : input.startTime,
      sourceIds: {
        taskId: TASK,
        timeLogIds: [LOG],
        plannerEventId: null,
      },
    };
  }

  function internalEvent(minutes: number, title: string, startTime: string | null) {
    return {
      itemKey: `event:${EVENT}:${startTime || "day"}`,
      kind: "event" as const,
      bucket: "internal" as const,
      client: null,
      title,
      source: "actual" as const,
      minutes,
      hours: sync.hoursForMinutes(minutes),
      startTime,
      sourceIds: { taskId: null, timeLogIds: [] as string[], plannerEventId: EVENT },
    };
  }

  function v2(runId: string, days: Array<{ date: string; items: unknown[] }>, weekStart = WEEK) {
    return {
      version: 2,
      runId,
      source: "seo-ops-center",
      organizationId: ORG,
      weeks: [
        {
          weekStart,
          basis: "actual" as const,
          people: [
            {
              personEmail: "cmorones@marketingempiregroup.com",
              campaignDeskPersonId: "desk_carlos",
              days,
            },
          ],
        },
      ],
    };
  }

  await t.test("clients lists active Basecamp clients and requires the token", async () => {
    const denied = await clientsRoute.GET(new Request("http://desk.example/v1/clients"));
    assert.equal(denied.status, 401);
    const res = await clientsRoute.GET(
      new Request("http://desk.example/v1/clients", { headers: auth() })
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { clients: Array<{ id: string; name: string }> };
    assert.deepEqual(
      body.clients.map((c) => c.id),
      ["rc_north", "rc_pipe", "rc_twin_a", "rc_twin_b"]
    );
  });

  await t.test("a v2 run fills the weekday the hours belong to", async () => {
    const stored = await put(
      RUN_V2,
      v2(RUN_V2, [
        {
          date: "2026-10-12",
          items: [
            clientItem({
              key: "task:monday",
              name: "Pipe It Right",
              minutes: 222,
              title: "SEO optimizations – service pages",
            }),
            internalEvent(168, "1:1 – performance", "09:30"),
          ],
        },
        {
          date: "2026-10-17",
          items: [clientItem({ key: "task:saturday", name: "Pipe It Right", minutes: 60 })],
        },
      ])
    );
    assert.equal(stored.status, 200);
    assert.equal(stored.json.idempotent, false);

    const again = await put(
      RUN_V2,
      v2(RUN_V2, [
        {
          date: "2026-10-12",
          items: [
            clientItem({
              key: "task:monday",
              name: "Pipe It Right",
              minutes: 222,
              title: "SEO optimizations – service pages",
            }),
            internalEvent(168, "1:1 – performance", "09:30"),
          ],
        },
        {
          date: "2026-10-17",
          items: [clientItem({ key: "task:saturday", name: "Pipe It Right", minutes: 60 })],
        },
      ])
    );
    assert.equal(again.status, 200);
    assert.equal(again.json.idempotent, true);

    const items = sync.forecastSyncItemsForPerson("carlos", WEEK, WEEK);
    const meeting = items.find((item) => item.kind === "event");
    assert.equal(meeting?.title, "1:1 – performance");
    assert.equal(meeting?.clientName, "Internal");
    assert.equal(meeting?.startTime, "09:30");
    assert.equal(meeting?.unmatched, false);

    const monday = sync.forecastSyncHoursByDate("carlos", WEEK, WEEK)["2026-10-12"];
    assert.equal(monday.hours, 6.5);
    assert.equal(monday.internalHours, 2.8);
    assert.equal(dayBarHours(0, monday.hours), 6.5);
    assert.equal(sync.forecastSyncHoursByDate("carlos", WEEK, WEEK)["2026-10-17"], undefined);

    const hours = sync.forecastSyncHoursForPerson("carlos", WEEK, WEEK);
    assert.equal(hours.forecastHours, 7.5);
    assert.equal(hours.trackedHours, 7.5);
    assert.equal(hours.internalHours, 2.8);

    const pipe = items.find((item) => item.title.startsWith("SEO"));
    assert.equal(pipe?.clientName, "Pipe It Right");
    assert.equal(pipe?.unmatched, false);
    const tasks = db.prepare(`SELECT COUNT(*) AS n FROM forecast_tasks`).get() as { n: number };
    assert.equal(tasks.n, 0);
  });

  await t.test("a client meeting counts to the client, and a miss stays unmatched", async () => {
    const body = v2(RUN_V2B, [
      {
        date: "2026-10-13",
        items: [
          clientItem({
            key: "event:client-call",
            kind: "event",
            name: "Northwind Plumbing",
            minutes: 45,
            title: "Northwind weekly",
            startTime: "11:00",
            campaignDeskClientId: "rc_missing",
          }),
          clientItem({
            key: "task:case",
            name: "northwind plumbing",
            minutes: 30,
            title: "Lower case name",
          }),
          clientItem({
            key: "task:twin",
            name: "Twin Co",
            minutes: 15,
            title: "Ambiguous",
          }),
          clientItem({
            key: "task:paused",
            name: "Other",
            minutes: 15,
            title: "Paused still matches by key",
            campaignDeskClientId: "rc_paused",
          }),
        ],
      },
    ]);
    const stored = await put(RUN_V2B, body);
    assert.equal(stored.status, 200);

    const items = sync.forecastSyncItemsForPerson("carlos", WEEK, WEEK);
    const call = items.find((item) => item.itemKey === "event:client-call");
    assert.equal(call?.bucket, "client");
    assert.equal(call?.clientName, "Northwind Plumbing");
    assert.equal(call?.unmatched, false);
    assert.equal(items.find((item) => item.itemKey === "task:case")?.unmatched, true);
    assert.equal(items.find((item) => item.itemKey === "task:case")?.clientName, "northwind plumbing");
    assert.equal(items.find((item) => item.itemKey === "task:twin")?.unmatched, true);
    assert.equal(items.find((item) => item.itemKey === "task:paused")?.clientName, "Paused Co");
    assert.equal(items.find((item) => item.itemKey === "task:paused")?.unmatched, false);

    const hours = sync.forecastSyncHoursForPerson("carlos", WEEK, WEEK);
    assert.equal(hours.internalHours, 0);
    assert.equal(hours.forecastHours, 1.75);
    const tuesday = sync.forecastSyncHoursByDate("carlos", WEEK, WEEK)["2026-10-13"];
    assert.equal(tuesday.hours, 1.75);
    assert.equal(tuesday.internalHours, 0);
    assert.equal(sync.forecastSyncItemsForPerson("carlos", WEEK, WEEK).some((item) => item.date === "2026-10-12"), false);
  });

  await t.test("deleting the newest run restores the previous week's days", async () => {
    const removed = await del(RUN_V2B);
    assert.equal(removed.status, 200);
    assert.equal(removed.json.idempotent, false);
    const monday = sync.forecastSyncHoursByDate("carlos", WEEK, WEEK)["2026-10-12"];
    assert.equal(monday.hours, 6.5);
    assert.equal(
      sync.forecastSyncItemsForPerson("carlos", WEEK, WEEK).some((item) => item.title === "1:1 – performance"),
      true
    );
    const again = await del(RUN_V2B);
    assert.equal(again.json.idempotent, true);
  });

  await t.test("version 1 still stores totals and leaves the day bars empty", async () => {
    const body = {
      runId: RUN_V1,
      source: "seo-ops-center",
      organizationId: ORG,
      weeks: [
        {
          weekStart: NEXT,
          basis: "estimate",
          allocations: [
            {
              personEmail: "cmorones@marketingempiregroup.com",
              campaignDeskPersonId: "desk_carlos",
              clientId: CLIENT,
              clientName: "Northwind Plumbing",
              bucket: "client",
              source: "estimate",
              minutes: 120,
              hours: "2.00",
            },
          ],
        },
      ],
    };
    const stored = await put(RUN_V1, body);
    assert.equal(stored.status, 200);
    assert.equal(sync.activeForecastSyncAllocations(NEXT)[0]?.minutes, 120);
    assert.deepEqual(sync.forecastSyncItemsForPerson("carlos", NEXT, WEEK), []);
    assert.deepEqual(sync.forecastSyncHoursByDate("carlos", NEXT, WEEK), {});
    assert.equal(sync.forecastSyncHoursForPerson("carlos", WEEK, WEEK).trackedHours, 7.5);
  });

  await t.test("a later version 2 week replaces version 1, and delete brings it back", async () => {
    const replacement = {
      version: 2,
      runId: "15151515-1515-4151-8151-151515151515",
      source: "seo-ops-center",
      organizationId: ORG,
      weeks: [
        {
          weekStart: NEXT,
          basis: "estimate",
          people: [
            {
              personEmail: "cmorones@marketingempiregroup.com",
              campaignDeskPersonId: "desk_carlos",
              days: [
                {
                  date: "2026-10-20",
                  items: [
                    {
                      ...clientItem({
                        key: "task:next",
                        name: "Pipe It Right",
                        minutes: 60,
                        title: "Next week",
                      }),
                      source: "estimate",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const stored = await put(replacement.runId, replacement);
    assert.equal(stored.status, 200);
    assert.equal(sync.forecastSyncItemsForPerson("carlos", NEXT, WEEK)[0]?.title, "Next week");
    assert.equal(sync.forecastSyncHoursByDate("carlos", NEXT, WEEK)["2026-10-20"].hours, 1);
    assert.equal(sync.activeForecastSyncAllocations(NEXT)[0]?.minutes, 60);
    await del(replacement.runId);
    assert.equal(sync.activeForecastSyncAllocations(NEXT)[0]?.minutes, 120);
    assert.deepEqual(sync.forecastSyncItemsForPerson("carlos", NEXT, WEEK), []);
  });

  await t.test("hand-made tasks stay, and synced hours are added once", () => {
    const monday = week.weekdays(current)[0];
    forecast.createTask({
      person: "carlos",
      taskDate: monday,
      client: "Hand made",
      notes: "Wrote this in Campaign Desk",
      hours: 2,
    });
    if (current === WEEK) {
      const summary = forecast.weekSummaryForAllPeople(current).find((row) => row.person === "carlos");
      assert.equal(summary?.hours, 9.5);
      assert.equal(forecast.loggedHoursForWeek("carlos", current), 7.5);
    }
    const task = forecast.listTasksForPersonWeek("carlos", current).find((row) => row.notes.startsWith("Wrote"));
    assert.equal(task?.client, "Hand made");
    assert.equal(task?.hours, 2);
  });

  await t.test("an unknown person, a bad kind, and too many items are rejected", async () => {
    const unknown = v2("16161616-1616-4161-8161-161616161616", [
      { date: "2026-10-12", items: [clientItem({ key: "x", name: "Pipe It Right", minutes: 30 })] },
    ]);
    unknown.weeks[0].people[0].campaignDeskPersonId = "desk_nobody";
    unknown.weeks[0].people[0].personEmail = "nobody@marketingempiregroup.com";
    const missing = await put(unknown.runId, unknown);
    assert.equal(missing.status, 422);

    const ooo = v2("17171717-1717-4171-8171-171717171717", [
      {
        date: "2026-10-12",
        items: [{ ...clientItem({ key: "ooo", name: "Pipe It Right", minutes: 30 }), kind: "ooo" }],
      },
    ]);
    const skipped = await put(ooo.runId, ooo);
    assert.equal(skipped.status, 422);
    assert.match(skipped.json.message || "", /kind/);

    const bulky = v2("18181818-1818-4181-8181-181818181818", [
      {
        date: "2026-10-12",
        items: Array.from({ length: 501 }, (_, i) =>
          clientItem({ key: `task:${i}`, name: "Pipe It Right", minutes: 1, title: `Item ${i}` })
        ),
      },
    ]);
    const tooMany = await put(bulky.runId, bulky);
    assert.equal(tooMany.status, 422);
    assert.match(tooMany.json.message || "", /500/);
    assert.equal(sync.forecastSyncHoursByDate("carlos", WEEK, WEEK)["2026-10-12"].hours, 6.5);
  });

  await t.test("a roster person with no email is recorded from the sender", async () => {
    db.prepare(`DELETE FROM users WHERE slug = ?`).run("roy");
    const runId = "19191919-1919-4191-8191-191919191919";
    const body = {
      version: 2,
      runId,
      source: "seo-ops-center",
      organizationId: ORG,
      weeks: [
        {
          weekStart: WEEK,
          basis: "actual",
          people: [
            {
              personEmail: "roy@marketingempiregroup.com",
              campaignDeskPersonId: "desk_roy",
              days: [
                {
                  date: "2026-10-14",
                  items: [clientItem({ key: "task:roy", name: "Pipe It Right", minutes: 60, title: "Roy's pages" })],
                },
              ],
            },
          ],
        },
      ],
    };
    const stored = await put(runId, body);
    assert.equal(stored.status, 200);
    const user = db.prepare(`SELECT email, password_hash, role FROM users WHERE slug = ?`).get("roy") as {
      email: string;
      password_hash: string | null;
      role: string;
    };
    assert.equal(user.email, "roy@marketingempiregroup.com");
    assert.equal(user.password_hash, null);
    assert.equal(user.role, "forecast");
    const people = await peopleRoute.GET(
      new Request("http://desk.example/v1/people", { headers: auth() })
    );
    const listed = (await people.json()) as { people: Array<{ id: string; email: string }> };
    assert.equal(listed.people.find((p) => p.id === "desk_roy")?.email, "roy@marketingempiregroup.com");
    assert.equal(sync.forecastSyncHoursByDate("roy", WEEK, WEEK)["2026-10-14"].hours, 1);
    assert.equal(sync.forecastSyncItemsForPerson("carlos", WEEK, WEEK).length, 0);

    const clash = structuredClone(body);
    clash.runId = "1a1a1a1a-1a1a-41a1-81a1-1a1a1a1a1a1a";
    clash.weeks[0].people[0].campaignDeskPersonId = "desk_abel";
    const rejected = await put(clash.runId, clash);
    assert.equal(rejected.status, 422);
    const abel = db.prepare(`SELECT email FROM users WHERE slug = ?`).get("abel") as { email: string | null };
    assert.equal(abel.email, null);
  });
});
