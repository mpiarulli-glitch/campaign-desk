import { nanoid } from "nanoid";
import { getDb, nowIso, type RevClient, type ScheduleReminder } from "./db";
import {
  findSendForWindow,
  getOrCreateScheduleToken,
  nextWindow,
  todayYmd,
  type Window,
} from "./cadence";
import { listRevClients } from "./revenue";
import { sendEmail } from "./email";
import { scheduleUrl } from "./auth";

// How far ahead of the window's first day the first reminder goes out.
export const REMINDER_LEAD_DAYS = 21;

function subDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
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

function shortDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
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

function reminderEmail(
  client: RevClient,
  window: Window,
  url: string
): { subject: string; html: string; text: string } {
  const name = client.contact_name?.trim();
  const greeting = name ? `Hi ${name},` : "Hi there,";
  const windowText = `${shortDate(window.start)} – ${shortDate(window.end)}`;
  const subject = `Time to schedule ${client.name}'s next production`;

  const text = [
    greeting,
    "",
    `Your next production window is coming up: ${windowText}.`,
    "Pick the day and time that works best and tell us a bit about the shoot here:",
    url,
    "",
    "It only takes a minute. Reply to this email if you have any questions.",
  ].join("\n");

  const html = `
  <div style="font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; max-width: 520px; margin: 0 auto; line-height: 1.6;">
    <div style="text-align:center;padding:8px 0 20px;">
      <img src="https://assets.cdn.filesafe.space/0GKlxMiOTyF1FJ3vPBfo/media/6916cb1921776f532bcab29e.png" alt="Marketing Empire Group"
           width="180" style="width:180px;max-width:70%;height:auto;display:inline-block;" />
    </div>
    <p>${greeting}</p>
    <p>Your next production window is coming up:
      <strong>${windowText}</strong>.</p>
    <p>Pick the day and time that works best and share a few details about the shoot.</p>
    <p style="margin: 28px 0;">
      <a href="${url}"
         style="background:#00d4e8;color:#04333a;text-decoration:none;font-weight:700;
                padding:13px 22px;border-radius:8px;display:inline-block;">
        Schedule your production
      </a>
    </p>
    <p style="color:#555;font-size:14px;">Or paste this link into your browser:<br>
      <a href="${url}" style="color:#04808d;">${url}</a></p>
    <p style="color:#555;font-size:14px;">It only takes a minute. Just reply if you have any questions.</p>
  </div>`.trim();

  return { subject, html, text };
}

export interface ReminderRunResult {
  today: string;
  dryRun: boolean;
  sent: Array<{ client: string; email: string; window: Window; attempt: number }>;
  failed: Array<{ client: string; email: string }>;
  skipped: {
    notConfigured: number;
    notInWindow: number;
    alreadyBooked: number;
    noEmail: number;
    alreadySentToday: number;
  };
}

// Walk every active client and email a scheduling reminder to anyone whose
// window opens within REMINDER_LEAD_DAYS and who hasn't booked it yet. Safe to
// run repeatedly: each client gets at most one email per calendar day.
export async function runReminders(opts?: {
  today?: string;
  dryRun?: boolean;
}): Promise<ReminderRunResult> {
  const today = opts?.today || todayYmd();
  const dryRun = Boolean(opts?.dryRun);
  const result: ReminderRunResult = {
    today,
    dryRun,
    sent: [],
    failed: [],
    skipped: {
      notConfigured: 0,
      notInWindow: 0,
      alreadyBooked: 0,
      noEmail: 0,
      alreadySentToday: 0,
    },
  };

  for (const client of listRevClients(false)) {
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
    if (!client.contact_email?.trim()) {
      result.skipped.noEmail++;
      continue;
    }
    // At most one email per day.
    const rec = getReminder(client.id, window.start);
    if (rec && rec.last_sent === today) {
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

// Used by the admin production view to show whether/when a client was last
// reminded for their current window.
export { longDate as reminderLongDate };
