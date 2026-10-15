import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "os";
import path from "path";
import { hoursForMinutes } from "../src/lib/forecast-sync";

const SECRET = "synthetic-forecast-sync-secret";
const ORG = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const RUN_A = "11111111-1111-4111-8111-111111111111";
const RUN_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN_C = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RUN_MISSING = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type SyncLine = {
  personEmail: string;
  campaignDeskPersonId: string;
  clientId: string | null;
  clientName: string;
  bucket: "client" | "internal";
  source: "actual" | "estimate";
  minutes: number;
  hours: string | number;
};

type SyncWeek = {
  weekStart: string;
  basis: "actual" | "estimate";
  allocations: SyncLine[];
};

type SyncBody = {
  runId: string;
  source: string;
  organizationId: string;
  weeks: SyncWeek[];
};

function line(input: {
  email: string;
  id: string;
  bucket: "client" | "internal";
  source: "actual" | "estimate";
  minutes: number;
  hours: string | number;
  clientId?: string | null;
}): SyncLine {
  const internal = input.bucket === "internal";
  return {
    personEmail: input.email,
    campaignDeskPersonId: input.id,
    clientId: internal ? (input.clientId === undefined ? null : input.clientId) : input.clientId ?? CLIENT,
    clientName: internal ? "Internal" : "Northwind Plumbing",
    bucket: input.bucket,
    source: input.source,
    minutes: input.minutes,
    hours: input.hours,
  };
}

function runBody(runId: string, weeks: SyncWeek[]): SyncBody {
  return { runId, source: "seo-ops-center", organizationId: ORG, weeks };
}

const SAMPLE = runBody(RUN_A, [
  {
    weekStart: "2026-10-12",
    basis: "actual",
    allocations: [
      line({
        email: "cmorones@marketingempiregroup.com",
        id: "desk_carlos",
        bucket: "client",
        source: "actual",
        minutes: 240,
        hours: "4.00",
      }),
      line({
        email: "cmorones@marketingempiregroup.com",
        id: "desk_carlos",
        bucket: "internal",
        source: "actual",
        minutes: 60,
        hours: "1.00",
      }),
    ],
  },
  {
    weekStart: "2026-10-19",
    basis: "estimate",
    allocations: [
      line({
        email: "amiranda@marketingempiregroup.com",
        id: "desk_abel",
        bucket: "client",
        source: "estimate",
        minutes: 180,
        hours: "3.00",
      }),
      line({
        email: "amiranda@marketingempiregroup.com",
        id: "desk_abel",
        bucket: "internal",
        source: "estimate",
        minutes: 60,
        hours: "1.00",
      }),
    ],
  },
]);

test("minutes convert half away from zero", () => {
  assert.equal(hoursForMinutes(240), "4.00");
  assert.equal(hoursForMinutes(90), "1.50");
  assert.equal(hoursForMinutes(10), "0.17");
  assert.equal(hoursForMinutes(241), "4.02");
});

