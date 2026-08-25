"use client";

import type { CampaignStatus } from "@/lib/db";
import { isInternallyApproved } from "@/lib/campaign-status";

const LABELS: Record<CampaignStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  needs_changes: "Needs changes",
  approved: "Approved",
  scheduled: "Scheduled",
  sent: "Sent",
};

export function StatusBadge({
  status,
  approvedChannel,
}: {
  status: CampaignStatus | string;
  approvedChannel?: string | null;
}) {
  const key = status as CampaignStatus;
  const internal = isInternallyApproved(status, approvedChannel);
  const label = internal ? "Approved internally" : LABELS[key] || status;
  return (
    <span
      className={`badge badge-${internal ? "approved" : status}${internal ? " badge-approved-internal" : ""}`}
    >
      {label}
    </span>
  );
}
