import { recordFailure, clearFailure } from "./failures";
import { nanoid } from "nanoid";
import { getDb, nowIso, type RevClient, type ScheduledSend, type ScheduleReminder } from "./db";
import {
  findSendForWindow,
  getOrCreateScheduleToken,
  nextWindow,
  todayYmd,
  type Window,
} from "./cadence";
import { listRevClients, getRevClient } from "./revenue";
import { sendEmail } from "./email";
import { scheduleUrl } from "./auth";
import {
  basecampConnected,
  commentOnCard,
  createScheduleCard,
  findClientContact,
  getProjectPeopleForMention,
  mentionHtml,
} from "./basecamp";
import { sendProductionUpcoming } from "./production-emails";
import { isWindowDeclined } from "./window-declines";

// How far ahead of the window's first day the first reminder goes out.
export const REMINDER_LEAD_DAYS = 21;

// Follow-up schedule, as weekdays (0 = Sunday ... 6 = Saturday).
//
// Fixed weekdays rather than an interval, because that satisfies all three
// rules by construction: never on a weekend, at most two client emails a week,
// at most three Basecamp nudges a week. Changing the cap is a matter of editing
// these arrays.
//
// This governs FOLLOW-UPS only. Booking confirmations and the day-before
// "crew arrives tomorrow" email are operational and still send whenever due,
// weekends included.
export const REMINDER_EMAIL_DAYS = [1, 4]; // Monday, Thursday
export const BASECAMP_FOLLOWUP_DAYS = [1, 3, 5]; // Monday, Wednesday, Friday

function subDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
}

// Whole days from `from` to `to`. Negative once `to` is in the past.
function daysBetween(from: string, to: string): number {
  const day = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((day(to) - day(from)) / 86_400_000);
}

