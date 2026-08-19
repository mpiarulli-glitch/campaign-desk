import assert from "node:assert/strict";
import test from "node:test";

test("editorial calendar status filter", async () => {
  const { sendMatchesStatusFilter } = await import("../src/lib/calendar-status-filter");

  assert.equal(sendMatchesStatusFilter("planned", []), true);
  assert.equal(sendMatchesStatusFilter("sent", []), true);

  assert.equal(sendMatchesStatusFilter("planned", ["planned"]), true);
  assert.equal(sendMatchesStatusFilter("scheduled", ["planned"]), false);
  assert.equal(sendMatchesStatusFilter("requested", ["requested", "planned"]), true);
  assert.equal(sendMatchesStatusFilter("sent", ["requested", "planned"]), false);
});
