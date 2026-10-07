// Planned send time for each item in a review package.
//
// The time the client sees is the one already stored for that email
// (campaign_emails.scheduled_send_at, UTC ISO). When that is empty and a
// calendar send is already tied to the email — same client, same title, or
// the package's linked calendar row when the package is a single email —
// that calendar instant is the time. Nothing else is invented, and saving
// from the package page writes the same email column (and the matched
// calendar row, when there is one) so the review link and the calendar
// stay on one clock.

import { EDITORIAL_PREDICATE, getSend, updateSend } from "./calendar";
import {
  getCampaignByAnyToken,
  getCampaignById,
  listEmails,
} from "./campaigns";
import {
  parseCampaignSendAt,
  setEmailScheduledAt,
} from "./campaign-schedule";
import { getDb, type Campaign, type CampaignEmail, type ScheduledSend } from "./db";
import { parseTimeInput } from "./forecast-time";

export type PlannedSendSource = "email" | "calendar";

export type ClientSendScheduleRow = {
  emailId: string;
  title: string;
  /** UTC ISO, or null when nothing is planned. */
  scheduledSendAt: string | null;
  source: PlannedSendSource | null;
};

/** What a review link is allowed to show. No calendar notes, no other packages. */
export type PublicSendScheduleRow = {
  id: string;
  title: string;
  scheduledSendAt: string | null;
};

export type SendScheduleUpdate = {
  emailId: string;
  /** Pacific YYYY-MM-DD, or blank to clear. */
  sendDate: string;
  /** Pacific HH:MM, or blank to clear. */
  sendTime: string;
};

function titleKey(value: string): string {
  return value.trim().toLowerCase();
}

function instantFromSend(send: ScheduledSend): string | null {
  const time = parseTimeInput(send.send_time);
  if (!send.send_date || !time) return null;
  return parseCampaignSendAt(send.send_date, time);
}

function calendarSendForEmail(
  campaign: Campaign,
  email: CampaignEmail,
  emails: CampaignEmail[]
): ScheduledSend | null {
  const emailTitle = titleKey(email.title);
  if (campaign.scheduled_send_id) {
    const linked = getSend(campaign.scheduled_send_id);
    if (linked && !linked.cancelled_at) {
      const linkedTitle = titleKey(linked.title);
      const sole = emails.length === 1 && emails[0]?.id === email.id;
      if (sole || (emailTitle && linkedTitle === emailTitle)) return linked;
    }
  }

  if (!emailTitle) return null;
  const clientId = (campaign.client_id || "").trim();
  const clientName = titleKey(campaign.client_name);
  if (!clientId && !clientName) return null;

  const db = getDb();
  const row = (
    clientId
      ? db
          .prepare(
            `SELECT * FROM scheduled_sends
             WHERE cancelled_at IS NULL
               AND ${EDITORIAL_PREDICATE}
               AND client_id = ?
               AND lower(trim(title)) = ?
             ORDER BY
               CASE WHEN status = 'sent' THEN 1 ELSE 0 END,
               send_date ASC,
               send_time ASC,
               created_at ASC
             LIMIT 1`
          )
          .get(clientId, emailTitle)
      : db
          .prepare(
            `SELECT * FROM scheduled_sends
             WHERE cancelled_at IS NULL
               AND ${EDITORIAL_PREDICATE}
               AND lower(trim(client_name)) = ?
               AND lower(trim(title)) = ?
             ORDER BY
               CASE WHEN status = 'sent' THEN 1 ELSE 0 END,
               send_date ASC,
               send_time ASC,
               created_at ASC
             LIMIT 1`
          )
          .get(clientName, emailTitle)
  ) as ScheduledSend | undefined;
  return row || null;
}

function plannedForEmail(
  campaign: Campaign,
  email: CampaignEmail,
  emails: CampaignEmail[]
): { scheduledSendAt: string | null; source: PlannedSendSource | null } {
  if (email.scheduled_send_at) {
    return { scheduledSendAt: email.scheduled_send_at, source: "email" };
  }
  const send = calendarSendForEmail(campaign, email, emails);
  const fromCalendar = send ? instantFromSend(send) : null;
  if (fromCalendar) return { scheduledSendAt: fromCalendar, source: "calendar" };
  if (emails.length === 1 && campaign.scheduled_send_at) {
    return { scheduledSendAt: campaign.scheduled_send_at, source: "email" };
  }
  return { scheduledSendAt: null, source: null };
}

export function listClientSendSchedule(campaignId: string): ClientSendScheduleRow[] {
  const campaign = getCampaignById(campaignId);
  if (!campaign) return [];
  const emails = listEmails(campaignId);
  return emails.map((email) => {
    const planned = plannedForEmail(campaign, email, emails);
    return {
      emailId: email.id,
      title: email.title,
      scheduledSendAt: planned.scheduledSendAt,
      source: planned.source,
    };
  });
}

/**
 * Schedule for the package this review token opens. A token for package A
 * never returns package B's emails or times. Unknown tokens return null.
 */
export function publicSendScheduleForToken(
  token: string
): PublicSendScheduleRow[] | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  const match = getCampaignByAnyToken(trimmed);
  if (!match) return null;
  return listClientSendSchedule(match.campaign.id).map((row) => ({
    id: row.emailId,
    title: row.title,
    scheduledSendAt: row.scheduledSendAt,
  }));
}

export function setClientSendSchedule(
  campaignId: string,
  updates: SendScheduleUpdate[]
): { rows: ClientSendScheduleRow[] } | { error: string } {
  const campaign = getCampaignById(campaignId);
  if (!campaign) return { error: "Not found" };

  const emails = listEmails(campaignId);
  const byId = new Map(emails.map((email) => [email.id, email]));
  const parsed: Array<{
    id: string;
    iso: string | null;
    sendDate: string;
    sendTime: string;
  }> = [];

  for (const item of updates) {
    if (!byId.has(item.emailId)) {
      return { error: "That email is not in this package." };
    }
    const sendDate = (item.sendDate || "").trim();
    const rawTime = (item.sendTime || "").trim();
    const sendTime = parseTimeInput(rawTime);
    if (!sendDate && !rawTime) {
      parsed.push({ id: item.emailId, iso: null, sendDate: "", sendTime: "" });
      continue;
    }
    const iso = sendDate && sendTime ? parseCampaignSendAt(sendDate, sendTime) : null;
    if (!iso) {
      return { error: "Pick a date and a time, or leave both blank." };
    }
    parsed.push({ id: item.emailId, iso, sendDate, sendTime });
  }

  const db = getDb();
  const apply = db.transaction(() => {
    for (const row of parsed) {
      setEmailScheduledAt(row.id, row.iso);
      if (!row.iso) continue;
      const email = byId.get(row.id);
      if (!email) continue;
      const send = calendarSendForEmail(campaign, email, emails);
      if (send) {
        updateSend(send.id, { sendDate: row.sendDate, sendTime: row.sendTime });
      }
    }
  });
  apply();

  return { rows: listClientSendSchedule(campaignId) };
}
