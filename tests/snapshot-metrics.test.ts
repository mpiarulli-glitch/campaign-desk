import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Metric periods and series identity. Both used to fail quietly: a period stored
// as typed sorted a trend line through time in the wrong order, and a metric name
// typed with different casing forked one series into two charts each holding half
// the data. Quiet is the part these tests are about.

test("month spellings normalise to one canonical period", async () => {
  const { normalizeMetricPeriod, metricPeriodLabel, metricPeriodShortLabel } =
    await import("../src/lib/metric-period");

  for (const written of [
    "2026-04", "2026-4", "2026/04", "2026-04-01",
    "4/2026", "04-2026",
    "April 2026", "Apr 2026", "apr 2026", "Apr-2026", "April '26", "Apr. 2026",
    "2026 April",
  ]) {
    assert.equal(normalizeMetricPeriod(written), "2026-04", `"${written}"`);
  }

  // Not a month. Refused rather than stored as typed: a point the chart cannot
  // place is worse than one that was never saved, because it looks like it worked.
  for (const bad of ["", "Q2 2026", "2026", "13/2026", "2026-13", "sometime", "spring"]) {
    assert.equal(normalizeMetricPeriod(bad), "", `"${bad}"`);
  }

  assert.equal(metricPeriodLabel("2026-04"), "Apr 2026");
  assert.equal(metricPeriodShortLabel("2026-04"), "Apr");
  // Anything already unrecognisable is passed through rather than blanked.
  assert.equal(metricPeriodLabel("whenever"), "whenever");
});

test("snapshot metrics", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-metrics-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const { getDb, nowIso } = await import("../src/lib/db");
  const snapshot = await import("../src/lib/snapshot");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const client = (id: string) => {
    const now = nowIso();
    getDb()
      .prepare(`INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(id, `Client ${id}`, now, now);
    return id;
  };

  await t.test("an unreadable month is refused with a message that names it", () => {
    const id = client("met_bad");
    const result = snapshot.upsertMetric({
      clientId: id, metric: "Leads", period: "Q2 2026", value: 100,
    });
    assert.equal(result.ok, false);
    assert.match(result.error || "", /Q2 2026/);
    assert.match(result.error || "", /month/i);
    assert.equal(snapshot.listMetricsRaw(id).length, 0, "nothing was stored");
  });

  await t.test("a missing name or a non-numeric value is refused", () => {
    const id = client("met_blank");
    assert.equal(snapshot.upsertMetric({ clientId: id, metric: "  ", period: "2026-04", value: 1 }).ok, false);
    assert.equal(
      snapshot.upsertMetric({ clientId: id, metric: "Leads", period: "2026-04", value: Number.NaN }).ok,
      false
    );
    assert.equal(snapshot.listMetricsRaw(id).length, 0);
  });

  await t.test("differently written months are one point, not two", () => {
    const id = client("met_same");
    snapshot.upsertMetric({ clientId: id, metric: "Leads", period: "April 2026", value: 80 });
    snapshot.upsertMetric({ clientId: id, metric: "Leads", period: "2026-04", value: 82 });

    const raw = snapshot.listMetricsRaw(id);
    assert.equal(raw.length, 1, "the second write updated the first point");
    assert.equal(raw[0].period, "2026-04");
    assert.equal(raw[0].value, 82);
  });

  await t.test("a casing slip does not fork the series", () => {
    const id = client("met_case");
    snapshot.upsertMetric({ clientId: id, metric: "Leads", period: "2026-04", value: 80 });
    snapshot.upsertMetric({ clientId: id, metric: "leads", period: "2026-05", value: 104 });
    snapshot.upsertMetric({ clientId: id, metric: "LEADS", period: "2026-04", value: 82 });

    const series = snapshot.metricsSeries(id);
    assert.equal(series.length, 1, "one line on the chart, not three");
    assert.equal(series[0].points.length, 2);
    // The corrected April value won, rather than sitting beside the old one.
    assert.deepEqual(series[0].points, [
      { period: "2026-04", value: 82 },
      { period: "2026-05", value: 104 },
    ]);
  });

  await t.test("points come back in chronological order across a year boundary", () => {
    const id = client("met_order");
    // Written out of order and in mixed spellings, which is how a catch-up entry
    // session actually goes.
    snapshot.upsertMetric({ clientId: id, metric: "Revenue", period: "Jan 2027", value: 4 });
    snapshot.upsertMetric({ clientId: id, metric: "Revenue", period: "2026-11", value: 2 });
    snapshot.upsertMetric({ clientId: id, metric: "Revenue", period: "Dec 2026", value: 3 });
    snapshot.upsertMetric({ clientId: id, metric: "Revenue", period: "2026-02", value: 1 });

    const points = snapshot.metricsSeries(id)[0].points;
    assert.deepEqual(points.map((p) => p.period), ["2026-02", "2026-11", "2026-12", "2027-01"]);
    // The old text sort put "Jan 2027" ahead of "2026-11" and drew the trend
    // backwards through time.
    assert.deepEqual(points.map((p) => p.value), [1, 2, 3, 4]);
  });

  await t.test("the unit carries across the series once any point states it", () => {
    const id = client("met_unit");
    snapshot.upsertMetric({ clientId: id, metric: "Email Revenue", period: "2026-04", value: 31000, unit: "$" });
    snapshot.upsertMetric({ clientId: id, metric: "Email Revenue", period: "2026-05", value: 38500 });
    assert.equal(snapshot.metricsSeries(id)[0].unit, "$");
  });
});
