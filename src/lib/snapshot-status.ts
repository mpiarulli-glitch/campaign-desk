/** Snapshot deliverable entry statuses — shared by fill desk, backfill, and client view. */

export type SnapshotStatus =
  | "not_started"
  | "in_progress"
  | "scheduled"
  | "sent_for_approval"
  | "completed"
  | "shared"
  | "approved"
  | "canceled";

export const SNAPSHOT_STATUSES: { value: SnapshotStatus; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "scheduled", label: "Scheduled" },
  { value: "sent_for_approval", label: "Sent for approval" },
  { value: "completed", label: "Completed" },
  { value: "shared", label: "Shared — awaiting approval" },
  { value: "approved", label: "Approved" },
  { value: "canceled", label: "Canceled" },
];

export const SNAPSHOT_STATUS_SHORT: Record<SnapshotStatus, string> = {
  not_started: "—",
  in_progress: "WIP",
  scheduled: "Sched",
  sent_for_approval: "Sent",
  completed: "Done",
  shared: "Shared",
  approved: "OK",
  canceled: "X",
};

/** Statuses that still need team attention on the weekly fill pass. */
export const SNAPSHOT_FILL_OPEN_STATUSES: SnapshotStatus[] = [
  "not_started",
  "in_progress",
  "scheduled",
];

/** Statuses that count as finished for overdue / behind reporting. */
export const SNAPSHOT_BEHIND_DONE_STATUSES: SnapshotStatus[] = [
  "completed",
  "approved",
  "canceled",
];

const STATUS_VALUES = new Set<string>(SNAPSHOT_STATUSES.map((s) => s.value));

export function normSnapshotStatus(v: unknown): SnapshotStatus {
  return STATUS_VALUES.has(v as string) ? (v as SnapshotStatus) : "not_started";
}

export function snapshotStatusLabel(status: SnapshotStatus): string {
  return SNAPSHOT_STATUSES.find((s) => s.value === status)?.label ?? status;
}
