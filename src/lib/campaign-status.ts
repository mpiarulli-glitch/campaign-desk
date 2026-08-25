// Operator-facing status choices. "Approved internally" is not a separate DB
// status — it is status "approved" plus approved_channel "internal" — but it
// has to appear as its own option wherever someone can pick a campaign status.
//
// `in_review` is client review ("Sent for approval"). Internal review is
// `internal_review`. Those two must stay distinct.
export const OPERATOR_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "internal_review", label: "Internal Review" },
  { value: "approved_internally", label: "Approved Internally" },
  { value: "in_review", label: "Sent for approval" },
  { value: "needs_changes", label: "Needs Changes" },
  { value: "approved", label: "Approved" },
  { value: "scheduled", label: "Scheduled" },
  { value: "sent", label: "Sent" },
] as const;

export type OperatorCampaignStatus =
  (typeof OPERATOR_STATUS_OPTIONS)[number]["value"];

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
