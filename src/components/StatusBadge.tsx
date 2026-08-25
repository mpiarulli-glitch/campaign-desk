"use client";

import type { CampaignStatus } from "@/lib/db";

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
  const internal = key === "approved" && approvedChannel === "internal";
  const label = internal ? "Approved internally" : LABELS[key] || status;
  return (
    <span
      className={`badge badge-${status}${internal ? " badge-approved-internal" : ""}`}
    >
      {label}
    </span>
  );
}
