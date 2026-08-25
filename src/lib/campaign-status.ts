// Operator-facing status choices. "Approved internally" is not a separate DB
// status — it is status "approved" plus approved_channel "internal" — but it
// has to appear as its own option wherever someone can pick a campaign status.
export const OPERATOR_STATUS_VALUES = [
  "draft",
  "internal_review",
  "in_review",
  "needs_changes",
  "approved_internally",
  "approved",
  "scheduled",
  "sent",
] as const;

export type OperatorCampaignStatus = (typeof OPERATOR_STATUS_VALUES)[number];

export const OPERATOR_STATUS_OPTIONS: {
  value: OperatorCampaignStatus;
  label: string;
}[] = [
  { value: "draft", label: "Draft" },
  { value: "internal_review", label: "Internal review" },
  { value: "in_review", label: "In review" },
  { value: "needs_changes", label: "Needs changes" },
  { value: "approved_internally", label: "Approved internally" },
  { value: "approved", label: "Approved" },
  { value: "scheduled", label: "Scheduled" },
  { value: "sent", label: "Sent" },
];

export function isOperatorCampaignStatus(
  value: string
): value is OperatorCampaignStatus {
  return (OPERATOR_STATUS_VALUES as readonly string[]).includes(value);
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
