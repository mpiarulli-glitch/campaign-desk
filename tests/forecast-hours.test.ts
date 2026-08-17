import assert from "node:assert/strict";
import test from "node:test";
import { minHoursForTodos, splitHours } from "../src/lib/forecast-hours";

test("splitHours shares a day across todos without losing tenths", () => {
  assert.deepEqual(splitHours(4, 1), [4]);
  assert.deepEqual(splitHours(4, 4), [1, 1, 1, 1]);
  assert.deepEqual(splitHours(4, 3), [1.4, 1.3, 1.3]);
  assert.deepEqual(splitHours(0.5, 2), [0.3, 0.2]);
  assert.equal(
    splitHours(4, 3).reduce((s, n) => s + n, 0),
    4
  );
});

test("splitHours refuses a split that would write a zero-hour row", () => {
  assert.deepEqual(splitHours(0.2, 4), [0.1, 0.1, 0, 0]);
  assert.equal(minHoursForTodos(4), 0.4);
  assert.deepEqual(splitHours(0, 3), []);
  assert.deepEqual(splitHours(2, 0), []);
});