test("SEO Ops forecast sync receiver", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-forecast-sync-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  process.env.CAMPAIGN_DESK_API_TOKEN = SECRET;

  const db = await import("../src/lib/db");
  db.closeDbForTests();
  const sync = await import("../src/lib/forecast-sync");
  const peopleRoute = await import("../src/app/v1/people/route");
  const runsRoute = await import("../src/app/v1/forecast-runs/[runId]/route");

  t.after(() => {
    db.closeDbForTests();
    process.chdir(originalCwd);
    delete process.env.CAMPAIGN_DESK_API_TOKEN;
  });

  function auth(headers?: Record<string, string>) {
    return { authorization: `Bearer ${SECRET}`, ...headers };
  }

  async function put(runId: string, body: unknown, headers?: Record<string, string>) {
    const res = await runsRoute.PUT(
      new Request(`http://desk.example/v1/forecast-runs/${runId}`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...auth(headers) },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ runId }) }
    );
    const json = (await res.json()) as {
      error?: string;
      message?: string;
      status?: string;
      idempotent?: boolean;
    };
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
    const json = (await res.json()) as {
      error?: string;
      message?: string;
      status?: string;
      idempotent?: boolean;
    };
    return { status: res.status, json };
  }

  await t.test("missing bearer is unauthorized and does not echo the secret", async () => {
    const res = await peopleRoute.GET(new Request("http://desk.example/v1/people"));
    const text = await res.text();
    assert.equal(res.status, 401);
    assert.equal(JSON.parse(text).error, "unauthorized");
    assert.equal(text.includes(SECRET), false);
  });

  await t.test("people with emails are returned, including the known mailboxes", async () => {
    const users = await import("../src/lib/users");
    const first = await peopleRoute.GET(
      new Request("http://desk.example/v1/people", { headers: auth() })
    );
    const second = await peopleRoute.GET(
      new Request("http://desk.example/v1/people", { headers: auth() })
    );
    assert.equal(first.status, 200);
    const a = (await first.json()) as { people: Array<{ id: string; email: string }> };
    const b = (await second.json()) as { people: Array<{ id: string; email: string }> };
    assert.ok(a.people.length > 0);
    assert.deepEqual(b.people, a.people);
    const carlos = a.people.find(
      (p: { email: string }) => p.email === "cmorones@marketingempiregroup.com"
    );
    const abel = a.people.find(
      (p: { email: string }) => p.email === "amiranda@marketingempiregroup.com"
    );
    assert.equal(carlos?.id, "desk_carlos");
    assert.equal(abel?.id, "desk_abel");
    const emails = a.people.map((p: { email: string }) => p.email);
    assert.equal(new Set(emails).size, emails.length);

    users.setUserEmail("roy", "roy@marketingempiregroup.com");
    const withRoy = await peopleRoute.GET(
      new Request("http://desk.example/v1/people", { headers: auth() })
    );
    const listed = (await withRoy.json()) as { people: Array<{ id: string; email: string }> };
    assert.ok(listed.people.length > 0);
    assert.equal(
      listed.people.find((p) => p.id === "desk_roy")?.email,
      "roy@marketingempiregroup.com"
    );
    assert.equal(
      listed.people.find((p) => p.id === "desk_carlos")?.email,
      "cmorones@marketingempiregroup.com"
    );

    users.setUserEmail("carlos", "carlos.other@marketingempiregroup.com");
    const replaced = await peopleRoute.GET(
      new Request("http://desk.example/v1/people", { headers: auth() })
    );
    const other = (await replaced.json()) as { people: Array<{ id: string; email: string }> };
    assert.ok(other.people.length > 0);
    assert.equal(
      other.people.find((p) => p.id === "desk_carlos")?.email,
      "carlos.other@marketingempiregroup.com"
    );
    users.setUserEmail("carlos", "cmorones@marketingempiregroup.com");
  });

  await t.test("the sample run stores once and a repeat does not double hours", async () => {
    const created = await put(RUN_A, SAMPLE);
    assert.equal(created.status, 200);
    assert.equal(created.json.idempotent, false);
    assert.equal(created.json.status, "accepted");

    const again = await put(RUN_A, SAMPLE);
    assert.equal(again.status, 200);
    assert.equal(again.json.idempotent, true);

    const week = sync.activeForecastSyncAllocations("2026-10-12");
    const client = week.find((row) => row.bucket === "client");
    const internal = week.find((row) => row.bucket === "internal");
    assert.equal(client?.hours, "4.00");
    assert.equal(client?.minutes, 240);
    assert.equal(internal?.hours, "1.00");
    assert.equal(internal?.minutes, 60);
    assert.equal(week.length, 2);
  });

  await t.test("a different body for the same run conflicts and keeps 240 minutes", async () => {
    const body = structuredClone(SAMPLE);
    body.weeks[0].allocations[0].minutes = 241;
    body.weeks[0].allocations[0].hours = "4.02";
    const conflict = await put(RUN_A, body);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.json.error, "idempotency_conflict");
    const week = sync.activeForecastSyncAllocations("2026-10-12");
    assert.equal(week.find((row) => row.bucket === "client")?.minutes, 240);
  });

  await t.test("hours must be the matching string", async () => {
    const numeric = structuredClone(SAMPLE);
    numeric.runId = RUN_B;
    numeric.weeks[0].allocations[0].hours = 4 as unknown as string;
    const asNumber = await put(RUN_B, numeric);
    assert.equal(asNumber.status, 422);
    assert.equal(asNumber.json.error, "invalid_payload");
    assert.match(asNumber.json.message ?? "", /hours/);

    const mismatch = structuredClone(SAMPLE);
    mismatch.runId = RUN_B;
    mismatch.weeks[0].allocations[0].hours = "4.01";
    const bad = await put(RUN_B, mismatch);
    assert.equal(bad.status, 422);
    assert.match(bad.json.message ?? "", /hours/);
    assert.equal(sync.activeForecastSyncAllocations("2026-10-12").find((r) => r.bucket === "client")?.minutes, 240);
  });

  await t.test("client and internal lines require the matching client id", async () => {
    const internal = structuredClone(SAMPLE);
    internal.runId = RUN_B;
    internal.weeks[0].allocations[1].clientId = CLIENT;
    const badInternal = await put(RUN_B, internal);
    assert.equal(badInternal.status, 422);
    assert.match(badInternal.json.message ?? "", /clientId/);

    const client = structuredClone(SAMPLE);
    client.runId = RUN_B;
    client.weeks[0].allocations[0].clientId = null;
    const badClient = await put(RUN_B, client);
    assert.equal(badClient.status, 422);
    assert.match(badClient.json.message ?? "", /clientId/);
  });

  await t.test("a later run replaces one week and leaves the other week", async () => {
    const body = runBody(RUN_B, [
      {
        weekStart: "2026-10-12",
        basis: "actual",
        allocations: [
          line({
            email: "cmorones@marketingempiregroup.com",
            id: "desk_carlos",
            bucket: "internal",
            source: "actual",
            minutes: 60,
            hours: "1.00",
          }),
        ],
      },
    ]);
    const replaced = await put(RUN_B, body);
    assert.equal(replaced.status, 200);
    const current = sync.activeForecastSyncAllocations("2026-10-12");
    assert.equal(current.length, 1);
    assert.equal(current[0].bucket, "internal");
    assert.equal(current[0].minutes, 60);
    const later = sync.activeForecastSyncAllocations("2026-10-19");
    assert.equal(later.find((row) => row.bucket === "client")?.minutes, 180);
    assert.equal(later.find((row) => row.bucket === "internal")?.minutes, 60);
  });

  await t.test("an empty allocations array clears that week without a zero row", async () => {
    const body = runBody(RUN_C, [
      { weekStart: "2026-10-19", basis: "estimate", allocations: [] },
    ]);
    const cleared = await put(RUN_C, body);
    assert.equal(cleared.status, 200);
    assert.deepEqual(sync.activeForecastSyncAllocations("2026-10-19"), []);
    const stored = db
      .getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM seo_ops_forecast_allocations WHERE run_id = ? AND week_start = ?`
      )
      .get(RUN_C, "2026-10-19") as { n: number };
    assert.equal(stored.n, 0);
    assert.equal(sync.activeForecastSyncAllocations("2026-10-12")[0].bucket, "internal");
  });

  await t.test("deleting the newest run restores the previous week, and a second delete is idempotent", async () => {
    const removed = await del(RUN_C);
    assert.equal(removed.status, 200);
    assert.equal(removed.json.status, "deleted");
    assert.equal(removed.json.idempotent, false);
    const restored = sync.activeForecastSyncAllocations("2026-10-19");
    assert.equal(restored.find((row) => row.bucket === "client")?.minutes, 180);

    const again = await del(RUN_C);
    assert.equal(again.status, 200);
    assert.equal(again.json.idempotent, true);

    const missing = await del(RUN_MISSING);
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error, "run_not_found");
  });

  await t.test("deleting an older run leaves the newer week in place", async () => {
    const removed = await del(RUN_A);
    assert.equal(removed.status, 200);
    const week = sync.activeForecastSyncAllocations("2026-10-12");
    assert.equal(week.length, 1);
    assert.equal(week[0].bucket, "internal");
    assert.equal(week[0].minutes, 60);
  });
});
