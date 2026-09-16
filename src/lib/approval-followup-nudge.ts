// In-app follow-up reminders for approvals that have sat too long.
//
// After two full days in Internal Review or Sent for approval, a row appears
// in the Activity bell. The id includes today's Pacific date so marking it
// read today does not hide tomorrow's reminder. This never messages the client.

import { APP_TIME_ZONE } from "./cadence";
import {
  campaignFitsKindScope,
  listOpenApprovalCampaigns,
  type ActivityItem,
} from "./campaigns";
import type { Campaign } from "./db";
import type { CampaignKindScope } from "./people";

export const APPROVAL_FOLLOWUP_WAIT_DAYS = 2;

export type ApprovalFollowupKind = "internal" | "external";

export type ApprovalFollowupItem = {
  campaignId: string;
  title: string;
  clientName: string;
  kind: ApprovalFollowupKind;
  waitingDays: number;
  waitingSince: string;
  today: string;
};

export function ymdInAppZone(iso: string, timeZone = APP_TIME_ZONE): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(t));
}

export function daysWaiting(waitingSince: string, asOfIso: string): number {
  const start = Date.parse(waitingSince);
  const end = Date.parse(asOfIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / 86_400_000);
}

export function waitingSinceFor(campaign: Campaign): string {
  if (campaign.status === "internal_review") {
    return campaign.internal_review_sent_at || campaign.updated_at;
  }
  return campaign.basecamp_approval_sent_at || campaign.updated_at;
}

export function approvalFollowupKind(status: string): ApprovalFollowupKind | null {
  if (status === "internal_review") return "internal";
  if (status === "in_review") return "external";
  return null;
}

export function listDueApprovalFollowups(
  asOfIso = new Date().toISOString()
): ApprovalFollowupItem[] {
  const today = ymdInAppZone(asOfIso);
  const out: ApprovalFollowupItem[] = [];
  for (const campaign of listOpenApprovalCampaigns()) {
    const kind = approvalFollowupKind(campaign.status);
    if (!kind) continue;
    const waitingSince = waitingSinceFor(campaign);
    const waitingDays = daysWaiting(waitingSince, asOfIso);
    if (waitingDays < APPROVAL_FOLLOWUP_WAIT_DAYS) continue;
    out.push({
      campaignId: campaign.id,
      title: campaign.title,
      clientName: campaign.client_name || "No client",
      kind,
      waitingDays,
      waitingSince,
      today,
    });
  }
  return out.sort(
    (a, b) =>
      b.waitingDays - a.waitingDays || a.clientName.localeCompare(b.clientName)
  );
}

function startOfTodayIso(today: string): string {
  return `${today}T16:00:00.000Z`;
}

export function followupActivityId(
  item: Pick<ApprovalFollowupItem, "campaignId" | "today">
): string {
  return `${item.campaignId}:${item.today}`;
}

export function listApprovalFollowupActivity(
  asOfIso = new Date().toISOString(),
  kindScope?: CampaignKindScope | null
): ActivityItem[] {
  return listDueApprovalFollowups(asOfIso)
    .filter((item) => campaignFitsKindScope(item.campaignId, kindScope))
    .map((item) => {
      const waiting =
        item.waitingDays === 1 ? "1 day" : `${item.waitingDays} days`;
      const where =
        item.kind === "internal" ? "internal review" : "client approval";
      return {
        kind: "followup" as const,
        id: followupActivityId(item),
        campaign_id: item.campaignId,
        campaign_title: item.title,
        client_name: item.clientName,
        client_id: null,
        actor: "Follow up",
        body: `${where} has been waiting ${waiting}`,
        comment_type: null,
        quote_text: null,
        email_title: null,
        resolved: null,
        star_rating: null,
        attachment_count: 0,
        approved_channel: null,
        at: startOfTodayIso(item.today),
        waiting_days: item.waitingDays,
        followup_kind: item.kind,
      };
    });
}

export function mergeActivityWithFollowups(
  activity: ActivityItem[],
  asOfIso?: string,
  kindScope?: CampaignKindScope | null,
  limit = 150
): ActivityItem[] {
  const followups = listApprovalFollowupActivity(asOfIso, kindScope);
  return [...followups, ...activity]
    .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
    .slice(0, limit);
}