// Day of week for a calendar date, read in UTC so it matches the way every
// other date in the scheduler is built.
export function dayOfWeek(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isEmailFollowupDay(ymd: string): boolean {
  return REMINDER_EMAIL_DAYS.includes(dayOfWeek(ymd));
}

export function isBasecampFollowupDay(ymd: string): boolean {
  return BASECAMP_FOLLOWUP_DAYS.includes(dayOfWeek(ymd));
}

function escapeHtml(text: string): string {
  return (text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function longDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

// The Basecamp card and its follow-up comments, in one place.
//
// Both live on the client's own project and tag their contact, so the client
// reads them. They are written to the client, never about them: a comment
// saying "they still haven't booked" on the client's own card is the specific
// mistake this shape exists to prevent.
export function scheduleCardContent(
  client: RevClient,
  window: Window,
  url: string,
  // A real Basecamp mention for the client contact, when they resolve to a
  // person on the project. Writing "Hi Michael," in plain text looks like an
  // address but notifies nobody, which is the whole point of the card.
  contactMention?: string
): { title: string; body: string } {
  const hello = contactMention
    ? `Hi ${contactMention},`
    : client.contact_name?.trim()
      ? `Hi ${escapeHtml(client.contact_name.trim())},`
      : "Hi there,";
  const windowText = `${longDate(window.start)} to ${longDate(window.end)}`;
  const body =
    `<div>${hello}</div>` +
    `<div><br></div>` +
    `<div>It's time to schedule your next production. We have your window ` +
    `set for <strong>${escapeHtml(windowText)}</strong>.</div>` +
    `<div><br></div>` +
    (url
      ? `<div>Please use the link below to pick a day and a start time that ` +
        `work best for you.</div>` +
        `<div><br></div>` +
        `<div><a href="${url}">${url}</a></div>` +
        `<div><br></div>`
      : "") +
    `<div>If you have any problems, feel free to leave a comment on this ` +
    `card.</div>` +
    `<div><br></div>` +
    `<div>Thanks!</div>`;
  return { title: "Time to schedule your next production", body };
}

export function scheduleNudgeContent(
  client: RevClient,
  window: Window,
  url: string,
  today: string,
  contactMention?: string
): string {
  const daysOut = daysBetween(today, window.start);
  const urgency =
    daysOut > 0
      ? `opens in ${daysOut} day${daysOut === 1 ? "" : "s"}`
      : "is open now";
  const opener = contactMention ? `${contactMention} ` : "";
  return (
    `<div>${opener}Just a friendly nudge on this one. Your production window ` +
    `${urgency}, ${escapeHtml(longDate(window.start))} to ` +
    `${escapeHtml(longDate(window.end))}, and we don't have a day booked ` +
    `in yet.</div>` +
    `<div><br></div>` +
    (url
      ? `<div>Pick a day and a start time here:</div>` +
        `<div><a href="${url}">${url}</a></div>` +
        `<div><br></div>`
      : "") +
    `<div>If anything is in the way, just leave a comment and we will sort ` +
    `it out.</div>` +
    `<div><br></div>` +
    `<div>Thanks!</div>`
  );
}

export function getReminder(
  clientId: string,
  windowStart: string
): ScheduleReminder | null {
  return (
    (getDb()
      .prepare(
        `SELECT * FROM schedule_reminders WHERE client_id = ? AND window_start = ?`
      )
      .get(clientId, windowStart) as ScheduleReminder | undefined) || null
  );
}

// The client's most recent reminder across all windows — used to show
// "last email sent" and "last window emailed" in the master scheduler.
export function getLatestReminder(clientId: string): ScheduleReminder | null {
  return (
    (getDb()
      .prepare(
        `SELECT * FROM schedule_reminders
         WHERE client_id = ? AND last_sent != ''
         ORDER BY last_sent DESC, updated_at DESC
         LIMIT 1`
      )
      .get(clientId) as ScheduleReminder | undefined) || null
  );
}

// Stamp that the Basecamp card was created for this window (dedupe), storing
// its id so later follow-ups comment on the same card. Creates the tracking row
// if a reminder hasn't been recorded yet.
function markBasecampCard(
  clientId: string,
  windowStart: string,
  today: string,
  cardId?: string
) {
  const db = getDb();
  const ts = nowIso();
  const existing = getReminder(clientId, windowStart);
  if (existing) {
    db.prepare(
      `UPDATE schedule_reminders
       SET bc_card_at = ?, bc_card_id = ?, bc_last_nudge = ?, updated_at = ?
       WHERE id = ?`
    ).run(ts, cardId || existing.bc_card_id, today, ts, existing.id);
  } else {
    db.prepare(
      `INSERT INTO schedule_reminders
        (id, client_id, window_start, last_sent, count, bc_card_at, bc_card_id,
         bc_last_nudge, bc_nudge_count, created_at, updated_at)
       VALUES (?, ?, ?, '', 0, ?, ?, ?, 0, ?, ?)`
    ).run(nanoid(12), clientId, windowStart, ts, cardId || null, today, ts, ts);
  }
}

// Record that a Basecamp follow-up comment went out today.
function markBasecampNudge(reminderId: string, today: string) {
  const ts = nowIso();
  getDb()
    .prepare(
      `UPDATE schedule_reminders
       SET bc_last_nudge = ?, bc_nudge_count = bc_nudge_count + 1, updated_at = ?
       WHERE id = ?`
    )
    .run(today, ts, reminderId);
}

// Record that a reminder went out today, creating the row on first send.
function markReminded(clientId: string, windowStart: string, today: string) {
  const db = getDb();
  const existing = getReminder(clientId, windowStart);
  const ts = nowIso();
  if (existing) {
    db.prepare(
      `UPDATE schedule_reminders SET last_sent = ?, count = count + 1, updated_at = ? WHERE id = ?`
    ).run(today, ts, existing.id);
  } else {
    db.prepare(
      `INSERT INTO schedule_reminders
        (id, client_id, window_start, last_sent, count, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`
    ).run(nanoid(12), clientId, windowStart, today, ts, ts);
  }
}

// Exported so the outreach can be previewed or sent to a single address for a
// test, without running the sweep and mailing every eligible client.
export function reminderEmail(
  client: RevClient,
  window: Window,
  url: string
): { subject: string; html: string; text: string } {
  const esc = (s: string) =>
    (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const name = client.contact_name?.trim();
  const greeting = name ? `Hi ${esc(name)},` : "Hi there,";
  const company = esc(client.name);
  const fmtLong = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  };
  const year = window.start.split("-")[0];
  const windowText = `${fmtLong(window.start)} – ${fmtLong(window.end)}, ${year}`;
  // No company-name prefix. The sender is already Marketing Empire Group, so
  // leading with the client's own name read like a system ticket addressed to
  // them about themselves. Matches the Basecamp card title.
  const subject = "Time to schedule your next production";
  const preheader = "Your next production is coming up. Pick a day and time in about a minute.";
  const logo = "https://assets.cdn.filesafe.space/0GKlxMiOTyF1FJ3vPBfo/media/6916cb146c431e860eb696b9.png";

  const text = [
    greeting,
    "",
    "It's time to schedule your next production. Pick a day and time that work best and share a few quick details:",
    url,
    "",
    `Any weekday from ${windowText} works.`,
    "It only takes a minute. Just reply to this email with any questions.",
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<title>${subject}</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap');
  @media screen and (max-width:600px){
    .container{width:100% !important;}
    .px{padding-left:24px !important;padding-right:24px !important;}
    .h1{font-size:26px !important;}
    .cta{width:100% !important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f4;">
  <tr>
    <td align="center" style="padding:28px 12px;">
      <!--[if (gte mso 9)|(IE)]><table width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" class="container" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;">
        <tr>
          <td align="center" style="background-color:#000000;padding:26px 30px;">
            <img src="${logo}" alt="Marketing Empire Group" width="170" style="display:block;width:170px;max-width:60%;height:auto;border:0;">
          </td>
        </tr>
        <tr>
          <td class="px" style="padding:40px 44px 8px;font-family:Arial,Helvetica,sans-serif;">
            <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#00a3b4;font-weight:bold;">${company}</p>
            <h1 class="h1" style="margin:0 0 18px;font-family:'Poppins',Arial,Helvetica,sans-serif;font-size:30px;line-height:1.25;color:#111111;font-weight:600;">It&rsquo;s time to schedule your next production</h1>
            <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#333333;">${greeting}</p>
            <p style="margin:0 0 22px;font-size:16px;line-height:1.6;color:#333333;">You&rsquo;re coming up for your next production. Pick the day and time that work best for you and share a few quick details so we show up ready.</p>
          </td>
        </tr>
        <tr>
          <td class="px" style="padding:0 44px 8px;font-family:Arial,Helvetica,sans-serif;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f0fbfd;border-left:4px solid #00d4e8;border-radius:6px;">
              <tr>
                <td style="padding:18px 22px;">
                  <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#7a7a7a;font-weight:bold;">Pick any weekday</p>
                  <p style="margin:0;font-size:20px;font-weight:bold;color:#111111;">${windowText}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td class="px" align="center" style="padding:28px 44px 8px;font-family:Arial,Helvetica,sans-serif;">
            <!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:52px;v-text-anchor:middle;width:280px;" arcsize="12%" strokecolor="#00d4e8" fillcolor="#00d4e8">
            <w:anchorlock/>
            <center style="color:#04333a;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">Schedule my production</center>
            </v:roundrect>
            <![endif]-->
            <!--[if !mso]><!-->
            <a class="cta" href="${url}" style="background-color:#00d4e8;border-radius:6px;color:#04333a;display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;line-height:52px;text-align:center;text-decoration:none;width:280px;-webkit-text-size-adjust:none;">Schedule my production</a>
            <!--<![endif]-->
          </td>
        </tr>
        <tr>
          <td class="px" align="center" style="padding:6px 44px 36px;font-family:Arial,Helvetica,sans-serif;">
            <p style="margin:0;font-size:13px;line-height:1.6;color:#999999;">Button not working? Paste this into your browser:<br><a href="${url}" style="color:#00a3b4;word-break:break-all;">${url}</a></p>
          </td>
        </tr>
        <tr>
          <td style="padding:22px 44px;background-color:#fafafa;border-top:1px solid #eeeeee;font-family:Arial,Helvetica,sans-serif;">
            <p style="margin:0;font-size:13px;line-height:1.6;color:#999999;">It only takes a minute. Just reply to this email with any questions.</p>
            <p style="margin:10px 0 0;font-size:12px;color:#bbbbbb;">Marketing Empire Group</p>
          </td>
        </tr>
      </table>
      <!--[if (gte mso 9)|(IE)]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}

export interface ReminderRunResult {
  today: string;
  dryRun: boolean;
  sent: Array<{ client: string; email: string; window: Window; attempt: number }>;
  failed: Array<{ client: string; email: string }>;
  basecampCards: Array<{ client: string; ok: boolean; error?: string }>;
  basecampFollowups: Array<{ client: string; ok: boolean; error?: string }>;
  skipped: {
    notConfigured: number;
    notInWindow: number;
    alreadyBooked: number;
    noEmail: number;
    alreadySentToday: number;
    notAFollowupDay: number;
    removed: number;
    declined: number;
  };
}

// Walk every active client and email a scheduling reminder to anyone whose
// window opens within REMINDER_LEAD_DAYS and who hasn't booked it yet. Safe to
// run repeatedly: each client gets at most one email per calendar day.
export async function runReminders(opts?: {
  today?: string;
  dryRun?: boolean;
  // Do the Basecamp card and skip the client email entirely. For when a card
  // failed on its own, usually because the service account was not yet a member
  // of the project, and the email already went out.
  cardOnly?: boolean;
  // Force a fresh Basecamp card even though this window already has one. Only
  // honoured alongside `only`, so it can never mass-create cards across the
  // book. For seeing the real card after its copy changed, since creation is
  // otherwise once per window.
  newCard?: boolean;
  // Narrow the sweep to one client, by id or by name. For testing the outreach
  // on a single account without mailing every eligible client.
  //
  // Targeting one client also lifts the weekday schedule and the once-per-day
  // limit, because both exist to pace a sweep across the whole book and would
  // otherwise make a deliberate test silently do nothing. The window and
  // already-booked checks still apply: those are the behaviour under test.
  only?: string;
}): Promise<ReminderRunResult> {
  const today = opts?.today || todayYmd();
  const dryRun = Boolean(opts?.dryRun);
  const only = (opts?.only || "").trim().toLowerCase();
  const forceNewCard = Boolean(only) && Boolean(opts?.newCard);
  const cardOnly = Boolean(opts?.cardOnly);
  const result: ReminderRunResult = {
    today,
    dryRun,
    sent: [],
    failed: [],
    basecampCards: [],
    basecampFollowups: [],
    skipped: {
      notConfigured: 0,
      notInWindow: 0,
      alreadyBooked: 0,
      noEmail: 0,
      alreadySentToday: 0,
      notAFollowupDay: 0,
      removed: 0,
      declined: 0,
    },
  };

  for (const client of listRevClients(false)) {
    if (only && client.id.toLowerCase() !== only && client.name.toLowerCase() !== only) {
      continue;
    }
    // Skip clients removed from production scheduling.
    if (!client.production_enrolled) {
      result.skipped.removed++;
      continue;
    }
    if (!client.color_week || !client.production_cadence) {
      result.skipped.notConfigured++;
      continue;
    }
    const window = nextWindow(client, today);
    if (!window) {
      result.skipped.notConfigured++;
      continue;
    }
    // Only inside [window.start - lead, window.end].
    const opensReminders = subDays(window.start, REMINDER_LEAD_DAYS);
    if (today < opensReminders || today > window.end) {
      result.skipped.notInWindow++;
      continue;
    }
    // Booked already? Stop reminding.
    if (findSendForWindow(client.id, window.start)) {
      result.skipped.alreadyBooked++;
      continue;
    }
    // The client has already answered this ask with "not that week". Chasing
    // them anyway is the reason this state exists. Targeting one client does
    // not lift this the way it lifts the pacing gates: a decline is the
    // client's word, not a rate limit.
    if (isWindowDeclined(client.id, window.start)) {
      result.skipped.declined++;
      continue;
    }

    // Basecamp team nudge, independent of the client email. The card is created
    // once per window; after that, follow-ups are comments on that same card so
    // the board doesn't fill with duplicates. Both are limited to the
    // Basecamp follow-up weekdays.
    if (!dryRun && client.basecamp_project_id && basecampConnected()) {
      const existingCard = getReminder(client.id, window.start);
      const bcToken = getOrCreateScheduleToken(client.id);
      const bcUrl = bcToken ? scheduleUrl(bcToken) : "";
      if (forceNewCard || !existingCard?.bc_card_at) {
        try {
          // This card asks the client to do something, so the client is the
          // only person on it. The account manager used to be an assignee too,
          // which put our own staff on a card addressed to the client.
          //
          // Assigning is not the same as mentioning: only a mention pings, so
          // the contact is both assigned and tagged in the greeting.
          const people = await getProjectPeopleForMention(client.basecamp_project_id);
          const contact = findClientContact(
            people,
            client.contact_email,
            client.contact_name
          );
          const assigneeIds = contact ? [contact.id] : [];
          // Nobody to tag means the card goes out addressed to no one. That is
          // worth knowing before the client wonders why they were never asked.
          if (!contact) {
            recordFailure({
              kind: "contact_unresolved",
              subject: client.name,
              detail: client.contact_name
                ? `No Basecamp person matches "${client.contact_name}" on this project, so the card was not assigned or tagged.`
                : "No contact name on this client, so the card was not assigned or tagged.",
              hint:
                "Check the contact name on the client matches their name in Basecamp exactly, then post a new card.",
            });
          } else {
            clearFailure("contact_unresolved", client.name);
          }
          const { title: cardTitle, body: cardBody } = scheduleCardContent(
            client,
            window,
            bcUrl,
            contact ? mentionHtml(contact) : undefined
          );
          // Due a week after the outreach card goes out, so it surfaces as
          // overdue if nobody's followed up with the client by then.
          const dueOn = subDays(today, -7);
          const r = await createScheduleCard(
            client.basecamp_project_id,
            cardTitle,
            cardBody,
            assigneeIds,
            dueOn
          );
          if (r.ok) {
            markBasecampCard(client.id, window.start, today, r.cardId);
            clearFailure("basecamp_card", client.name);
          } else {
            recordFailure({
              kind: "basecamp_card",
              subject: client.name,
              detail: `Could not create the scheduling card. ${r.error || ""}`,
              hint:
                "Check King Kashflow is on this Basecamp project and that it still has a Deliverables card table.",
            });
          }
          result.basecampCards.push({ client: client.name, ok: r.ok, error: r.error });
        } catch (e) {
          recordFailure({
            kind: "basecamp_card",
            subject: client.name,
            detail: `Creating the scheduling card threw. ${(e as Error).message}`,
            hint: "Check the client's Basecamp project id is still correct.",
          });
          result.basecampCards.push({ client: client.name, ok: false, error: (e as Error).message });
        }
      } else if (
        existingCard.bc_card_id &&
        // Targeting lifts both pacing gates here, the same way it does for the
        // email. Leaving the daily dedupe in place meant a targeted test sent
        // the email and silently posted nothing, which is the opposite of what
        // a test is for.
        (Boolean(only) ||
          (existingCard.bc_last_nudge !== today && isBasecampFollowupDay(today)))
      ) {
        try {
          const nudgePeople = await getProjectPeopleForMention(client.basecamp_project_id);
          const nudgeContact = findClientContact(
            nudgePeople,
            client.contact_email,
            client.contact_name
          );
          const body = scheduleNudgeContent(
            client,
            window,
            bcUrl,
            today,
            nudgeContact ? mentionHtml(nudgeContact) : undefined
          );
          const r = await commentOnCard(
            client.basecamp_project_id,
            existingCard.bc_card_id,
            body
          );
          if (r.ok) {
            markBasecampNudge(existingCard.id, today);
            clearFailure("basecamp_comment", client.name);
          } else {
            recordFailure({
              kind: "basecamp_comment",
              subject: client.name,
              detail: `Could not comment the follow-up on the card. ${r.error || ""}`,
              hint: "The card may have been deleted. Post a fresh card for this client.",
            });
          }
          result.basecampFollowups.push({
            client: client.name,
            ok: r.ok,
            error: r.error,
          });
        } catch (e) {
          recordFailure({
            kind: "basecamp_comment",
            subject: client.name,
            detail: `The follow-up comment threw. ${(e as Error).message}`,
            hint: "Check the card still exists in Basecamp.",
          });
          result.basecampFollowups.push({
            client: client.name,
            ok: false,
            error: (e as Error).message,
          });
        }
      }
    }

    if (cardOnly) continue;

    if (!client.contact_email?.trim()) {
      result.skipped.noEmail++;
      continue;
    }
    const rec = getReminder(client.id, window.start);
    // Client emails go out on their follow-up weekdays only, so nobody gets a
    // weekend nudge and nobody gets more than two in a week.
    if (!only && !isEmailFollowupDay(today)) {
      result.skipped.notAFollowupDay++;
      continue;
    }
    if (!only && rec && rec.last_sent === today) {
      result.skipped.alreadySentToday++;
      continue;
    }

    const token = getOrCreateScheduleToken(client.id);
    if (!token) {
      result.failed.push({ client: client.name, email: client.contact_email });
      continue;
    }
    const url = scheduleUrl(token);
    const { subject, html, text } = reminderEmail(client, window, url);

    const ok = dryRun
      ? true
      : await sendEmail({ to: client.contact_email, subject, html, text });

    if (ok) {
      if (!dryRun) markReminded(client.id, window.start, today);
      result.sent.push({
        client: client.name,
        email: client.contact_email,
        window,
        attempt: (rec?.count || 0) + 1,
      });
    } else {
      result.failed.push({ client: client.name, email: client.contact_email });
    }
  }

  return result;
}

export interface ShootReminderRunResult {
  today: string;
  dryRun: boolean;
  sent: Array<{ client: string; sendDate: string }>;
  failed: Array<{ client: string; sendDate: string }>;
}

function markShootReminded(sendId: string) {
  getDb()
    .prepare(`UPDATE scheduled_sends SET shoot_reminder_sent_at = ?, updated_at = ? WHERE id = ?`)
    .run(nowIso(), nowIso(), sendId);
}

// Emails clients a "your crew arrives tomorrow" heads-up for confirmed
// productions happening the next day. Runs alongside the scheduling
// reminders; dedupes via shoot_reminder_sent_at so it fires at most once.
export async function runShootReminders(opts?: {
  today?: string;
  dryRun?: boolean;
}): Promise<ShootReminderRunResult> {
  const today = opts?.today || todayYmd();
  const dryRun = Boolean(opts?.dryRun);
  const tomorrow = subDays(today, -1);
  const result: ShootReminderRunResult = { today, dryRun, sent: [], failed: [] };

  const sends = getDb()
    .prepare(
      // requested_by_client is what marks a row as a production. Without it
      // this picks up ordinary campaign sends too, and tells the client a
      // camera crew is arriving for their email blast.
      `SELECT * FROM scheduled_sends
       WHERE send_date = ?
         AND status IN ('scheduled', 'planned')
         AND client_id IS NOT NULL
         AND requested_by_client = 1
         AND cancelled_at IS NULL
         AND shoot_reminder_sent_at IS NULL`
    )
    .all(tomorrow) as ScheduledSend[];

  for (const send of sends) {
    const client = send.client_id ? getRevClient(send.client_id) : null;
    if (!client?.contact_email?.trim()) continue;
    const ok = dryRun ? true : await sendProductionUpcoming(client, send);
    if (ok) {
      if (!dryRun) markShootReminded(send.id);
      result.sent.push({ client: client.name, sendDate: send.send_date });
    } else {
      result.failed.push({ client: client.name, sendDate: send.send_date });
    }
  }

  return result;
}

// Used by the admin production view to show whether/when a client was last
// reminded for their current window.
export { longDate as reminderLongDate };
