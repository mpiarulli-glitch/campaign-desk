// Scheduling a review-package campaign: the operator picks Scheduled, names a
// Pacific date and time, and a cron sweep marks it Sent once that instant has
// passed. Campaign status is the source of truth for the Campaigns list; a
// matching calendar send is reused when one already exists so the two views
// do not invent a second send.

import { APP_TIME_ZONE, appDateTime } from "./cadence";
import { EDITORIAL_PREDICATE, getSend, updateSend } from "./calendar";
import {
  clearApprovalThankYou,
  getCampaignById,
  updateCampaign,
} from "./campaigns";
import { getDb, nowIso, type Campaign, type ScheduledSend } from "./db";
import { parseTimeInput, zonedLocalToUtc } from "./forecast-time";

export const DEFAULT_SEND_TIME = "09:00";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type SuggestedCampaignSend = {
  sendDate: string;
  sendTime: string;
  sendId: string | null;
  title: string | null;
  source: "calendar" | "saved";
};

export type ScheduleCampaignResult =
  | { campaign: Campaign; flippedToSent: boolean }
  | { error: string };

export function parseCampaignSendAt(
  sendDate: string,
  sendTime: string
): string | null {
  const time = parseTimeInput(sendTime);
  if (!DATE_RE.test(sendDate) || !time) return null;
  const at = zonedLocalToUtc(sendDate, time, APP_TIME_ZONE);
  if (!at || Number.isNaN(at.getTime())) return null;
  return at.toISOString();
}

export function isoToAppDateTime(iso: string): { date: string; time: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return appDateTime(d);
}

function titleKey(value: string): string {
  return value.trim().toLowerCase();
}

export function findMatchingCalendarSend(
  campaign: Pick<Campaign, "title" | "client_id" | "client_name" | "scheduled_send_id">
): ScheduledSend | null {
  if (campaign.scheduled_send_id) {
    const linked = getSend(campaign.scheduled_send_id);
    if (linked && !linked.cancelled_at) return linked;
  }

  const title = titleKey(campaign.title);
  if (!title) return null;

  const today = appDateTime().date;
  const db = getDb();
  const clientId = (campaign.client_id || "").trim();
  const clientName = titleKey(campaign.client_name);

  const rows = (
    clientId
      ? (db
          .prepare(
            `SELECT * FROM scheduled_sends
             WHERE cancelled_at IS NULL
               AND ${EDITORIAL_PREDICATE}
               AND client_id = ?
               AND lower(trim(title)) = ?
             ORDER BY
               CASE WHEN status = 'sent' THEN 1 ELSE 0 END,
               CASE WHEN send_date >= ? THEN 0 ELSE 1 END,
               send_date ASC,
               send_time ASC,
               created_at ASC`
          )
          .all(clientId, title, today) as ScheduledSend[])
      : clientName
        ? (db
            .prepare(
              `SELECT * FROM scheduled_sends
               WHERE cancelled_at IS NULL
                 AND ${EDITORIAL_PREDICATE}
                 AND lower(trim(client_name)) = ?
                 AND lower(trim(title)) = ?
               ORDER BY
                 CASE WHEN status = 'sent' THEN 1 ELSE 0 END,
                 CASE WHEN send_date >= ? THEN 0 ELSE 1 END,
                 send_date ASC,
                 send_time ASC,
                 created_at ASC`
            )
            .all(clientName, title, today) as ScheduledSend[])
        : []
  );

  return rows[0] || null;
}

export function suggestedSendForCampaign(
  campaign: Campaign
): SuggestedCampaignSend | null {
  const match = findMatchingCalendarSend(campaign);
  if (match) {
    return {
      sendDate: match.send_date,
      sendTime: parseTimeInput(match.send_time) || DEFAULT_SEND_TIME,
      sendId: match.id,
      title: match.title,
      source: "calendar",
    };
  }
  if (campaign.scheduled_send_at) {
    const parts = isoToAppDateTime(campaign.scheduled_send_at);
    if (parts) {
      return {
        sendDate: parts.date,
        sendTime: parts.time || DEFAULT_SEND_TIME,
        sendId: campaign.scheduled_send_id,
        title: null,
        source: "saved",
      };
    }
  }
  return null;
}

