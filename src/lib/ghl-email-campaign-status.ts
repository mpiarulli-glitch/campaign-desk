/**
 * Pure helpers for GHL campaign send status — safe for client components.
 * Keep this file free of Node / DB / GHL API imports.
 *
 * Accuracy rules:
 * - Audience size (totalCount) is never "sent" for scheduled / queued blasts.
 * - GHL often echoes audience size into stats.sent before anything mails —
 *   scheduled/pending/queued status always wins over that echo.
 * - Open-rate averages only include rows with real send volume, stats, and at
 *   least one engagement signal (open / click / bounce / unsub). Pure-zero
 *   "sends" are almost always unsent audience stamps, not real 0% campaigns.
 */

export function isGhlCampaignNotYetSent(status: string): boolean {
  const s = status.toLowerCase();
  return (
    s.includes("schedul") ||
    s.includes("pending") ||
    s.includes("process") ||
    s.includes("queue") ||
    s === "draft"
  );
}

/** Strictly queued — not mid-flight processing. */
export function isGhlCampaignQueuedStatus(status: string): boolean {
  const s = status.toLowerCase();
  return (
    s.includes("schedul") ||
    s.includes("pending") ||
    s.includes("queue") ||
    s === "draft"
  );
}

export function isGhlCampaignDeadStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s.includes("cancel") || s.includes("paus") || s === "draft";
}

/** @deprecated Prefer isGhlCampaignDeadStatus + sent checks; kept for call sites. */
export function isGhlCampaignExcludedFromTotals(status: string): boolean {
  return isGhlCampaignDeadStatus(status) || isGhlCampaignNotYetSent(status);
}

/**
 * Resolve how many emails actually went out.
 *
 * @param hasStats - true when GHL returned a stats payload (even if sent is 0)
 * @param engagement - opens+clicks+bounces+unsubs; when 0, audience-sized
 *   stats.sent is treated as an unsent stamp (Ecoworkz scheduled case)
 */
export function resolveGhlCampaignSentCount(
  status: string,
  statsSent: number,
  audienceTotal: number,
  hasStats = false,
  engagement = -1
): number {
  if (isGhlCampaignDeadStatus(status)) return 0;

  // Queued / scheduled: NEVER trust stats.sent — GHL echoes audience size
  // (e.g. 6443) with 0 opens and tanks averages.
  if (isGhlCampaignQueuedStatus(status)) return 0;

  // Mid-flight processing may have real partial sends.
  if (statsSent > 0) {
    // Audience stamp: status says complete/sent but every engagement counter
    // is still 0 and "sent" equals (or exceeds) the audience size. That is
    // how GHL presents not-yet-mailed September package blasts.
    if (
      engagement === 0 &&
      audienceTotal > 0 &&
      statsSent >= audienceTotal
    ) {
      return 0;
    }
    return statsSent;
  }

  if (isGhlCampaignNotYetSent(status)) return 0;

  // Stats payload exists and reports zero — trust it (don't use audience).
  if (hasStats) return 0;

  // Completed-looking but no stats yet: do not invent volume from audience.
  void audienceTotal;
  return 0;
}

function engagementCount(row: {
  opened?: number;
  clicked?: number;
  bounced?: number;
  unsubscribed?: number;
}): number {
  return (
    (row.opened ?? 0) +
    (row.clicked ?? 0) +
    (row.bounced ?? 0) +
    (row.unsubscribed ?? 0)
  );
}

/**
 * Whether a campaign row should roll into open / click / sent averages.
 *
 * Requires real send volume, a stats payload, and at least one engagement
 * signal so audience-stamped scheduled blasts (6443 sent / 0% open) cannot
 * dilute averages — even when GHL mislabels status as complete.
 */
export function campaignCountsInEmailTotals(row: {
  status: string;
  sent: number;
  statsAvailable?: boolean;
  opened?: number;
  clicked?: number;
  bounced?: number;
  unsubscribed?: number;
}): boolean {
  if (isGhlCampaignDeadStatus(row.status)) return false;
  if (isGhlCampaignQueuedStatus(row.status)) return false;
  if (row.sent <= 0) return false;
  if (row.statsAvailable === false) return false;
  // No opens/clicks/bounces/unsubs at all → not a usable engagement sample.
  if (engagementCount(row) <= 0) return false;
  return true;
}

/**
 * Whether a campaign/flow can receive conversion credit.
 *
 * Looser than open/click averages: real sends still count even when nobody
 * opened yet, so automation flows with volume are not dropped from Outcomes.
 */
export function campaignCountsInAttribution(row: {
  status: string;
  sent: number;
  statsAvailable?: boolean;
}): boolean {
  if (isGhlCampaignDeadStatus(row.status)) return false;
  if (isGhlCampaignQueuedStatus(row.status)) return false;
  if (row.sent <= 0) return false;
  if (row.statsAvailable === false) return false;
  return true;
}

export function formatGhlCampaignStatusLabel(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("schedul") || s.includes("pending") || s.includes("queue")) {
    return "Scheduled";
  }
  if (s.includes("process")) return "Sending";
  if (
    s.includes("complete") ||
    s === "sent" ||
    s.includes("deliver") ||
    s.includes("success")
  ) {
    return "Sent";
  }
  if (s.includes("cancel")) return "Cancelled";
  if (s === "draft") return "Draft";
  if (s.includes("paus")) return "Paused";
  if (!status || status === "unknown") return "Unknown";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** Pure open/click rollup used by analytics + unit tests. */
export function rollupEmailEngagement(rows: Array<{
  status: string;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced?: number;
  unsubscribed?: number;
  statsAvailable?: boolean;
}>): {
  campaigns: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  openRate: number;
  clickRate: number;
} {
  let campaigns = 0;
  let sent = 0;
  let delivered = 0;
  let opened = 0;
  let clicked = 0;
  for (const row of rows) {
    if (!campaignCountsInEmailTotals(row)) continue;
    campaigns += 1;
    sent += row.sent;
    delivered += row.delivered;
    opened += row.opened;
    clicked += row.clicked;
  }
  const base = delivered || sent;
  const rate = (part: number, whole: number) =>
    whole <= 0 ? 0 : Math.round((part / whole) * 1000) / 10;
  return {
    campaigns,
    sent,
    delivered,
    opened,
    clicked,
    openRate: rate(opened, base),
    clickRate: rate(clicked, base),
  };
}
