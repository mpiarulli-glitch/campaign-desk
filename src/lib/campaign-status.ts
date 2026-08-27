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
] as const;

export type OperatorCampaignStatus =
  (typeof OPERATOR_STATUS_OPTIONS)[number]["value"];

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
