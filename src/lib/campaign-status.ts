// Operator-facing status choices. "Approved internally" is not a separate DB
// status — it is status "approved" plus approved_channel "internal" — but it
// has to appear as its own option wherever someone can pick a campaign status.
//
// `in_review` is client review ("Sent for approval"). Internal review is
// `internal_review`. Client "Needs Changes" is `needs_changes`. Internal
// feedback is `needs_revisions_internal`. Those pairs must stay distinct.
export const OPERATOR_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "internal_review", label: "Internal Review" },
  { value: "needs_revisions_internal", label: "Needs revisions (internal)" },
  { value: "approved_internally", label: "Approved Internally" },
  { value: "in_review", label: "Sent for approval" },
  { value: "needs_changes", label: "Needs Changes" },
  { value: "approved", label: "Approved" },
  { value: "scheduled", label: "Scheduled" },
  { value: "sent", label: "Sent" },
  { value: "live", label: "Live" },
] as const;

export type OperatorCampaignStatus =
  (typeof OPERATOR_STATUS_OPTIONS)[number]["value"];

// Plain groups for the campaigns list. The precise status still shows on each
// row; these only decide which rows a "where is this?" filter keeps.
// Needs Changes is in progress because the team is the one acting on the
// client's notes. Waiting on client is only "Sent for approval".
export type StatusBucketId = "in_progress" | "waiting" | "ready" | "sent";

export const STATUS_BUCKETS: {
  id: StatusBucketId;
  label: string;
  values: readonly OperatorCampaignStatus[];
}[] = [
  {
    id: "in_progress",
    label: "In progress",
    values: [
      "draft",
      "internal_review",
      "needs_revisions_internal",
      "approved_internally",
      "needs_changes",
    ],
  },
  {
    id: "waiting",
    label: "Waiting on client",
    values: ["in_review"],
  },
  {
    id: "ready",
    label: "Ready to send",
    values: ["approved", "scheduled"],
  },
  {
    id: "sent",
    label: "Sent",
    values: ["sent", "live"],
  },
];

export function statusBucketId(
  status: string,
  approvedChannel?: string | null
): StatusBucketId | null {
  const value = operatorStatusValue(status, approvedChannel);
  const bucket = STATUS_BUCKETS.find((b) =>
    (b.values as readonly string[]).includes(value)
  );
  return bucket?.id ?? null;
}

export function matchesStatusBucket(
  campaign: { status: string; approved_channel?: string | null },
  bucket: StatusBucketId | "all"
): boolean {
  if (bucket === "all") return true;
  return statusBucketId(campaign.status, campaign.approved_channel) === bucket;
}

// "open" is everything still moving, without Sent and Live. The list itself
// defaults to "all".
export type ListBucket = StatusBucketId | "open" | "all";

const LIST_STAGE_IDS: readonly ListBucket[] = [
  "all",
  "in_progress",
  "waiting",
  "ready",
];

// Sent and Live are finished work. They live on the Done page, not in the
// working list or on the board.
export function isDoneCampaignStatus(status: string): boolean {
  return status === "sent" || status === "live";
}

export function isDoneListStatus(status: string): boolean {
  if (isDoneCampaignStatus(status)) return true;
  return statusBucketId(status) === "sent";
}

export function matchesListBucket(
  campaign: { status: string; approved_channel?: string | null },
  bucket: ListBucket
): boolean {
  if (bucket === "all") return true;
  const id = statusBucketId(campaign.status, campaign.approved_channel);
  if (bucket === "open") return id != null && id !== "sent";
  return id === bucket;
}

// Older list links pass either a stage id (?status=open) or an exact stored
// status (?status=draft). This maps both onto the plain-language buckets.
// Sent and Live return null so the page can send them to Done.
// "open" is the same set as All now that finished work is not on this page.
export function listStageFromStatusParam(status: string): ListBucket | null {
  if (isDoneListStatus(status)) return null;
  if (status === "all" || status === "open") return "all";
  if ((LIST_STAGE_IDS as readonly string[]).includes(status)) {
    return status as ListBucket;
  }
  const bucket = statusBucketId(status);
  if (!bucket || bucket === "sent") return null;
  return bucket;
}

// Statuses the working campaigns list can filter by, in workflow order.
// Sent and Live stay on the Done page, so they are not choices here.
export const LIST_STATUS_OPTIONS = OPERATOR_STATUS_OPTIONS.filter(
  (option) => option.value !== "sent" && option.value !== "live"
);

export type ListStatusFilter =
  | "all"
  | (typeof LIST_STATUS_OPTIONS)[number]["value"];

export function isListStatusFilter(
  value: string
): value is Exclude<ListStatusFilter, "all"> {
  return LIST_STATUS_OPTIONS.some((option) => option.value === value);
}

// ?status= on the campaigns list. An exact workflow status selects that
// status. "all" and the older "open" alias select All. Sent and Live return
// "done" so the page can send them to Done. Stage ids from the short-lived
// stage menu are not statuses; the caller ignores them.
export function listStatusFromStatusParam(
  status: string
): ListStatusFilter | "done" | "ignore" {
  if (isDoneListStatus(status)) return "done";
  if (status === "all" || status === "open") return "all";
  if (isListStatusFilter(status)) return status;
  return "ignore";
}

// A recognized ?status= wins. A missing param, or a leftover stage id, falls
// through to the saved dropdown. Sent and Live stay "done".
export function resolveListStatusFilter(
  param: string | null,
  saved?: ListStatusFilter
): ListStatusFilter | "done" {
  if (param) {
    const parsed = listStatusFromStatusParam(param);
    if (parsed === "done") return "done";
    if (parsed !== "ignore") return parsed;
  }
  if (saved && saved !== "all") return saved;
  return "all";
}

