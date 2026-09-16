// Shared wording for the activity feed. Kept out of campaigns.ts so client
// components can use it without pulling in sqlite.

export function approvalActivityParts(item: {
  client_name?: string | null;
  actor?: string | null;
  campaign_title: string;
  approved_channel?: string | null;
}): { actor: string; rest: string } {
  if (item.approved_channel === "internal") {
    return {
      actor: item.actor?.trim() || "Someone",
      rest: `approved ${item.campaign_title} internally`,
    };
  }
  return {
    actor: item.client_name?.trim() || item.actor?.trim() || "Client",
    rest: `approved ${item.campaign_title}`,
  };
}

export function approvalActivitySummary(item: {
  client_name?: string | null;
  actor?: string | null;
  campaign_title: string;
  approved_channel?: string | null;
}): string {
  const parts = approvalActivityParts(item);
  return `${parts.actor} ${parts.rest}`;
}

export function followupActivityParts(item: {
  client_name?: string | null;
  body?: string | null;
  followup_kind?: "internal" | "external" | null;
  waiting_days?: number | null;
}): { actor: string; rest: string } {
  const waiting =
    item.waiting_days != null
      ? item.waiting_days === 1
        ? "1 day"
        : `${item.waiting_days} days`
      : null;
  const where =
    item.followup_kind === "internal"
      ? "internal review"
      : item.followup_kind === "external"
        ? "client approval"
        : item.body || "pending approval";
  const client = item.client_name?.trim();
  const rest = client
    ? waiting
      ? `on ${client}'s ${where} · ${waiting}`
      : `on ${client}'s ${where}`
    : waiting
      ? `on ${where} · ${waiting}`
      : `on ${where}`;
  return { actor: "Follow up", rest };
}
