/**
 * Pure helpers for GHL campaign send status — safe for client components.
 * Keep this file free of Node / DB / GHL API imports.
 *
 * Accuracy rules:
 * - Audience size (totalCount) is never "sent" for scheduled / queued blasts.
 * - Open-rate averages only include rows with real send volume + stats.
 * - Prefer GHL stats.sent; never invent sends from audience when stats say 0.
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
 */
export function resolveGhlCampaignSentCount(
  status: string,
  statsSent: number,
  audienceTotal: number,
  hasStats = false
): number {
  if (isGhlCampaignDeadStatus(status)) return 0;

  // Real tracked sends always win — including mid-flight "processing" blasts.
  if (statsSent > 0) return statsSent;

  // Still queued / not out — audience size is NOT sent.
  if (isGhlCampaignNotYetSent(status)) return 0;

  // Stats payload exists and reports zero — trust it (don't use audience).
  if (hasStats) return 0;

  // Completed-looking but no stats yet: do not invent volume from audience.
  // Including audience-as-sent with 0 opens is what tanks open-rate averages.
  void audienceTotal;
  return 0;
}

/**
 * Whether a campaign row should roll into open / click / sent averages.
 * Requires real send volume and a stats payload so 0% isn't a missing-data lie.
 */
export function campaignCountsInEmailTotals(row: {
  status: string;
  sent: number;
  statsAvailable?: boolean;
}): boolean {
  if (isGhlCampaignDeadStatus(row.status)) return false;
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
