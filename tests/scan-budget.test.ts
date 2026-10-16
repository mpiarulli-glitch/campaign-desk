import assert from "node:assert/strict";
import test from "node:test";
import {
  mapWithBudget,
  SCAN_BUDGET_MS,
  SCAN_TIME_LIMIT_ERROR,
  scanHasPending,
} from "../src/lib/scan-budget";

test("portfolio scan answers before Railway's 5-minute silent cutoff", () => {
  assert.ok(SCAN_BUDGET_MS < 300_000);
  assert.ok(SCAN_BUDGET_MS >= 60_000);
  assert.match(SCAN_TIME_LIMIT_ERROR, /time limit/);
});

test("mapWithBudget returns finished accounts instead of waiting out the cutoff", async () => {
  const started = Date.now();
  const scan = mapWithBudget(
    ["fast", "slow"],
    2,
    async (name) => {
      await new Promise((resolve) =>
        setTimeout(resolve, name === "fast" ? 30 : 500)
      );
      return name;
    },
    120
  );
  const raced = await scan.withinBudget;
  assert.equal(raced.timedOut, true);
  assert.ok(Date.now() - started < 400);
  assert.equal(raced.values[0], "fast");
  assert.equal(raced.values[1], undefined);
  assert.equal(scanHasPending(raced.values, 2), true);
  assert.deepEqual([...(await scan.all)], ["fast", "slow"]);
});

test("mapWithBudget returns every account when the scan finishes in time", async () => {
  const scan = mapWithBudget([1, 2, 3], 2, async (n) => n * 2, 500);
  const raced = await scan.withinBudget;
  assert.equal(raced.timedOut, false);
  assert.deepEqual(raced.values, [2, 4, 6]);
});
