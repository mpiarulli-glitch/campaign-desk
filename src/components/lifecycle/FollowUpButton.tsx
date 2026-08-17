"use client";

import { useState } from "react";
import { postCampaignFollowup } from "./followup";

export function FollowUpButton({
  campaignId,
  className = "hud-btn",
  onDone,
  onError,
}: {
  campaignId: string;
  className?: string;
  onDone?: (recipient?: string) => void;
  onError?: (error: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function send(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy || done) return;
    setBusy(true);
    const result = await postCampaignFollowup(campaignId);
    setBusy(false);
    if (!result.ok) {
      onError?.(result.error || "Could not post the follow-up.");
      return;
    }
    setDone(true);
    onDone?.(result.recipient);
  }

  return (
    <button type="button" className={className} onClick={send} disabled={busy || done}>
      {busy ? "Sending…" : done ? "Follow-up sent" : "Follow-up with client"}
    </button>
  );
}
