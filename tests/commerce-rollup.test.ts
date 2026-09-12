import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("commerceRollupForRange sums ecommerce orders and revenue by month window", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cd-commerce-"));
  process.env.DATABASE_PATH = path.join(dir, "test.sqlite");

  const { createRevClient, upsertMetric, commerceRollupForRange } = await import(
    "../src/lib/revenue"
  );

  const client = createRevClient({
    name: "DTC Co",
    businessModel: "ecomm",
  });

  upsertMetric({
    clientId: client.id,
    month: "2026-07",
    revenue: 1000,
    orders: 10,
    revenueSource: "klaviyo",
  });
  upsertMetric({
    clientId: client.id,
    month: "2026-08",
    revenue: 2500,
    orders: 20,
    revenueSource: "klaviyo",
  });
  upsertMetric({
    clientId: client.id,
    month: "2026-09",
    revenue: 500,
    orders: 5,
    revenueSource: "manual",
  });

  const rollup = commerceRollupForRange(client.id, "2026-08-01", "2026-08-31");
  assert.equal(rollup.orders, 20);
  assert.equal(rollup.revenue, 2500);
  assert.equal(rollup.aov, 125);
  assert.equal(rollup.months, 1);
  assert.equal(rollup.revenueSource, "klaviyo");

  const wider = commerceRollupForRange(client.id, "2026-07-15", "2026-09-10");
  assert.equal(wider.orders, 35);
  assert.equal(wider.revenue, 4000);
  assert.equal(wider.months, 3);
  assert.equal(wider.revenueSource, "mixed");
});
