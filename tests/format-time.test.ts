import assert from "node:assert/strict";
import test from "node:test";
import { formatAppDate, formatAppDateTime, formatAppDay } from "../src/lib/format-time";

test("a Pacific evening is not labelled as the next UTC morning", () => {
  // 8:00 PM Pacific on Nov 18 is 04:00 UTC on Nov 19.
  assert.equal(formatAppDate("2026-11-19T04:00:00.000Z"), "Nov 18, 2026");
  assert.equal(formatAppDay("2026-11-19T04:00:00.000Z"), "Nov 18");
  assert.equal(formatAppDateTime("2026-11-19T04:00:00.000Z"), "Nov 18, 2026, 8:00 PM PT");
});

test("just after Pacific midnight stays on that date", () => {
  // 12:30 AM Pacific on Nov 19 is 08:30 UTC.
  assert.equal(formatAppDateTime("2026-11-19T08:30:00.000Z"), "Nov 19, 2026, 12:30 AM PT");
});

test("blank and unreadable instants stay blank", () => {
  assert.equal(formatAppDate(""), "");
  assert.equal(formatAppDateTime(null), "");
  assert.equal(formatAppDay("not-a-date"), "");
});
