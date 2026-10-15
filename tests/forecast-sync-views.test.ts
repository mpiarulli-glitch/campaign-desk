import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "os";
import path from "path";

const ORG = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const RUN_A = "11111111-1111-4111-8111-111111111111";
const RUN_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN_C = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RUN_D = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RUN_E = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const RUN_F = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const RUN_G = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const CARLOS = {
  email: "cmorones@marketingempiregroup.com",
  id: "desk_carlos",
};
const ABEL = {
  email: "amiranda@marketingempiregroup.com",
  id: "desk_abel",
};

test("SEO Ops runs feed the weekly forecast and tracked hours", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-forecast-views-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const dbMod = await import("../src/lib/db");
  dbMod.closeDbForTests();
  const sync = await import("../src/lib/forecast-sync");
  const forecast = await import("../src/lib/forecast");
  const week = await import("../src/lib/week");

  t.after(() => {
    dbMod.closeDbForTests();
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const current = week.currentWeek();
  const future = week.addWeeks(current, 1);
  const past = week.addWeeks(current, -1);
  const olderPast = week.addWeeks(current, -2);
  const laterFuture = week.addWeeks(current, 2);

  function line(input: {
    who: typeof CARLOS;
    bucket: "client" | "internal";
    source: "actual" | "estimate";
    minutes: number;
    clientName?: string;
  }) {
    const internal = input.bucket === "internal";
    return {
      personEmail: input.who.email,
      campaignDeskPersonId: input.who.id,
      clientId: internal ? null : CLIENT,
      clientName: internal ? "Internal" : input.clientName || "Northwind Plumbing",
      bucket: input.bucket,
      source: input.source,
      minutes: input.minutes,
      hours: sync.hoursForMinutes(input.minutes),
    };
  }

  function body(
    runId: string,
    weeks: Array<{
      weekStart: string;
      basis: "actual" | "estimate";
      allocations: ReturnType<typeof line>[];
    }>
  ) {
    return { runId, source: "seo-ops-center", organizationId: ORG, weeks };
  }

  function summary(weekStart: string, person: string) {
    const row = forecast.weekSummaryForAllPeople(weekStart).find((p) => p.person === person);
    assert.ok(row, `${person} is on the weekly forecast`);
    return row;
  }

  function pause() {
    return new Promise((resolve) => setTimeout(resolve, 20));
  }

  await t.test("a current actual week is tracked time, and meetings stay Internal", () => {
    const stored = sync.upsertForecastRun(
      RUN_A,
      body(RUN_A, [
        {
          weekStart: current,
          basis: "actual",
          allocations: [
            line({ who: CARLOS, bucket: "client", source: "actual", minutes: 330 }),
            line({ who: CARLOS, bucket: "internal", source: "actual", minutes: 60 }),
          ],
        },
        {
          weekStart: future,
          basis: "estimate",
          allocations: [
            line({ who: ABEL, bucket: "client", source: "estimate", minutes: 180 }),
            line({ who: ABEL, bucket: "internal", source: "estimate", minutes: 60 }),
          ],
        },
      ])
    );
    assert.equal(stored.ok, true);

    const carlos = summary(current, "carlos");
    assert.equal(carlos.hours, 6.5);
    assert.equal(carlos.internalHours, 1);
    assert.equal(carlos.allocationPct, 16);
    assert.equal(carlos.donePct, 100);
    assert.equal(forecast.loggedHoursForWeek("carlos", current), 6.5);
    assert.equal(summary(current, "abel").hours, 0);
    assert.equal(forecast.loggedHoursForWeek("abel", current), 0);

    const meeting = sync
      .activeForecastSyncAllocations(current)
      .find((row) => row.bucket === "internal");
    assert.equal(meeting?.clientName, "Internal");
    assert.equal(meeting?.clientId, null);

    const abel = summary(future, "abel");
    assert.equal(abel.hours, 4);
    assert.equal(abel.internalHours, 1);
    assert.equal(abel.allocationPct, 10);
    assert.equal(abel.donePct, 0);
    assert.equal(forecast.loggedHoursForWeek("abel", future), 0);
    assert.equal(summary(future, "carlos").hours, 0);
  });

  await t.test("putting the same run again does not double the hours", () => {
    const again = sync.upsertForecastRun(
      RUN_A,
      body(RUN_A, [
        {
          weekStart: current,
          basis: "actual",
          allocations: [
            line({ who: CARLOS, bucket: "client", source: "actual", minutes: 330 }),
            line({ who: CARLOS, bucket: "internal", source: "actual", minutes: 60 }),
          ],
        },
        {
          weekStart: future,
          basis: "estimate",
          allocations: [
            line({ who: ABEL, bucket: "client", source: "estimate", minutes: 180 }),
            line({ who: ABEL, bucket: "internal", source: "estimate", minutes: 60 }),
          ],
        },
      ])
    );
    assert.equal(again.ok && again.body.idempotent, true);
    assert.equal(summary(current, "carlos").hours, 6.5);
    assert.equal(forecast.loggedHoursForWeek("carlos", current), 6.5);
    assert.equal(summary(future, "abel").hours, 4);
  });

  await t.test("a newer run for the same week replaces the previous hours", async () => {
    await pause();
    const replaced = sync.upsertForecastRun(
      RUN_B,
      body(RUN_B, [
        {
          weekStart: current,
          basis: "actual",
          allocations: [line({ who: CARLOS, bucket: "internal", source: "actual", minutes: 60 })],
        },
      ])
    );
    assert.equal(replaced.ok, true);
    const carlos = summary(current, "carlos");
    assert.equal(carlos.hours, 1);
    assert.equal(carlos.internalHours, 1);
    assert.equal(forecast.loggedHoursForWeek("carlos", current), 1);
    assert.equal(summary(future, "abel").hours, 4);
    assert.equal(forecast.loggedHoursForWeek("abel", future), 0);
  });

  await t.test("deleting the newer run restores the previous week", () => {
    const removed = sync.deleteForecastRun(RUN_B);
    assert.equal(removed.ok && removed.body.idempotent, false);
    assert.equal(summary(current, "carlos").hours, 6.5);
    assert.equal(summary(current, "carlos").internalHours, 1);
    assert.equal(forecast.loggedHoursForWeek("carlos", current), 6.5);
    assert.equal(summary(future, "abel").hours, 4);
  });

  await t.test("an empty week clears that week and does not invent a zero row", async () => {
    await pause();
    const cleared = sync.upsertForecastRun(
      RUN_C,
      body(RUN_C, [{ weekStart: future, basis: "estimate", allocations: [] }])
    );
    assert.equal(cleared.ok, true);
    assert.deepEqual(sync.forecastSyncHoursForWeek(future), []);
    assert.equal(summary(future, "abel").hours, 0);
    assert.equal(summary(future, "abel").internalHours, 0);
    assert.equal(forecast.loggedHoursForWeek("abel", future), 0);
    assert.equal(summary(current, "carlos").hours, 6.5);
  });

  await t.test("deleting the empty run brings the estimate week back", () => {
    assert.equal(sync.deleteForecastRun(RUN_C).ok, true);
    assert.equal(summary(future, "abel").hours, 4);
    assert.equal(summary(future, "abel").internalHours, 1);
    assert.equal(forecast.loggedHoursForWeek("abel", future), 0);
  });

  await t.test("deleting an older run leaves the newer week in place", async () => {
    await pause();
    assert.equal(
      sync.upsertForecastRun(
        RUN_G,
        body(RUN_G, [
          {
            weekStart: current,
            basis: "actual",
            allocations: [line({ who: CARLOS, bucket: "internal", source: "actual", minutes: 60 })],
          },
        ])
      ).ok,
      true
    );
    assert.equal(summary(current, "carlos").hours, 1);

    const removed = sync.deleteForecastRun(RUN_A);
    assert.equal(removed.ok, true);
    assert.equal(summary(current, "carlos").hours, 1);
    assert.equal(forecast.loggedHoursForWeek("carlos", current), 1);
    assert.equal(summary(future, "abel").hours, 0);
    assert.equal(forecast.loggedHoursForWeek("abel", future), 0);
  });

  await t.test("deleting the remaining run removes it from both views", () => {
    assert.equal(sync.deleteForecastRun(RUN_G).ok, true);
    assert.equal(summary(current, "carlos").hours, 0);
    assert.equal(summary(current, "carlos").internalHours, 0);
    assert.equal(summary(current, "carlos").allocationPct, 0);
    assert.equal(forecast.loggedHoursForWeek("carlos", current), 0);
    assert.deepEqual(sync.forecastSyncHoursForWeek(current), []);

    const again = sync.deleteForecastRun(RUN_G);
    assert.equal(again.ok && again.body.idempotent, true);
    assert.equal(forecast.loggedHoursForWeek("carlos", current), 0);
  });

  await t.test("a past actual week counts, and a break row does not", () => {
    assert.equal(
      sync.upsertForecastRun(
        RUN_D,
        body(RUN_D, [
          {
            weekStart: past,
            basis: "actual",
            allocations: [line({ who: CARLOS, bucket: "client", source: "actual", minutes: 120 })],
          },
        ])
      ).ok,
      true
    );
    dbMod
      .getDb()
      .prepare(
        `INSERT INTO seo_ops_forecast_allocations
           (id, run_id, week_start, person_email, person_id, client_id, client_name, bucket, source, minutes, hours)
         VALUES (?, ?, ?, ?, ?, NULL, 'Break', 'break', 'actual', 60, '1.00')`
      )
      .run("break-row", RUN_D, past, CARLOS.email, CARLOS.id);

    assert.equal(summary(past, "carlos").hours, 2);
    assert.equal(summary(past, "carlos").internalHours, 0);
    assert.equal(forecast.loggedHoursForWeek("carlos", past), 2);
    assert.equal(
      sync.forecastSyncHoursForWeek(past).some((row) => row.person === "carlos" && row.forecastHours === 2),
      true
    );
  });

  await t.test("hand-built tasks stay when the run is deleted", () => {
    forecast.createTask({
      person: "carlos",
      taskDate: past,
      notes: "Hand planned",
      hours: 1,
    });
    assert.equal(summary(past, "carlos").hours, 3);
    assert.equal(summary(past, "carlos").allocationPct, 8);
    assert.equal(forecast.loggedHoursForWeek("carlos", past), 2);

    assert.equal(sync.deleteForecastRun(RUN_D).ok, true);
    assert.equal(summary(past, "carlos").hours, 1);
    assert.equal(summary(past, "carlos").internalHours, 0);
    assert.equal(forecast.loggedHoursForWeek("carlos", past), 0);
  });

  await t.test("an estimate on a past week and an actual on a future week do not count", () => {
    assert.equal(
      sync.upsertForecastRun(
        RUN_E,
        body(RUN_E, [
          {
            weekStart: olderPast,
            basis: "estimate",
            allocations: [line({ who: CARLOS, bucket: "client", source: "estimate", minutes: 180 })],
          },
        ])
      ).ok,
      true
    );
    assert.equal(
      sync.upsertForecastRun(
        RUN_F,
        body(RUN_F, [
          {
            weekStart: laterFuture,
            basis: "actual",
            allocations: [line({ who: ABEL, bucket: "client", source: "actual", minutes: 120 })],
          },
        ])
      ).ok,
      true
    );
    assert.equal(summary(olderPast, "carlos").hours, 0);
    assert.equal(forecast.loggedHoursForWeek("carlos", olderPast), 0);
    assert.equal(summary(laterFuture, "abel").hours, 0);
    assert.equal(forecast.loggedHoursForWeek("abel", laterFuture), 0);
    assert.deepEqual(sync.forecastSyncHoursForWeek(olderPast), []);
    assert.deepEqual(sync.forecastSyncHoursForWeek(laterFuture), []);
  });
});
