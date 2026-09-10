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

/**
 * Client-facing "we delivered it" states. Scheduled, shared-not-approved,
 * and approved all count. `sent_for_approval` is a distinct internal state
 * and does not count.
 */
export const SNAPSHOT_MET_STATUSES: SnapshotStatus[] = [
  "scheduled",
  "completed",
  "shared",
  "approved",
];

/** Statuses that count as finished for overdue / behind reporting. */
export const SNAPSHOT_BEHIND_DONE_STATUSES: SnapshotStatus[] = [
  ...SNAPSHOT_MET_STATUSES,
  "canceled",
];

export function isSnapshotContractMet(status: string): boolean {
  return (SNAPSHOT_MET_STATUSES as readonly string[]).includes(status);
}

const MET_RANK: Record<"completed" | "scheduled" | "shared" | "approved", number> = {
  completed: 1,
  scheduled: 2,
  shared: 3,
  approved: 4,
};

/**
 * If work-done / notes already say the client got the work, pick the matching
 * met-contract status. Next-steps are ignored (those are plans, not delivery).
 * Returns null when the text is empty, still in progress, or only "waiting".
 */
export function inferContractMetFromNotes(
  ...parts: Array<string | null | undefined>
): SnapshotStatus | null {
  const text = parts
    .map((p) => (p || "").trim())
    .filter(Boolean)
    .join("\n");
  if (!text) return null;

  const n = text
    .toLowerCase()
    .replace(/[—–]/g, "-")
    .replace(/\bschedled\b/g, "scheduled");

  const has = (re: RegExp) => re.test(n);
  let hit: SnapshotStatus | null = null;
  const bump = (s: keyof typeof MET_RANK) => {
    if (!hit || MET_RANK[s] > MET_RANK[hit as keyof typeof MET_RANK]) hit = s;
  };

  const waitingApproval = has(
    /\b(pending|waiting|awaiting)\s+approval\b|\bnot yet approved\b|\bsend(?:t)?(?:\s+content)?\s+for approval\b/
  );
  const approvedDelivery =
    has(/\bshare[d]?\s*(&|and)\s*approved\b/) ||
    has(/\bclient approved\b/) ||
    has(/\bapproved by (?:the )?client\b/) ||
    has(/\bgraphics approved\b/) ||
    (has(/\bapproved\b/) &&
      !has(/\b(pending|waiting|awaiting|for) approval\b/) &&
      !has(/\bsend(?:t)?(?:\s+content)?\s+for approval\b/));
  if (approvedDelivery) bump("approved");

  if (
    has(/\bshared\b/) ||
    has(/\bnot yet approved\b/) ||
    has(/\bsent to (?:the )?client\b/) ||
    has(/\bemailed to (?:the )?client\b/)
  ) {
    bump("shared");
  }

  if (has(/\bscheduled?(?:\s+out)?\b/)) bump("scheduled");

  if (
    has(/\bcompleted\b/) ||
    has(/\bdelivered\b/) ||
    has(/\bpublished\b/) ||
    has(/\bpublish\b/) ||
    has(/\bposted\b/) ||
    has(/\blaunched\b/) ||
    has(/\blaunch\b/) ||
    has(/\binstalled\b/) ||
    has(/\bwent live\b/) ||
    has(/\baudit generated\b/) ||
    (has(/\bcomplete\b/) && !has(/\bcomplete rebuild\b/))
  ) {
    bump("completed");
  }

  if (!hit) return null;
  if (
    waitingApproval &&
    hit !== "approved" &&
    hit !== "shared" &&
    hit !== "scheduled"
  ) {
    return null;
  }
  return hit;
}

/** Keep an explicit met/canceled status; otherwise lift from notes. */
export function coalesceEntryStatus(
  current: string | null | undefined,
  workDone?: string | null,
  notes?: string | null
): SnapshotStatus {
  const cur = normSnapshotStatus(current);
  if (isSnapshotContractMet(cur) || cur === "canceled") return cur;
  return inferContractMetFromNotes(workDone, notes) ?? cur;
}

const STATUS_VALUES = new Set<string>(SNAPSHOT_STATUSES.map((s) => s.value));

export function normSnapshotStatus(v: unknown): SnapshotStatus {
  return STATUS_VALUES.has(v as string) ? (v as SnapshotStatus) : "not_started";
}

export function snapshotStatusLabel(status: SnapshotStatus): string {
  return SNAPSHOT_STATUSES.find((s) => s.value === status)?.label ?? status;
}

/**
 * Client "this week's work" — only rows actually filed on the week being viewed.
 * One-off setups from months ago stay completed on the contract list, not here.
 */
export function isThisWeeksWork(row: {
  week_start?: string | null;
  status: string;
  work_done?: string | null;
  next_steps?: string | null;
  notes?: string | null;
}, viewWeek: string): boolean {
  if (!row.week_start || row.week_start !== viewWeek) return false;
  return (
    row.status !== "not_started" ||
    !!(row.work_done || "").trim() ||
    !!(row.next_steps || "").trim() ||
    !!(row.notes || "").trim()
  );
}
