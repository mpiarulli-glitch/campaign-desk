"use client";

import type { CampaignStatus } from "@/lib/db";
import {
  isInternallyApproved,
  operatorStatusLabel,
} from "@/lib/campaign-status";

export function StatusBadge({
  status,
  approvedChannel,
}: {
  status: CampaignStatus | string;
  approvedChannel?: string | null;
}) {
  const internal = isInternallyApproved(status, approvedChannel);
  const label = operatorStatusLabel(status, approvedChannel);
  return (
    <span
      className={`badge badge-${internal ? "approved" : status}${internal ? " badge-approved-internal" : ""}`}
    >
      {label}
    </span>
  );
}