export function setCampaignSchedule(
  campaignId: string,
  scheduledSendAt: string | null,
  scheduledSendId: string | null
): void {
  getDb()
    .prepare(
      `UPDATE campaigns
       SET scheduled_send_at = ?, scheduled_send_id = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(scheduledSendAt, scheduledSendId, nowIso(), campaignId);
}

export function scheduleCampaign(
  campaignId: string,
  input: { sendDate: string; sendTime: string; sendId?: string | null }
): ScheduleCampaignResult {
  const existing = getCampaignById(campaignId);
  if (!existing) return { error: "Not found" };

  const sendTime = parseTimeInput(input.sendTime);
  const iso = parseCampaignSendAt(input.sendDate, sendTime);
  if (!iso) {
    return { error: "Pick the date and time this campaign will send." };
  }

  const past = iso <= nowIso();
  const status = past ? "sent" : "scheduled";
  const leavingApproved = existing.status === "approved";
  if (leavingApproved) {
    clearApprovalThankYou(campaignId);
  }

  updateCampaign(campaignId, {
    status,
    approvedAt: leavingApproved ? null : undefined,
    approvedBy: leavingApproved ? null : undefined,
    approvedChannel: leavingApproved ? null : undefined,
  });

  let sendId: string | null = null;
  const requested = (input.sendId || "").trim();
  const match = requested
    ? getSend(requested)
    : findMatchingCalendarSend(existing);
  if (match && !match.cancelled_at) {
    updateSend(match.id, {
      sendDate: input.sendDate,
      sendTime,
      status: past ? "sent" : "scheduled",
    });
    sendId = match.id;
  }

  setCampaignSchedule(campaignId, iso, sendId);
  const campaign = getCampaignById(campaignId);
  if (!campaign) return { error: "Not found" };
  return { campaign, flippedToSent: past };
}

export function listDueScheduledCampaigns(asOf = nowIso()): Campaign[] {
  return getDb()
    .prepare(
      `SELECT * FROM campaigns
       WHERE status = 'scheduled'
         AND scheduled_send_at IS NOT NULL
         AND scheduled_send_at <= ?
       ORDER BY scheduled_send_at ASC, created_at ASC`
    )
    .all(asOf) as Campaign[];
}

export function markScheduledCampaignSent(campaignId: string): Campaign | null {
  const existing = getCampaignById(campaignId);
  if (!existing || existing.status !== "scheduled") return null;
  const ts = nowIso();
  const changed = getDb()
    .prepare(
      `UPDATE campaigns SET status = 'sent', updated_at = ?
       WHERE id = ? AND status = 'scheduled'`
    )
    .run(ts, campaignId).changes;
  if (!changed) return null;

  const sendId = existing.scheduled_send_id;
  if (sendId) {
    const send = getSend(sendId);
    if (send && !send.cancelled_at && send.status !== "sent") {
      updateSend(sendId, { status: "sent" });
    }
  }
  return getCampaignById(campaignId);
}

export function runScheduledCampaignSends(opts?: {
  dryRun?: boolean;
  asOf?: string;
}): {
  due: number;
  flipped: Array<{ id: string; title: string; clientName: string }>;
  dryRun: boolean;
} {
  const asOf = opts?.asOf || nowIso();
  const due = listDueScheduledCampaigns(asOf);
  if (opts?.dryRun) {
    return {
      due: due.length,
      flipped: due.map((c) => ({
        id: c.id,
        title: c.title,
        clientName: c.client_name,
      })),
      dryRun: true,
    };
  }
  const flipped: Array<{ id: string; title: string; clientName: string }> = [];
  for (const row of due) {
    const updated = markScheduledCampaignSent(row.id);
    if (updated) {
      flipped.push({
        id: updated.id,
        title: updated.title,
        clientName: updated.client_name,
      });
    }
  }
  return { due: due.length, flipped, dryRun: false };
}
