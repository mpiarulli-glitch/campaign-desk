// Client-facing production scheduling emails: request received, booking
// confirmed, and a day-before heads-up. Shares the branded shell used by the
// "time to schedule" reminder in reminders.ts.
import type { RevClient, ScheduledSend } from "./db";
import { sendEmail } from "./email";

const LOGO =
  "https://assets.cdn.filesafe.space/0GKlxMiOTyF1FJ3vPBfo/media/6916cb146c431e860eb696b9.png";

function esc(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtLongDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function slotLabel(hhmm: string): string {
  if (!hhmm) return "";
  const h = Number(hhmm.split(":")[0]);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12} ${period}`;
}

function shell(args: {
  subject: string;
  preheader: string;
  eyebrow: string;
  headline: string;
  bodyHtml: string;
  bodyText: string[];
}): { subject: string; html: string; text: string } {
  const { subject, preheader, eyebrow, headline, bodyHtml, bodyText } = args;
  const text = bodyText.join("\n");
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
            <img src="${LOGO}" alt="Marketing Empire Group" width="170" style="display:block;width:170px;max-width:60%;height:auto;border:0;">
          </td>
        </tr>
        <tr>
          <td class="px" style="padding:40px 44px 8px;font-family:Arial,Helvetica,sans-serif;">
            <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#00a3b4;font-weight:bold;">${esc(eyebrow)}</p>
            <h1 class="h1" style="margin:0 0 18px;font-family:'Poppins',Arial,Helvetica,sans-serif;font-size:30px;line-height:1.25;color:#111111;font-weight:600;">${esc(headline)}</h1>
            ${bodyHtml}
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

// Fired the moment a client submits a slot on their scheduling link.
export async function sendProductionRequestReceived(
  client: RevClient,
  send: ScheduledSend
): Promise<boolean> {
  if (!client.contact_email?.trim()) return false;
  const name = client.contact_name?.trim();
  const greeting = name ? `Hi ${esc(name)},` : "Hi there,";
  const when = `${fmtLongDate(send.send_date)}${send.send_time ? ` at ${slotLabel(send.send_time)}` : ""}`;

  const { subject, html, text } = shell({
    subject: `${client.name}: we've got your production request`,
    preheader: `Your request for ${when} is in. Your account manager will confirm shortly.`,
    eyebrow: client.name,
    headline: "Your request is in",
    bodyHtml: `
      <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#333333;">${greeting}</p>
      <p style="margin:0 0 22px;font-size:16px;line-height:1.6;color:#333333;">Thanks for booking your next production. We've got you down for <strong>${esc(when)}</strong>. Your account manager will confirm this shortly.</p>
    `,
    bodyText: [
      greeting,
      "",
      `Thanks for booking your next production. We've got you down for ${when}.`,
      "Your account manager will confirm this shortly.",
    ],
  });

  return sendEmail({ to: client.contact_email, subject, html, text });
}

// Fired when an admin locks a requested production in as scheduled/planned.
export async function sendProductionConfirmed(
  client: RevClient,
  send: ScheduledSend
): Promise<boolean> {
  if (!client.contact_email?.trim()) return false;
  const name = client.contact_name?.trim();
  const greeting = name ? `Hi ${esc(name)},` : "Hi there,";
  const when = `${fmtLongDate(send.send_date)}${send.send_time ? ` at ${slotLabel(send.send_time)}` : ""}`;

  const { subject, html, text } = shell({
    subject: `${client.name}: your production is confirmed`,
    preheader: `You're booked for ${when}.`,
    eyebrow: client.name,
    headline: "You're booked",
    bodyHtml: `
      <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#333333;">${greeting}</p>
      <p style="margin:0 0 22px;font-size:16px;line-height:1.6;color:#333333;">Your production is confirmed for <strong>${esc(when)}</strong>. We'll see you then.</p>
    `,
    bodyText: [
      greeting,
      "",
      `Your production is confirmed for ${when}.`,
      "We'll see you then.",
    ],
  });

  return sendEmail({ to: client.contact_email, subject, html, text });
}

// Fired the day before a confirmed production.
export async function sendProductionUpcoming(
  client: RevClient,
  send: ScheduledSend
): Promise<boolean> {
  if (!client.contact_email?.trim()) return false;
  const name = client.contact_name?.trim();
  const greeting = name ? `Hi ${esc(name)},` : "Hi there,";
  const when = `${fmtLongDate(send.send_date)}${send.send_time ? ` at ${slotLabel(send.send_time)}` : ""}`;

  const { subject, html, text } = shell({
    subject: `${client.name}: your crew arrives tomorrow`,
    preheader: `Quick reminder — your production is tomorrow, ${when}.`,
    eyebrow: client.name,
    headline: "Your crew arrives tomorrow",
    bodyHtml: `
      <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#333333;">${greeting}</p>
      <p style="margin:0 0 22px;font-size:16px;line-height:1.6;color:#333333;">Just a heads up: your production is tomorrow, <strong>${esc(when)}</strong>. Your crew typically arrives 15-30 minutes early to set up.</p>
    `,
    bodyText: [
      greeting,
      "",
      `Just a heads up: your production is tomorrow, ${when}.`,
      "Your crew typically arrives 15-30 minutes early to set up.",
    ],
  });

  return sendEmail({ to: client.contact_email, subject, html, text });
}
