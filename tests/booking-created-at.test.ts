import assert from "node:assert/strict";
import test from "node:test";
import { bookingCreatedAt } from "../src/lib/ghl-conversion-analytics";

test("booking credit uses the created time, not the appointment start", () => {
  const created = bookingCreatedAt({
    dateAdded: "2026-10-13T15:02:00.000Z",
    startTime: "2026-10-20T17:00:00.000Z",
  });
  assert.equal(created, "2026-10-13T15:02:00.000Z");
});

test("a missing created time does not fall back to the appointment start", () => {
  assert.equal(
    bookingCreatedAt({
      startTime: "2026-10-20T17:00:00.000Z",
      endTime: "2026-10-20T18:00:00.000Z",
    }),
    null
  );
});
