import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "os";
import path from "path";
import { forecastSlugForSession, OWNER_SLUG } from "../src/lib/people";

test("the app shell hosts the forecast timer dock, not the person page", () => {
  const shell = fs.readFileSync(path.join("src/components/AppShell.tsx"), "utf8");
  const dock = fs.readFileSync(path.join("src/components/TimerDock.tsx"), "utf8");
  const page = fs.readFileSync(
    path.join("src/app/admin/forecast/[person]/page.tsx"),
    "utf8"
  );
  const route = fs.readFileSync(
    path.join("src/app/api/forecast/running/route.ts"),
    "utf8"
  );

  assert.match(shell, /from ["']\.\/TimerDock["']/);
  assert.match(shell, /session\.role \? <TimerDock \/> : null/);
  assert.match(dock, /fc-timer-docks/);
  assert.match(dock, /\/api\/forecast\/running/);
  assert.match(dock, /timer:\s*"stop"/);
  assert.doesNotMatch(page, /fc-timer-docks/);
  assert.match(page, /notifyForecastTimerChanged/);

  // Session-only: a person query string would leak someone else's clock.
  assert.match(route, /runningTimersForSession\(await getSession\(\)\)/);
  assert.doesNotMatch(route, /searchParams/);
});

test("forecastSlugForSession is the session person, or michael for the owner", () => {
  assert.equal(forecastSlugForSession(null), null);
  assert.equal(
    forecastSlugForSession({ role: "admin", person: null, owner: true }),
    OWNER_SLUG
  );
  assert.equal(
    forecastSlugForSession({ role: "admin", person: null }),
    OWNER_SLUG
  );
  assert.equal(
    forecastSlugForSession({ role: "admin", person: "cassidy" }),
    "cassidy"
  );
  assert.equal(
    forecastSlugForSession({ role: "forecast", person: "jack" }),
    "jack"
  );
  assert.equal(
    forecastSlugForSession({ role: "forecast", person: null }),
    null
  );
});

test("GET /api/forecast/running only returns the session person's running tasks", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-forecast-running-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const forecast = await import("../src/lib/forecast");
  const { runningTimersForSession } = await import("../src/lib/forecast-running");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const t0 = Date.parse("2026-08-24T17:00:00.000Z");
  const mine = forecast.createTask({
    person: "michael",
    taskDate: "2026-08-24",
    notes: "Michael's work",
    hours: 1,
  });
  const theirs = forecast.createTask({
    person: "paula",
    taskDate: "2026-08-24",
    notes: "Paula's work",
    hours: 1,
  });
  forecast.startTimer("michael", mine.id, t0);
  forecast.startTimer("paula", theirs.id, t0);

  await t.test("signed out is unauthorized", () => {
    const result = runningTimersForSession(null);
    assert.equal(result.status, 401);
  });

  await t.test("owner session is michael, not whoever else is running", () => {
    const result = runningTimersForSession({
      role: "admin",
      person: null,
    });
    assert.equal(result.status, 200);
    assert.equal("person" in result.body && result.body.person, "michael");
    assert.ok("tasks" in result.body);
    assert.equal(result.body.tasks.length, 1);
    assert.equal(result.body.tasks[0].id, mine.id);
    assert.equal(result.body.tasks[0].notes, "Michael's work");
    assert.ok(!result.body.tasks.some((row) => row.person === "paula"));
  });

  await t.test("a forecast session only sees that person's timers", () => {
    const result = runningTimersForSession({
      role: "forecast",
      person: "paula",
    });
    assert.equal(result.status, 200);
    assert.ok("tasks" in result.body);
    assert.equal(result.body.person, "paula");
    assert.equal(result.body.tasks.length, 1);
    assert.equal(result.body.tasks[0].id, theirs.id);
    assert.ok(!result.body.tasks.some((row) => row.person === "michael"));
  });

  await t.test("a named admin session uses that admin's slug", () => {
    const result = runningTimersForSession({
      role: "admin",
      person: "cassidy",
    });
    assert.equal(result.status, 200);
    assert.ok("tasks" in result.body);
    assert.equal(result.body.person, "cassidy");
    assert.equal(result.body.tasks.length, 0);
  });
});
