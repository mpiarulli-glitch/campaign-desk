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