// When a finished campaign went out. A past displayed send wins, then the
// stored schedule, then the last update (a manual Sent or Live mark).
export function doneSentInstant(input: {
  scheduled_send_at?: string | null;
  updated_at?: string | null;
  next_send_at?: string | null;
  next_send_upcoming?: boolean | null;
}): string | null {
  const next = input.next_send_at?.trim();
  if (next && !input.next_send_upcoming) return next;
  const scheduled = input.scheduled_send_at?.trim();
  if (scheduled) return scheduled;
  const updated = input.updated_at?.trim();
  return updated || null;
}

export function compareDoneNewestFirst(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? 1 : -1;
}

// One board column per in-progress approval stage, in operator order.
// Sent and Live are finished, so they are not columns here.
export const BOARD_COLUMNS: {
  id: string;
  label: string;
  values: readonly OperatorCampaignStatus[];
}[] = [
  { id: "draft", label: "Draft", values: ["draft"] },
  { id: "internal_review", label: "Internal review", values: ["internal_review"] },
  {
    id: "needs_revisions_internal",
    label: "Needs revisions",
    values: ["needs_revisions_internal"],
  },
  {
    id: "approved_internally",
    label: "Approved internally",
    values: ["approved_internally"],
  },
  { id: "in_review", label: "Sent for approval", values: ["in_review"] },
  { id: "needs_changes", label: "Needs changes", values: ["needs_changes"] },
  { id: "approved", label: "Approved", values: ["approved"] },
  { id: "scheduled", label: "Scheduled", values: ["scheduled"] },
];

export type BoardColumnId = (typeof BOARD_COLUMNS)[number]["id"];

export function boardColumnId(
  status: string,
  approvedChannel?: string | null
): BoardColumnId | null {
  const value = operatorStatusValue(status, approvedChannel);
  const column = BOARD_COLUMNS.find((col) =>
    (col.values as readonly string[]).includes(value)
  );
  return column?.id ?? null;
}

export function groupCampaignsByBoard<
  T extends { status: string; approved_channel?: string | null },
>(campaigns: T[]): { id: BoardColumnId; label: string; items: T[] }[] {
  const groups = BOARD_COLUMNS.map((col) => ({
    id: col.id,
    label: col.label,
    items: [] as T[],
  }));
  const byId = new Map(groups.map((group) => [group.id, group]));
  for (const campaign of campaigns) {
    const id = boardColumnId(campaign.status, campaign.approved_channel);
    if (id) byId.get(id)?.items.push(campaign);
  }
  return groups;
}

export type ReviewerChannel = "internal" | "external";

export const OPERATOR_STATUS_VALUES = OPERATOR_STATUS_OPTIONS.map(
  (o) => o.value
);

export function isOperatorCampaignStatus(
  value: string
): value is OperatorCampaignStatus {
  return OPERATOR_STATUS_OPTIONS.some((o) => o.value === value);
}

export function operatorStatusValue(
  status: string,
  approvedChannel?: string | null
): OperatorCampaignStatus | string {
  if (status === "approved" && approvedChannel === "internal") {
    return "approved_internally";
  }
  return status;
}

export function operatorStatusLabel(
  status: string,
  approvedChannel?: string | null
): string {
  const value = operatorStatusValue(status, approvedChannel);
  const opt = OPERATOR_STATUS_OPTIONS.find((o) => o.value === value);
  return opt?.label || status;
}

export function isInternallyApproved(
  status: string,
  approvedChannel?: string | null
): boolean {
  return (
    status === "approved_internally" ||
    (status === "approved" && approvedChannel === "internal")
  );
}

export function matchesCampaignStatusFilter(
  campaign: { status: string; approved_channel?: string | null },
  filter: string
): boolean {
  if (filter === "all") return true;
  if (filter === "approved_internally") {
    return isInternallyApproved(campaign.status, campaign.approved_channel);
  }
  if (filter === "approved") {
    return (
      campaign.status === "approved" && campaign.approved_channel !== "internal"
    );
  }
  return campaign.status === filter;
}

export function storedStatusForOperatorChoice(
  next: OperatorCampaignStatus
): Exclude<OperatorCampaignStatus, "approved_internally"> {
  return next === "approved_internally" ? "approved" : next;
}

// Opening a review link must never mark the package as sent to the client.
// "Sent for approval" is written only when the Basecamp client-approval send
// succeeds. The internal token from draft becomes Internal Review so a
// Basecamp unfurl of the AM to-do cannot land on in_review.
export function statusAfterReviewLinkView(
  status: string,
  channel: ReviewerChannel
): string | null {
  if (channel === "internal" && status === "draft") return "internal_review";
  return null;
}

const INTERNAL_REVISION_FROM = new Set([
  "draft",
  "internal_review",
  "needs_revisions_internal",
]);

const CLIENT_REVISION_FROM = new Set([
  "draft",
  "in_review",
  "needs_changes",
  "internal_review",
  "needs_revisions_internal",
]);

// Internal-link comments stay on the internal workflow. Client-link comments
// become Needs Changes. Do not pull a package that is already with the client
// (in_review / needs_changes) back to internal revisions just because the
// team also left a note on the internal link.
export function statusAfterReviewerComment(
  status: string,
  channel: ReviewerChannel
): string | null {
  if (channel === "internal") {
    return INTERNAL_REVISION_FROM.has(status)
      ? "needs_revisions_internal"
      : null;
  }
  return CLIENT_REVISION_FROM.has(status) ? "needs_changes" : null;
}

export function statusAfterMarkRevisionDone(status: string): string {
  if (status === "needs_revisions_internal" || status === "internal_review") {
    return "internal_review";
  }
  return "in_review";
}
