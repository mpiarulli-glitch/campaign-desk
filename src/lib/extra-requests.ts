// An admin-defined, hand-picked window for a client who needs an extra
// production outside their regular cadence — usually because they've fallen
// behind. Reaches the client the same way the automatic cadence reminder
// does (a Basecamp card on their project, plus an email), but there's no
// recurring nudge sweep: one outreach, and an admin can resend by hand if
// nothing happens.
//
// The window here is a display/booking bound only. Booking inside it still
// writes cadence_window_start = null on the resulting send (see
// submitOutOfCycleBooking/recordOutOfCycleProduction in scheduling.ts), so it
// can never advance the client's regular cadence anchor the way a real
// cadence window does.
import { nanoid } from "nanoid";
import {
  getDb,
  nowIso,
  type ExtraProductionRequest,
  type RevClient,
} from "./db";
import { getOrCreateScheduleToken } from "./cadence";
import { scheduleUrl } from "./auth";
import { sendEmail } from "./email";
import {
  basecampConnected,
  createScheduleCard,
  findClientContact,
  getProjectPeopleForMention,
  mentionHtml,
} from "./basecamp";
import { recordFailure, clearFailure } from "./failures";

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

export function getExtraRequest(id: string): ExtraProductionRequest | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM extra_production_requests WHERE id = ?`)
      .get(id) as ExtraProductionRequest | undefined) || null
  );
}

// Every not-yet-resolved window for a client, newest first. "Open" means
// neither booked nor called off — a client can have more than one if an
// admin sent a second ask before the first landed.
export function listOpenExtraRequests(
  clientId: string
): ExtraProductionRequest[] {
  return getDb()
    .prepare(
      `SELECT * FROM extra_production_requests
       WHERE client_id = ? AND fulfilled_at IS NULL AND cancelled_at IS NULL
       ORDER BY created_at DESC`
    )
    .all(clientId) as ExtraProductionRequest[];
}

export function listExtraRequestsForClient(
  clientId: string
): ExtraProductionRequest[] {
  return getDb()
    .prepare(
      `SELECT * FROM extra_production_requests WHERE client_id = ? ORDER BY created_at DESC`
    )
    .all(clientId) as ExtraProductionRequest[];
}

export function createExtraRequest(input: {
  clientId: string;
  windowStart: string;
  windowEnd: string;
  note?: string;
  createdBy?: string;
}): ExtraProductionRequest {
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  db.prepare(
    `INSERT INTO extra_production_requests
      (id, client_id, window_start, window_end, note, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.clientId,
    input.windowStart,
    input.windowEnd,
    (input.note || "").trim(),
    (input.createdBy || "").trim(),
    ts,
    ts
  );
  return getExtraRequest(id)!;
}

