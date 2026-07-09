"use client";

import type { CampaignStatus } from "@/lib/db";

const LABELS: Record<CampaignStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  needs_changes: "Needs changes",
  approved: "Approved",
};

export function StatusBadge({ status }: { status: CampaignStatus | string }) {
  const key = status as CampaignStatus;
  const label = LABELS[key] || status;
  return <span className={`badge badge-${status}`}>{label}</span>;
}
