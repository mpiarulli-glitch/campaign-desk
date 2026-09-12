import assert from "node:assert/strict";
import test from "node:test";
import {
  assembleListGrowthStats,
  buildListGrowthWeekBuckets,
} from "../src/lib/ghl-conversion-analytics";

test("buildListGrowthWeekBuckets starts on Monday and covers the range", () => {
  // 2026-09-02 is a Wednesday → bucket should start Monday 2026-08-31
  const buckets = buildListGrowthWeekBuckets("2026-09-02", "2026-09-20");
  assert.equal(buckets[0]?.weekStart, "2026-08-31");
  assert.ok(buckets.length >= 3);
  assert.equal(buckets.at(-1)?.weekStart, "2026-09-14");
  for (const b of buckets) {
    assert.equal(b.contactsAdded, 0);
    assert.equal(b.unsubscribed, 0);
    assert.ok(b.label.length > 0);
  }
});

test("assembleListGrowthStats buckets joins vs unsubs by week", () => {
  const stats = assembleListGrowthStats(
    "2026-09-01",
    "2026-09-14",
    ["2026-09-01", "2026-09-02", "2026-09-08"],
    [
      { at: "2026-09-03T16:00:00.000Z", count: 2 },
      { at: "2026-09-10T16:00:00.000Z", count: 1 },
      { at: null, count: 4 }, // counted in total, not in a week bar
    ],
    100
  );

  assert.equal(stats.contactsAdded, 3);
  assert.equal(stats.unsubscribed, 7);
  assert.equal(stats.net, -4);
  assert.equal(stats.unsubscribeRate, 7);
  assert.equal(stats.error, null);

  const first = stats.series.find((b) => b.weekStart === "2026-08-31");
  const second = stats.series.find((b) => b.weekStart === "2026-09-07");
  assert.ok(first);
  assert.ok(second);
  assert.equal(first!.contactsAdded, 2);
  assert.equal(first!.unsubscribed, 2);
  assert.equal(second!.contactsAdded, 1);
  assert.equal(second!.unsubscribed, 1);
});

test("assembleListGrowthStats puts total-only contacts on the first bar", () => {
  const stats = assembleListGrowthStats(
    "2026-09-01",
    "2026-09-07",
    [],
    [],
    50,
    12
  );
  assert.equal(stats.contactsAdded, 12);
  assert.equal(stats.series[0]?.contactsAdded, 12);
  assert.equal(stats.unsubscribeRate, 0);
});
