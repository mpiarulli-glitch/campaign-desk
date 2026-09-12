import type { ClientEmailAnalytics, GhlCampaignRow } from "./ghl-email-analytics";

export type AnalyticsTip = {
  id: string;
  title: string;
  detail: string;
  tone: "focus" | "watch" | "keep";
};

function rankedByOpen(campaigns: GhlCampaignRow[]): GhlCampaignRow[] {
  return campaigns
    .filter((c) => c.statsAvailable && c.sent >= 20 && c.status.toLowerCase() !== "cancelled")
    .slice()
    .sort((a, b) => b.openRate - a.openRate || b.sent - a.sent);
}

function rankedByClick(campaigns: GhlCampaignRow[]): GhlCampaignRow[] {
  return campaigns
    .filter((c) => c.statsAvailable && c.sent >= 20 && c.status.toLowerCase() !== "cancelled")
    .slice()
    .sort((a, b) => b.clickRate - a.clickRate || b.clicked - a.clicked);
}

/**
 * Practical next-month tips from the live GHL window — not ecommerce magic,
 * just what the send/open/click/appointment numbers are saying.
 */
export function buildEmailRecommendations(
  analytics: ClientEmailAnalytics
): AnalyticsTip[] {
  const tips: AnalyticsTip[] = [];
  const { totals, campaigns, flows, appointments, formFills, abandonedRecovery } = analytics;
  const complete = campaigns.filter(
    (c) => c.statsAvailable && !["cancelled", "canceled", "draft", "paused"].includes(c.status.toLowerCase())
  );
  const byOpen = rankedByOpen(complete);
  const byClick = rankedByClick(complete);
  const bestOpen = byOpen[0];
  const worstOpen = byOpen[byOpen.length - 1];
  const bestClick = byClick[0];

  if (complete.length === 0) {
    tips.push({
      id: "no-sends",
      title: "No completed campaigns in this window",
      detail:
        "Plan the next month’s calendar now — subject, offer, and send day — so you are not scrambling mid-month.",
      tone: "focus",
    });
  }

  if (complete.length && totals.openRate < 25) {
    tips.push({
      id: "low-open",
      title: "Open rate is soft — fix the first line",
      detail:
        "Test shorter, specific subject lines (outcome or number in the first 40 characters). Avoid spammy urgency and preview text that repeats the subject.",
      tone: "focus",
    });
  } else if (complete.length && totals.openRate < 40) {
    tips.push({
      id: "mid-open",
      title: "Opens are okay — make subject the lever",
      detail:
        "A/B one curiosity angle vs one plain benefit next month. Keep the winner’s pattern and retire vague titles.",
      tone: "watch",
    });
  } else if (complete.length) {
    tips.push({
      id: "strong-open",
      title: "Opens are strong — spend effort on clicks",
      detail:
        "Subjects are working. Put the primary CTA above the fold and cut competing links so click rate can catch up.",
      tone: "keep",
    });
  }

  if (totals.clickRate < 1.5 && totals.sent >= 100) {
    tips.push({
      id: "low-click",
      title: "Clicks are thin for this list size",
      detail:
        "One clear button, one destination. Match the subject promise in the first screen so openers know what to do.",
      tone: "focus",
    });
  } else if (totals.clickRate >= 3) {
    tips.push({
      id: "strong-click",
      title: "Click rate is healthy",
      detail:
        "Reuse the layout and CTA style from the top clickers. Next month’s creative should feel familiar, not reinvented.",
      tone: "keep",
    });
  }

  if (bestOpen && worstOpen && bestOpen.id !== worstOpen.id && bestOpen.openRate - worstOpen.openRate >= 15) {
    const bestSubject = bestOpen.subject || bestOpen.name;
    tips.push({
      id: "winner-subject",
      title: "Double down on what already opened",
      detail: `“${bestSubject}” led opens at ${bestOpen.openRate.toFixed(1)}%. Echo that angle (not a copy-paste) in next month’s first send.`,
      tone: "focus",
    });
  }

  if (bestClick && bestClick.clicked > 0) {
    const label = bestClick.subject || bestClick.name;
    tips.push({
      id: "winner-click",
      title: "Promote the highest-click campaign pattern",
      detail: `“${label}” drove ${bestClick.clicked.toLocaleString()} clicks (${bestClick.clickRate.toFixed(1)}%). Build next month’s offer email on the same structure.`,
      tone: "watch",
    });
  }

  if (
    appointments !== null &&
    totals.clicked >= 5 &&
    appointments / Math.max(totals.clicked, 1) < 0.15
  ) {
    tips.push({
      id: "booking-gap",
      title: "Clicks are not turning into appointments",
      detail:
        "Check the landing page and booking CTA. Add a reply-to-book or calendar link in the first email of next month’s sequence.",
      tone: "focus",
    });
  } else if (appointments !== null && appointments >= 8) {
    tips.push({
      id: "booking-ok",
      title: "Appointments look solid",
      detail:
        "Keep the same booking path. Next month, mention social proof or a concrete next-step time window near the CTA.",
      tone: "keep",
    });
  }

  if (complete.length === 1) {
    tips.push({
      id: "one-send",
      title: "Only one campaign in the window",
      detail:
        "One send cannot teach the list. Aim for a steady cadence next month so open and click rates are comparable month to month.",
      tone: "watch",
    });
  } else if (complete.length >= 4 && totals.openRate >= 35) {
    tips.push({
      id: "cadence-ok",
      title: "Cadence is working — protect it",
      detail:
        "Do not stack last-minute blasts. Lock send days early and leave room for one opportunistic offer if a winner appears.",
      tone: "keep",
    });
  }


  const allSends = [...campaigns, ...(flows || [])];
  const attributedForms = allSends.reduce((n, row) => n + (row.formFills || 0), 0);
  const attributedBooks = allSends.reduce((n, row) => n + (row.attributedAppointments || 0), 0);
  const topMoney = allSends
    .slice()
    .sort(
      (a, b) =>
        b.attributedAppointments + b.formFills - (a.attributedAppointments + a.formFills) ||
        b.clicked - a.clicked
    )[0];

  if (abandonedRecovery && !abandonedRecovery.error) {
    if (abandonedRecovery.recoveredInWindow > 0) {
      tips.push({
        id: "abandoned-recovered",
        title: `Recovered ${abandonedRecovery.recoveredInWindow} abandoned booking${abandonedRecovery.recoveredInWindow === 1 ? "" : "s"}`,
        detail: `${abandonedRecovery.stillAbandoned} still open. Recovery rate ${abandonedRecovery.recoveryRate}% across abandoners with a meeting-booked signal.`,
        tone: "keep",
      });
    } else if (abandonedRecovery.stillAbandoned > 0) {
      tips.push({
        id: "abandoned-open",
        title: "Abandoned bookings are not converting",
        detail: `${abandonedRecovery.stillAbandoned} contacts still carry abandoned booking without a booked meeting. Tighten the recovery flow SMS/email timing and calendar CTA.`,
        tone: "focus",
      });
    }
  }

  if (formFills !== null && formFills === 0 && totals.clicked >= 20) {
    tips.push({
      id: "no-forms",
      title: "Clicks are not producing form fills",
      detail:
        "Check landing pages and form tags (website form submission). If forms fire under a different tag, map it so Lifecycle can credit the send.",
      tone: "focus",
    });
  }

  if (topMoney && topMoney.attributedAppointments + topMoney.formFills > 0) {
    const label = topMoney.subject?.trim() || topMoney.name;
    tips.push({
      id: "money-winner",
      title: "Double down on the send that made money",
      detail: `“${label}” is attributed ${topMoney.formFills} form fill${topMoney.formFills === 1 ? "" : "s"} and ${topMoney.attributedAppointments} booked appointment${topMoney.attributedAppointments === 1 ? "" : "s"} in the post-send window.`,
      tone: "focus",
    });
  } else if (attributedForms + attributedBooks === 0 && totals.sent >= 100) {
    tips.push({
      id: "no-attribution",
      title: "No form fills or bookings attributed to sends",
      detail:
        "Either conversions landed outside the attribution window, or GHL tags/calendars are not linked. Confirm website form submission + meeting booked tags and calendar access.",
      tone: "watch",
    });
  }

  // Cap so the panel stays scannable.
  const priority = { focus: 0, watch: 1, keep: 2 } as const;
  return tips
    .sort((a, b) => priority[a.tone] - priority[b.tone])
    .slice(0, 5);
}
