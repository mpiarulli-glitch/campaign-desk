// Scheduling a review-package campaign: the operator picks Scheduled and names
// a Pacific date and time for each email (or one date when the package is a
// single send). A cron sweep marks the campaign Sent once every email instant
// has passed. Campaign status is the source of truth for the Campaigns list; a
// matching calendar send is reused when one already exists so the two views
// do not invent a second send.

import { APP_TIME_ZONE, appDateTime } from "./cadence";
import { EDITORIAL_PREDICATE, getSend, updateSend } from "./calendar";
import {
  clearApprovalThankYou,
  getCampaignById,
  getEmailById,
  listEmails,
  updateCampaign,
} from "./campaigns";
import { getDb, nowIso, type Campaign, type CampaignEmail, type ScheduledSend } from "./db";
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

export type EmailSendInput = {
  id: string;
  sendDate: string;
  sendTime: string;
};

export function isSchedulableEmailKind(kind?: string | null): boolean {
  const k = (kind || "email").trim() || "email";
  return k === "email" || k === "interactive";
}

export function listSchedulableEmails(campaignId: string): CampaignEmail[] {
  return listEmails(campaignId).filter((email) =>
    isSchedulableEmailKind(email.kind)
  );
}

export function setEmailScheduledAt(
  emailId: string,
  scheduledSendAt: string | null
): void {
  getDb()
    .prepare(
      `UPDATE campaign_emails SET scheduled_send_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(scheduledSendAt, nowIso(), emailId);
}

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

function parsedEmailSends(
  campaignId: string,
  input: {
    sendDate?: string;
    sendTime?: string;
    emails?: EmailSendInput[];
  }
):
  | { error: string }
  | {
      rows: Array<{
        id: string;
        iso: string;
        sendDate: string;
        sendTime: string;
      }>;
    } {
  const schedulable = listSchedulableEmails(campaignId);
  const byId = new Map(schedulable.map((e) => [e.id, e]));
  if (input.emails && input.emails.length > 0) {
    const rows: Array<{
      id: string;
      iso: string;
      sendDate: string;
      sendTime: string;
    }> = [];
    for (const item of input.emails) {
      if (!byId.has(item.id)) {
        return { error: "That email is not in this package." };
      }
      const sendTime = parseTimeInput(item.sendTime);
      const iso = parseCampaignSendAt(item.sendDate, sendTime);
      if (!iso) {
        return { error: "Pick a date and time for each email." };
      }
      rows.push({ id: item.id, iso, sendDate: item.sendDate, sendTime });
    }
    for (const email of schedulable) {
      if (!rows.some((row) => row.id === email.id)) {
        return { error: "Pick a date and time for each email." };
      }
    }
    return { rows };
  }

  const sendTime = parseTimeInput(input.sendTime || "");
  const iso = parseCampaignSendAt(input.sendDate || "", sendTime);
  if (!iso) {
    return { error: "Pick the date and time this campaign will send." };
  }
  if (schedulable.length === 0) {
    return {
      rows: [{ id: "", iso, sendDate: input.sendDate || "", sendTime }],
    };
  }
  return {
    rows: schedulable.map((email) => ({
      id: email.id,
      iso,
      sendDate: input.sendDate || "",
      sendTime,
    })),
  };
}

export function scheduleCampaign(
  campaignId: string,
  input: {
    sendDate?: string;
    sendTime?: string;
    sendId?: string | null;
    emails?: EmailSendInput[];
  }
): ScheduleCampaignResult {
  const existing = getCampaignById(campaignId);
  if (!existing) return { error: "Not found" };

  const parsed = parsedEmailSends(campaignId, input);
  if ("error" in parsed) return parsed;
  const { rows } = parsed;
  if (!rows.length) {
    return { error: "Pick the date and time this campaign will send." };
  }

  const isos = rows.map((row) => row.iso).sort();
  const earliest = isos[0];
  const latest = isos[isos.length - 1];
  const past = latest <= nowIso();
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

  for (const row of rows) {
    if (!row.id) continue;
    if (!getEmailById(row.id)) continue;
    setEmailScheduledAt(row.id, row.iso);
  }

  let sendId: string | null = null;
  const requested = (input.sendId || "").trim();
  const match = requested
    ? getSend(requested)
    : findMatchingCalendarSend(existing);
  const first = rows[0];
  if (match && !match.cancelled_at) {
    updateSend(match.id, {
      sendDate: first.sendDate,
      sendTime: first.sendTime,
      status: past ? "sent" : "scheduled",
    });
    sendId = match.id;
  }

  setCampaignSchedule(campaignId, earliest, sendId);
  const campaign = getCampaignById(campaignId);
  if (!campaign) return { error: "Not found" };
  return { campaign, flippedToSent: past };
}

function campaignScheduleIsDue(campaign: Campaign, asOf: string): boolean {
  const emails = listSchedulableEmails(campaign.id).filter(
    (email) => email.scheduled_send_at
  );
  if (emails.length > 0) {
    return emails.every((email) => (email.scheduled_send_at as string) <= asOf);
  }
  return Boolean(
    campaign.scheduled_send_at && campaign.scheduled_send_at <= asOf
  );
}

export function listDueScheduledCampaigns(asOf = nowIso()): Campaign[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM campaigns
       WHERE status = 'scheduled'
       ORDER BY scheduled_send_at ASC, created_at ASC`
    )
    .all() as Campaign[];
  return rows.filter((campaign) => campaignScheduleIsDue(campaign, asOf));
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
