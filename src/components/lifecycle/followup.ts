"use client";

export async function postCampaignFollowup(campaignId: string): Promise<{
  ok: boolean;
  error?: string;
  recipient?: string;
  followupCount?: number;
  followupLastAt?: string | null;
}> {
  const res = await fetch(`/api/campaigns/${campaignId}/basecamp-followup`, {
    method: "POST",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data.error || "Could not post the follow-up." };
  }
  return {
    ok: true,
    recipient: data.recipient,
    followupCount:
      typeof data.followupCount === "number" ? data.followupCount : undefined,
    followupLastAt:
      typeof data.followupLastAt === "string" ? data.followupLastAt : null,
  };
}
