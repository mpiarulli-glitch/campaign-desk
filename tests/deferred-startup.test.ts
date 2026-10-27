import assert from "node:assert/strict";
import { after, mock, test } from "node:test";
import {
  DEFERRED_STARTUP_DELAY_MS,
  deferredStartupInflight,
  enqueueDeferredStartupJob,
  resetDeferredStartupForTests,
} from "../src/lib/deferred-startup";

after(() => {
  mock.timers.reset();
  resetDeferredStartupForTests();
});

test("deferred startup waits 30-60s and a failed job does not stop the next one", async () => {
  resetDeferredStartupForTests();
  assert.ok(DEFERRED_STARTUP_DELAY_MS >= 30_000);
  assert.ok(DEFERRED_STARTUP_DELAY_MS <= 60_000);

  mock.timers.enable({ apis: ["setTimeout"] });
  const order: string[] = [];
  enqueueDeferredStartupJob("boom", async () => {
    order.push("boom");
    throw new Error("nope");
  });
  enqueueDeferredStartupJob("ok", async () => {
    order.push("ok");
  });

  assert.deepEqual(order, []);
  mock.timers.tick(DEFERRED_STARTUP_DELAY_MS - 1);
  assert.equal(deferredStartupInflight(), null);
  assert.deepEqual(order, []);

  mock.timers.tick(1);
  const pending = deferredStartupInflight();
  assert.ok(pending);
  await pending;
  assert.deepEqual(order, ["boom", "ok"]);
});