export function cancelExtraRequest(id: string): void {
  getDb()
    .prepare(
      `UPDATE extra_production_requests SET cancelled_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(nowIso(), nowIso(), id);
}

export function fulfillExtraRequest(id: string, sendId: string): void {
  const ts = nowIso();
  getDb()
    .prepare(
      `UPDATE extra_production_requests
       SET fulfilled_send_id = ?, fulfilled_at = ?, updated_at = ?
       WHERE id = ? AND fulfilled_at IS NULL`
    )
    .run(sendId, ts, ts, id);
}

// A booking date/client may satisfy more than one open window (rare, but two
// asks can overlap); fulfil the earliest-created one so the oldest ask is the
// one that resolves.
export function fulfillMatchingExtraRequest(
  clientId: string,
  date: string,
  sendId: string
): void {
  const match = getDb()
    .prepare(
      `SELECT id FROM extra_production_requests
       WHERE client_id = ? AND fulfilled_at IS NULL AND cancelled_at IS NULL
         AND window_start <= ? AND window_end >= ?
       ORDER BY created_at ASC LIMIT 1`
    )
    .get(clientId, date, date) as { id: string } | undefined;
  if (match) fulfillExtraRequest(match.id, sendId);
}

// After the invited dates have passed, a makeup booking is outside that
// range, so fulfillMatchingExtraRequest will not see it. Close the oldest
// expired ask so the invite does not keep leading the scheduling link.
export function fulfillExpiredOpenExtraRequest(
  clientId: string,
  today: string,
  sendId: string
): void {
  const match = getDb()
    .prepare(
      `SELECT id FROM extra_production_requests
       WHERE client_id = ? AND fulfilled_at IS NULL AND cancelled_at IS NULL
         AND window_end < ?
       ORDER BY created_at ASC LIMIT 1`
    )
    .get(clientId, today) as { id: string } | undefined;
  if (match) fulfillExtraRequest(match.id, sendId);
}

function markCard(id: string, cardId?: string) {
  getDb()
    .prepare(
      `UPDATE extra_production_requests SET bc_card_id = ?, bc_card_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(cardId || null, nowIso(), nowIso(), id);
}

function markEmailed(id: string) {
  getDb()
    .prepare(
      `UPDATE extra_production_requests SET email_sent_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(nowIso(), nowIso(), id);
}

export function extraRequestCardContent(
  client: RevClient,
  request: ExtraProductionRequest,
  url: string,
  contactMention?: string
): { title: string; body: string } {
  const hello = contactMention
    ? `Hi ${contactMention},`
    : client.contact_name?.trim()
      ? `Hi ${escapeHtml(client.contact_name.trim())},`
      : "Hi there,";
  const windowText = `${longDate(request.window_start)} to ${longDate(request.window_end)}`;
  const note = request.note
    ? `<div>${escapeHtml(request.note)}</div><div><br></div>`
    : "";
  const body =
    `<div>${hello}</div>` +
    `<div><br></div>` +
    `<div>We'd like to schedule a production with you. Any weekday between ` +
    `<strong>${escapeHtml(windowText)}</strong> works.</div>` +
    `<div><br></div>` +
    note +
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
  return { title: "Let's schedule a production", body };
}

export function extraRequestEmail(
  client: RevClient,
  request: ExtraProductionRequest,
  url: string
): { subject: string; html: string; text: string } {
  const esc = escapeHtml;
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
  const year = request.window_start.split("-")[0];
  const windowText = `${fmtLong(request.window_start)} – ${fmtLong(request.window_end)}, ${year}`;
  const subject = "Let's schedule a production";
  const preheader = "We'd like to schedule a production with you.";
  const logo =
    "https://assets.cdn.filesafe.space/0GKlxMiOTyF1FJ3vPBfo/media/6916cb146c431e860eb696b9.png";
  const noteText = request.note ? `\n${request.note}\n` : "";

  const text = [
    greeting,
    "",
    "We'd like to schedule a production with you.",
    noteText,
    "Pick a day and time here:",
    url,
    "",
    `Any weekday from ${windowText} works.`,
    "Just reply to this email with any questions.",
  ]
    .filter(Boolean)
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<title>${subject}</title>
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
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(preheader)}</div>
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
            <h1 class="h1" style="margin:0 0 18px;font-family:'Poppins',Arial,Helvetica,sans-serif;font-size:30px;line-height:1.25;color:#111111;font-weight:600;">Let&rsquo;s schedule a production</h1>
            <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#333333;">${greeting}</p>
            <p style="margin:0 0 22px;font-size:16px;line-height:1.6;color:#333333;">We&rsquo;d like to schedule a production with you. Pick the day and time that work best.${request.note ? ` ${esc(request.note)}` : ""}</p>
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
            <p style="margin:0;font-size:13px;line-height:1.6;color:#999999;">Just reply to this email with any questions.</p>
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

export interface OutreachResult {
  basecamp: { ok: boolean; error?: string; skipped?: boolean };
  email: { ok: boolean; skipped?: boolean };
}

// Fires both halves of the outreach for a freshly created request: the
// Basecamp card on the client's own project (written to the client, same
// convention as the cadence reminder card) and the client email. Safe to
// call again for a resend — each half just overwrites its own timestamp.
export async function sendExtraRequestOutreach(
  request: ExtraProductionRequest,
  client: RevClient
): Promise<OutreachResult> {
  const result: OutreachResult = {
    basecamp: { ok: false, skipped: true },
    email: { ok: false, skipped: true },
  };

  const token = getOrCreateScheduleToken(client.id);
  const url = token ? scheduleUrl(token) : "";

  if (client.basecamp_project_id && basecampConnected()) {
    try {
      const people = await getProjectPeopleForMention(client.basecamp_project_id);
      const contact = findClientContact(
        people,
        client.contact_email,
        client.contact_name
      );
      if (!contact) {
        recordFailure({
          kind: "contact_unresolved",
          subject: client.name,
          detail: client.contact_name
            ? `No Basecamp person matches "${client.contact_name}" on this project, so the extra-production card was not assigned or tagged.`
            : "No contact name on this client, so the extra-production card was not assigned or tagged.",
          hint:
            "Check the contact name on the client matches their name in Basecamp exactly, then resend.",
        });
      } else {
        clearFailure("contact_unresolved", client.name);
      }
      const { title, body } = extraRequestCardContent(
        client,
        request,
        url,
        contact ? mentionHtml(contact) : undefined
      );
      const r = await createScheduleCard(
        client.basecamp_project_id,
        title,
        body,
        contact ? [contact.id] : [],
        request.window_end
      );
      result.basecamp = { ok: r.ok, error: r.error };
      if (r.ok) {
        markCard(request.id, r.cardId);
        clearFailure("basecamp_card", client.name);
      } else {
        recordFailure({
          kind: "basecamp_card",
          subject: client.name,
          detail: `Could not create the extra-production card. ${r.error || ""}`,
          hint:
            "Check King Kashflow is on this Basecamp project and that it still has a Deliverables card table.",
        });
      }
    } catch (e) {
      result.basecamp = { ok: false, error: (e as Error).message };
      recordFailure({
        kind: "basecamp_card",
        subject: client.name,
        detail: `Creating the extra-production card threw. ${(e as Error).message}`,
        hint: "Check the client's Basecamp project id is still correct.",
      });
    }
  }

  if (client.contact_email?.trim() && url) {
    const { subject, html, text } = extraRequestEmail(client, request, url);
    const ok = await sendEmail({ to: client.contact_email, subject, html, text });
    result.email = { ok };
    if (ok) markEmailed(request.id);
  }

  return result;
}
