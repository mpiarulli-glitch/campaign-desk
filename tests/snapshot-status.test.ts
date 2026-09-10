import assert from "node:assert/strict";
import test from "node:test";

import {
  coalesceEntryStatus,
  inferContractMetFromNotes,
  isSnapshotContractMet,
  isThisWeeksWork,
  normSnapshotStatus,
  SNAPSHOT_BEHIND_DONE_STATUSES,
  SNAPSHOT_FILL_OPEN_STATUSES,
  SNAPSHOT_MET_STATUSES,
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
  assert.equal(SNAPSHOT_BEHIND_DONE_STATUSES.includes("scheduled"), true);
  assert.equal(SNAPSHOT_BEHIND_DONE_STATUSES.includes("shared"), true);
  assert.equal(SNAPSHOT_BEHIND_DONE_STATUSES.includes("sent_for_approval"), false);
});

test("contract-met statuses are the client-facing delivered states", () => {
  assert.deepEqual(SNAPSHOT_MET_STATUSES, ["scheduled", "completed", "shared", "approved"]);
  assert.equal(isSnapshotContractMet("scheduled"), true);
  assert.equal(isSnapshotContractMet("completed"), true);
  assert.equal(isSnapshotContractMet("shared"), true);
  assert.equal(isSnapshotContractMet("approved"), true);
  assert.equal(isSnapshotContractMet("sent_for_approval"), false);
  assert.equal(isSnapshotContractMet("canceled"), false);
  assert.equal(isSnapshotContractMet("in_progress"), false);
  assert.equal(isSnapshotContractMet("not_started"), false);
});

test("notes can lift a forgotten status to met contract", () => {
  assert.equal(inferContractMetFromNotes("Keyword Research Completed"), "completed");
  assert.equal(inferContractMetFromNotes("Installed Empire Cookies"), "completed");
  assert.equal(inferContractMetFromNotes("Launch Business Directories"), "completed");
  assert.equal(inferContractMetFromNotes("Publish approved post"), "approved");
  assert.equal(
    inferContractMetFromNotes("Graphics approved by default, Schedled out until 17th"),
    "approved"
  );
  assert.equal(inferContractMetFromNotes("Client approved design · Development in progress"), "approved");
  assert.equal(inferContractMetFromNotes("Wk3: CRO Audit generated"), "completed");
  assert.equal(inferContractMetFromNotes("shared with the client"), "shared");
  assert.equal(inferContractMetFromNotes(""), null);
  assert.equal(inferContractMetFromNotes("Need from Client", "Pending from client"), null);
  assert.equal(inferContractMetFromNotes("Working on quote follow-up nurture"), null);
  assert.equal(inferContractMetFromNotes("Content Waiting Approval"), null);
  assert.equal(
    inferContractMetFromNotes("Tunred on B2C campaings after complete rebuild"),
    null
  );
  assert.equal(coalesceEntryStatus("not_started", "Posted 4 reels", ""), "completed");
  assert.equal(coalesceEntryStatus("in_progress", "Scheduled out until the 17th", ""), "scheduled");
  assert.equal(coalesceEntryStatus("approved", "still working", ""), "approved");
  assert.equal(coalesceEntryStatus("canceled", "Posted anyway", ""), "canceled");
});

test("this week's work ignores one-off setups logged in earlier weeks", () => {
  const july = {
    week_start: "2026-07-13",
    created_at: "2026-07-15T00:00:00.000Z",
    kind: "one_time",
    status: "completed",
    work_done: "Automations live",
    next_steps: "",
    notes: "",
  };
  assert.equal(isThisWeeksWork(july, "2026-09-08"), false);
  assert.equal(
    isThisWeeksWork(july, "2026-07-13"),
    true,
    "setup done that week belongs in this week's work"
  );
  assert.equal(
    isThisWeeksWork({ week_start: "", status: "completed", work_done: "x" }, "2026-09-08"),
    false
  );
  assert.equal(
    isThisWeeksWork(
      {
        week_start: "2026-09-08",
        created_at: "2026-08-28T00:00:00.000Z",
        kind: "recurring",
        status: "in_progress",
        work_done: "SEO pass",
      },
      "2026-09-08"
    ),
    false,
    "restamped older row is not this week"
  );
  assert.equal(
    isThisWeeksWork(
      {
        week_start: "2026-09-08",
        created_at: "2026-09-09T12:00:00.000Z",
        kind: "one_time",
        status: "completed",
        work_done: "CRM live",
      },
      "2026-09-08"
    ),
    true,
    "new-account setup logged this week still shows"
  );
});
