import assert from "node:assert/strict";
import test from "node:test";

import {
  normSnapshotStatus,
  SNAPSHOT_BEHIND_DONE_STATUSES,
  SNAPSHOT_FILL_OPEN_STATUSES,
  SNAPSHOT_STATUSES,
  snapshotStatusLabel,
} from "../src/lib/snapshot-status";

test("snapshot status registry includes new workflow states", () => {
  const values = SNAPSHOT_STATUSES.map((s) => s.value);
  assert.deepEqual(values, [
    "not_started",
    "in_progress",
    "scheduled",
    "sent_for_approval",
    "completed",
    "shared",
    "approved",
    "canceled",
  ]);
  assert.equal(snapshotStatusLabel("sent_for_approval"), "Sent for approval");
  assert.equal(snapshotStatusLabel("scheduled"), "Scheduled");
  assert.equal(snapshotStatusLabel("canceled"), "Canceled");
});

test("normSnapshotStatus falls back safely", () => {
  assert.equal(normSnapshotStatus("scheduled"), "scheduled");
  assert.equal(normSnapshotStatus("bogus"), "not_started");
});

test("open vs behind-done status buckets", () => {
  assert.equal(SNAPSHOT_FILL_OPEN_STATUSES.includes("scheduled"), true);
  assert.equal(SNAPSHOT_FILL_OPEN_STATUSES.includes("sent_for_approval"), false);
  assert.equal(SNAPSHOT_BEHIND_DONE_STATUSES.includes("canceled"), true);
  assert.equal(SNAPSHOT_BEHIND_DONE_STATUSES.includes("sent_for_approval"), false);
});
