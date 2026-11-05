// The weekly Client Services ask: what did the month do in revenue, and here
// is the snapshot of the week. Lead outcomes stay in the database for the
// team. Clients are not asked whether a lead closed.
//
// One ask goes out per client per week, from Marketing Empire Group, on
// two channels: an email and a Basecamp message on their project. Both point at
// the same place the client already answers from, their snapshot share link, so
// this adds a prompt rather than a second thing to fill in.
//
// The dashboard needs to answer three questions per client, and this file is
// what produces them:
//
//   Sent      did the ask actually go out this week, and on which channels
//   Opened    did the email get delivered and opened (see the caveat below)
//   Submitted did they give us the numbers we asked for
//
// "Submitted" is not tracked separately: it is read off the answers themselves,
// so it stays true even when a client replies by phone and someone keys it in.

import { nanoid } from "nanoid";
import {
  getDb,
  nowIso,
  type RevClient,
  type SnapshotLead,
  type SnapshotOutreach,
  type SnapshotOutreachChannel,
} from "./db";
import { listRevClients } from "./revenue";
import { enrolledClientIds } from "./snapshot-enrollment";
import {
  getOrCreateToken,
  listLeads,
  metricPeriodLabel,
  revenueAsk,
  weekWins,
} from "./snapshot";
import { filledDepartmentNotes } from "./snapshot-departments";

/** Clients enrolled on the weekly snapshot roster, not every revenue client. */
function listFridayAskClients(): RevClient[] {
  const enrolled = enrolledClientIds();
  return listRevClients().filter((c) => enrolled.has(c.id));
}
import { slugForName, teamLabel } from "./team";
import { basecampNameForManager } from "./people";
import {
  findSylviaOnRoster,
  SYLVIA_CC_EMAIL,
  sylviaCcHtml,
} from "./review-cc";
import { getUser } from "./users";
import { mondayOf } from "./week";
import { sendEmailWithId } from "./email";
import { NO_CONTACT_EMAIL, usableEmail } from "./email-address";
import { recordReachout } from "./reachouts";
import { clearFailure, recordFailure } from "./failures";
import {
  createMessageBoardPost,
  getProjectPeopleForMention,
  type BcPerson,
} from "./basecamp";

/** Always CC'd on Friday weekly snapshot emails. */
export const WEEKLY_SNAPSHOT_CC_EMAIL = SYLVIA_CC_EMAIL;

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Reads CLIENT_SERVICES_SENDING. It does not arm or block a Friday ask.
 *
 * The scheduled sweep never sends, whatever this is set to. A signed-in admin
 * clicking Send on Client Services does send, whether this is on or off.
 */
export function sendingEnabled(): boolean {
  const v = (process.env.CLIENT_SERVICES_SENDING || "").trim().toLowerCase();
  return v === "on" || v === "true" || v === "1";
}

export function currentWeekStart(today?: string): string {
  return mondayOf(today ? new Date(`${today}T00:00:00Z`) : new Date());
}

/* ------------------------------------------------------- account manager */

export interface AccountManager {
  slug: string;
  label: string;
  email: string;
}

/**
 * Who replies go to.
 *
 * rev_clients.account_manager is free text (a slug, a first name, an email), so
 * it is resolved through the same matcher the rest of the app uses and then
 * looked up in the users table for a reply-to address. An unmatched or
 * address-less manager is not an error: the ask still goes from Marketing
 * Empire Group, it just falls back to the agency reply-to.
 */
export function accountManagerFor(client: RevClient): AccountManager | null {
  const slug = slugForName(client.account_manager || "");
  if (!slug) return null;
  const user = getUser(slug);
  return {
    slug,
    label: teamLabel(slug),
    email: (user?.email || "").trim(),
  };
}

/**
 * The From header for a client's ask.
 *
 * Every email leaves as Marketing Empire Group on the verified address.
 * The account manager's address goes in Reply-To, which is what decides
 * where an answer lands.
 */
export function senderFor(am: AccountManager | null): {
  from: string | undefined;
  replyTo: string | undefined;
} {
  const base = process.env.EMAIL_FROM || "";
  const address = base.match(/<([^>]+)>/)?.[1] || base;
  if (!am || !address) return { from: undefined, replyTo: undefined };
  return {
    from: `Marketing Empire Group <${address}>`,
    replyTo: am.email || undefined,
  };
}

/* ------------------------------------------------------- what we're asking */

export interface WeeklyAsk {
  month: string;
  monthLabel: string;
  /** Stored leads still marked unknown. Not part of the ask. */
  unansweredLeads: SnapshotLead[];
  /** True once we have this month's revenue figure from them. */
  revenueIn: boolean;
  revenueAmount: number | null;
}

export function weeklyAskFor(clientId: string, today?: string): WeeklyAsk | null {
  const ask = revenueAsk(clientId, today);
  // revenueAsk returns null when we already know the month's revenue from
  // another source. That is a closed revenue ask, not a missing one.
  const month = ask?.month || previousMonthKey(today || todayYmd());
  const leads = listLeads(clientId).filter((lead) => lead.converted === "unknown");
  return {
    month,
    monthLabel: metricPeriodLabel(month),
    unansweredLeads: leads,
    revenueIn: Boolean(ask?.reportedAt) || !ask,
    revenueAmount: ask?.amount ?? null,
  };
}

function previousMonthKey(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

/** Revenue still owed is the only reason to ask. Lead outcomes are not. */
export function hasSomethingToAsk(ask: WeeklyAsk): boolean {
  return !ask.revenueIn;
}

/* ------------------------------------------------------- the outreach log */

export function recordOutreach(input: {
  clientId: string;
  clientName: string;
  weekStart: string;
  month: string;
  channel: SnapshotOutreachChannel;
  amSlug: string;
  amLabel: string;
  sentTo: string;
  providerMessageId?: string | null;
  detail?: string | null;
}): SnapshotOutreach {
  const row: SnapshotOutreach = {
    id: nanoid(16),
    client_id: input.clientId,
    client_name: input.clientName,
    week_start: input.weekStart,
    month: input.month,
    channel: input.channel,
    am_slug: input.amSlug,
    am_label: input.amLabel,
    sent_to: input.sentTo,
    provider_message_id: input.providerMessageId ?? null,
    sent_at: nowIso(),
    delivered_at: null,
    opened_at: null,
    bounced_at: null,
    detail: input.detail ?? null,
    created_at: nowIso(),
  };
  getDb()
    .prepare(
      `INSERT INTO snapshot_outreach
         (id, client_id, client_name, week_start, month, channel, am_slug,
          am_label, sent_to, provider_message_id, sent_at, delivered_at,
          opened_at, bounced_at, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.id,
      row.client_id,
      row.client_name,
      row.week_start,
      row.month,
      row.channel,
      row.am_slug,
      row.am_label,
      row.sent_to,
      row.provider_message_id,
      row.sent_at,
      row.delivered_at,
      row.opened_at,
      row.bounced_at,
      row.detail,
      row.created_at
    );
  return row;
}

/**
 * Stamp a delivery event onto the row that sent it.
 *
 * Events can arrive out of order and can repeat, so each timestamp is only
 * written once (COALESCE keeps the first). Returns false when the id belongs to
 * some other email the app sent, which is the normal case for most webhooks.
 */
export function markOutreachEvent(
  providerMessageId: string,
  event: "delivered" | "opened" | "bounced",
  at: string
): boolean {
  const column =
    event === "delivered"
      ? "delivered_at"
      : event === "opened"
        ? "opened_at"
        : "bounced_at";
  const res = getDb()
    .prepare(
      `UPDATE snapshot_outreach
         SET ${column} = COALESCE(${column}, ?)
       WHERE provider_message_id = ?`
    )
    .run(at, providerMessageId);
  return res.changes > 0;
}

export function outreachForWeek(weekStart: string): SnapshotOutreach[] {
  return getDb()
    .prepare(
      `SELECT * FROM snapshot_outreach WHERE week_start = ?
       ORDER BY created_at DESC, rowid DESC`
    )
    .all(weekStart) as SnapshotOutreach[];
}

export function outreachForClient(clientId: string, limit = 40): SnapshotOutreach[] {
  return getDb()
    .prepare(
      `SELECT * FROM snapshot_outreach WHERE client_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT ?`
    )
    .all(clientId, limit) as SnapshotOutreach[];
}

/* ------------------------------------------------------- the email */

function esc(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const LOGO =
  "https://assets.cdn.filesafe.space/0GKlxMiOTyF1FJ3vPBfo/media/6916cb146c431e860eb696b9.png";

export type SnapshotWeekItem = { body: string; completed?: boolean };

export type SnapshotWeekCopy = {
  wins?: string[];
  departments?: { label: string; items: Array<string | SnapshotWeekItem> }[];
};

function weekItem(item: string | SnapshotWeekItem): SnapshotWeekItem | null {
  if (typeof item === "string") {
    const body = item.trim();
    return body ? { body, completed: false } : null;
  }
  const body = (item?.body || "").trim();
  return body ? { body, completed: Boolean(item.completed) } : null;
}

function filledWeekDepartments(
  work?: SnapshotWeekCopy
): { label: string; items: SnapshotWeekItem[] }[] {
  return (work?.departments || [])
    .map((dept) => ({
      label: dept.label,
      items: (dept.items || []).map(weekItem).filter((item): item is SnapshotWeekItem => Boolean(item)),
    }))
    .filter((dept) => dept.items.length > 0);
}

function completedMarkHtml(): string {
  return `<span style="color:#188038;font-weight:bold;">&#10003;&nbsp;</span>`;
}

function updateCount(n: number): string {
  return n === 1 ? "1 update" : `${n} updates`;
}

/** Wins and filled departments only. A department with no items is omitted. */
export function snapshotWeekCopy(work?: SnapshotWeekCopy): { html: string; text: string } {
  const wins = (work?.wins || []).map((line) => line.trim()).filter(Boolean);
  const departments = filledWeekDepartments(work);
  if (!wins.length && !departments.length) return { html: "", text: "" };

  const html: string[] = [];
  const text: string[] = [];
  if (wins.length) {
    html.push(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;">` +
        wins
          .map(
            (line) =>
              `<tr><td style="padding:12px 14px;background-color:#fff8e6;border-left:3px solid #c48a00;">` +
              `<p style="margin:0 0 4px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#8a6200;font-weight:bold;">Win</p>` +
              `<p style="margin:0;font-size:16px;line-height:1.5;color:#222222;">${esc(line)}</p>` +
              `</td></tr>`
          )
          .join(`<tr><td style="height:8px;font-size:0;line-height:0;">&nbsp;</td></tr>`) +
        `</table>`
    );
    text.push("Win", ...wins, "");
  }
  for (const dept of departments) {
    const count = updateCount(dept.items.length);
    html.push(
      `<p style="margin:16px 0 6px;font-size:15px;line-height:1.4;color:#111111;font-weight:bold;">${esc(dept.label)} <span style="font-weight:normal;color:#666666;">· ${esc(count)}</span></p>` +
        `<ul style="margin:0 0 8px;padding-left:20px;">` +
        dept.items
          .map(
            (item) =>
              `<li style="margin:0 0 4px;font-size:16px;line-height:1.5;color:#222222;">${item.completed ? completedMarkHtml() : ""}${esc(item.body)}</li>`
          )
          .join("") +
        `</ul>`
    );
    text.push(
      `${dept.label} · ${count}`,
      ...dept.items.map((item) => `${item.completed ? "✓" : "-"} ${item.body}`),
      ""
    );
  }
  return { html: html.join(""), text: text.join("\n") };
}

function snapshotWeekBasecamp(work?: SnapshotWeekCopy): string {
  const wins = (work?.wins || []).map((line) => line.trim()).filter(Boolean);
  const departments = filledWeekDepartments(work);
  if (!wins.length && !departments.length) return "";
  let html = "";
  if (wins.length) {
    html += `<div><br><strong>Win</strong></div>`;
    for (const line of wins) html += `<div>${esc(line)}</div>`;
  }
  for (const dept of departments) {
    html += `<div><br><strong>${esc(dept.label)}</strong> · ${esc(updateCount(dept.items.length))}</div><ul>`;
    for (const item of dept.items) {
      html += `<li>${item.completed ? "&#10003; " : ""}${esc(item.body)}</li>`;
    }
    html += `</ul>`;
  }
  return html;
}

export function weeklyAskEmail(args: {
  client: RevClient;
  am: AccountManager | null;
  ask: WeeklyAsk;
  link: string;
  work?: SnapshotWeekCopy;
}): { subject: string; html: string; text: string } {
  const { client, am, link } = args;
  const workCopy = snapshotWeekCopy(args.work);
  const first = (client.contact_name || "").trim().split(/\s+/)[0];
  const greeting = first ? `Hi ${esc(first)},` : "Hi there,";
  const signer = am?.label || "Marketing Empire Group";
  const subject = "Your New Weekly Snapshot is ready.";
  const line1 = "Your weekly snapshot is ready to review.";
  const line2 = "See what went on across your account this week.";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<title>${esc(subject)}</title>
<style>
  @media screen and (max-width:600px){
    .container{width:100% !important;}
    .px{padding-left:24px !important;padding-right:24px !important;}
    .h1{font-size:26px !important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(line1)} ${esc(line2)}</div>
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
            <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#00a3b4;font-weight:bold;">${esc(client.name)}</p>
            <h1 class="h1" style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:30px;line-height:1.25;color:#111111;font-weight:600;">Your weekly snapshot</h1>
            <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#333333;">${greeting}</p>
            <p style="margin:0 0 12px;font-size:16px;line-height:1.6;color:#333333;">${esc(line1)}</p>
            <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#333333;">${esc(line2)}</p>
            ${workCopy.html}
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 26px;">
              <tr><td>
                <!--[if mso]>
                <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
                  href="${esc(link)}" style="height:50px;v-text-anchor:middle;width:230px;" arcsize="12%"
                  strokecolor="#00a3b4" fillcolor="#00a3b4">
                  <w:anchorlock/>
                  <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">Open your snapshot</center>
                </v:roundrect>
                <![endif]-->
                <!--[if !mso]><!-->
                <a href="${esc(link)}" style="background-color:#00a3b4;border-radius:6px;color:#ffffff;display:inline-block;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;line-height:50px;text-align:center;text-decoration:none;width:230px;-webkit-text-size-adjust:none;">Open your snapshot</a>
                <!--<![endif]-->
              </td></tr>
            </table>
            <p style="margin:0 0 22px;font-size:16px;line-height:1.6;color:#333333;">Thanks,<br>${esc(signer)}</p>
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

  const text = [
    greeting,
    "",
    line1,
    line2,
    "",
    ...(workCopy.text ? [workCopy.text] : []),
    `Open your snapshot: ${link}`,
    "",
    "Thanks,",
    signer,
  ].join("\n");

  return { subject, html, text };
}

/* ------------------------------------------------------- the Basecamp ask */

function mentionHtml(person: BcPerson): string {
  return `<bc-attachment sgid="${person.attachable_sgid}" content-type="application/vnd.basecamp.mention"></bc-attachment>`;
}

function resolveContact(client: RevClient, people: BcPerson[]): BcPerson | null {
  const want = (client.poc || client.contact_name || "").trim().toLowerCase();
  if (!want) return null;
  return (
    people.find((p) => p.name.trim().toLowerCase() === want) ||
    people.find((p) => p.name.trim().toLowerCase().startsWith(want)) ||
    null
  );
}

/**
 * Find the client's account manager on a Basecamp project roster.
 *
 * Uses the explicit ACCOUNT_MANAGER_BASECAMP_NAME map (e.g. "Kyle" → "Morris
 * Kyle") so a first-name store value cannot ping Kyle Onstott instead of
 * Morris. Falls back to the team label only for an exact name match.
 */
export function resolveAccountManagerOnProject(
  people: BcPerson[],
  accountManager: string,
  am?: AccountManager | null
): BcPerson | null {
  const raw = (accountManager || "").trim();
  if (!raw && !am) return null;
  const slug = am?.slug || slugForName(raw) || "";
  const label = am?.label || (slug ? teamLabel(slug) : "") || raw;
  const first = (label || raw).split(/\s+/)[0] || "";
  const slugHead = slug.split("_")[0] || "";
  const queries = [
    basecampNameForManager(slugHead),
    basecampNameForManager(first.toLowerCase()),
    label,
    raw,
  ]
    .map((v) => (v || "").trim().toLowerCase())
    .filter(Boolean);

  for (const q of [...new Set(queries)]) {
    const hit = people.find((p) => p.name.trim().toLowerCase() === q);
    if (hit) return hit;
  }
  return null;
}

export function weeklyAskMessageContent(args: {
  ask: WeeklyAsk;
  link: string;
  mention: string;
  /** Real Basecamp @mention HTML for the account manager, when resolved. */
  amMention?: string;
  amLabel: string;
  /** Real Basecamp @mention HTML for Sylvia's CC line, when resolved. */
  sylviaMention?: string;
  work?: SnapshotWeekCopy;
}): { title: string; body: string } {
  const { link, mention, amLabel } = args;
  const workHtml = snapshotWeekBasecamp(args.work);
  const amMention = (args.amMention || "").trim();
  const thanks = amMention
    ? `Thanks, ${amMention}`
    : `Thanks, ${esc(amLabel)}`;
  const body =
    `<div>${mention} your weekly snapshot is ready to review.</div>` +
    `<div>See what went on across your account this week.</div>` +
    workHtml +
    `<div><br><a href="${esc(link)}">Open your snapshot</a></div>` +
    `<div><br>${thanks}</div>` +
    sylviaCcHtml(args.sylviaMention);
  return { title: "Your weekly snapshot is ready", body };
}

/* ------------------------------------------------------- the sweep */

export interface AskSendResult {
  clientId: string;
  clientName: string;
  email: { ok: boolean; skipped?: string; error?: string };
  basecamp: { ok: boolean; skipped?: string; error?: string };
}

export interface WeeklyRunResult {
  weekStart: string;
  considered: number;
  sent: AskSendResult[];
  skipped: { paused: number; nothingToAsk: number; alreadySent: number };
  dryRun: boolean;
  /** The CLIENT_SERVICES_SENDING env value. The sweep ignores it and never sends. */
  sendingEnabled: boolean;
}

/**
 * Send one client's ask on both channels.
 *
 * The two channels are independent on purpose: a client who is not findable on
 * their Basecamp project should still get the email, and a client with no email
 * address should still get the card.
 */
export async function sendWeeklyAsk(args: {
  client: RevClient;
  weekStart: string;
  appUrl: string;
  dryRun?: boolean;
}): Promise<AskSendResult> {
  const { client, weekStart, appUrl, dryRun } = args;
  if (client.outreach_paused) {
    return {
      clientId: client.id,
      clientName: client.name,
      email: { ok: false, skipped: "paused" },
      basecamp: { ok: false, skipped: "paused" },
    };
  }
  // dryRun reports the ask and writes nothing. CLIENT_SERVICES_SENDING does
  // not hold a send: the Client Services button is a person deciding to send,
  // and the scheduled sweep never calls this without dryRun.
  const simulate = Boolean(dryRun);
  const heldReason = "dry run";
  const out: AskSendResult = {
    clientId: client.id,
    clientName: client.name,
    email: { ok: false },
    basecamp: { ok: false },
  };

  const ask = weeklyAskFor(client.id);
  if (!ask) {
    out.email.skipped = "nothing to ask";
    out.basecamp.skipped = "nothing to ask";
    return out;
  }
  const token = getOrCreateToken(client.id);
  if (!token) {
    out.email.skipped = "no snapshot link";
    out.basecamp.skipped = "no snapshot link";
    return out;
  }
  const link = `${appUrl.replace(/\/$/, "")}/snapshot/${token}`;
  const am = accountManagerFor(client);
  const work = {
    wins: weekWins(weekStart)
      .filter((row) => row.client_id === client.id)
      .map((row) => row.body),
    departments: filledDepartmentNotes(client.id, weekStart).map((note) => ({
      label: note.label,
      items: note.items.map((item) => ({ body: item.body, completed: item.completed })),
    })),
  };
  const { from, replyTo } = senderFor(am);

  // ---- email
  const to = usableEmail(client.contact_email);
  if (!to) {
    out.email.skipped = "no contact email";
    if ((client.contact_email || "").trim()) {
      recordFailure({
        kind: "contact_unresolved",
        subject: client.name,
        detail: NO_CONTACT_EMAIL,
        hint: "Add a contact email on the client before the weekly ask can be emailed.",
      });
    }
  } else if (simulate) {
    out.email = { ok: true, skipped: heldReason };
  } else {
    const { subject, html, text } = weeklyAskEmail({ client, am, ask, link, work });
    const res = await sendEmailWithId({
      to,
      subject,
      html,
      text,
      from,
      replyTo,
      cc: WEEKLY_SNAPSHOT_CC_EMAIL,
    });
    out.email.ok = res.ok;
    if (res.ok) {
      recordOutreach({
        clientId: client.id,
        clientName: client.name,
        weekStart,
        month: ask.month,
        channel: "email",
        amSlug: am?.slug || "",
        amLabel: am?.label || "",
        sentTo: to,
        providerMessageId: res.id,
      });
      recordReachout({
        clientId: client.id,
        clientName: client.name,
        channel: "email",
        ymd: todayYmd(),
        detail: "Weekly snapshot ask",
      });
      clearFailure("email", to);
    } else {
      out.email.error = res.error || "Resend refused the send";
    }
  }

  // ---- basecamp
  if (!client.basecamp_project_id) {
    out.basecamp.skipped = "no Basecamp project";
  } else if (simulate) {
    out.basecamp = { ok: true, skipped: heldReason };
  } else {
    try {
      const people = await getProjectPeopleForMention(client.basecamp_project_id);
      const contact = resolveContact(client, people);
      // An unmentioned message pings nobody, so it would sit on the board
      // looking like the client was asked when they were not. Same rule the
      // production sweep uses for cards.
      if (!contact) {
        out.basecamp.skipped = "contact not on the Basecamp project";
        recordFailure({
          kind: "contact_unresolved",
          subject: client.name,
          detail: client.contact_name
            ? `No Basecamp person matches "${client.contact_name}", so no weekly snapshot message was posted.`
            : "No contact name on this client, so no weekly snapshot message was posted.",
          hint: "Check the contact name matches their name in Basecamp exactly.",
        });
      } else {
        const manager = resolveAccountManagerOnProject(
          people,
          client.account_manager || "",
          am
        );
        const sylvia = findSylviaOnRoster(people);
        const { title, body } = weeklyAskMessageContent({
          ask,
          link,
          mention: mentionHtml(contact),
          amMention: manager ? mentionHtml(manager) : "",
          amLabel: am?.label || "Marketing Empire Group",
          sylviaMention: sylvia ? mentionHtml(sylvia) : "",
          work,
        });
        // Notify the same people the card used to assign. Omitting this list
        // would ping everyone on the project.
        const subscriberIds = [contact.id];
        if (manager && manager.id !== contact.id) subscriberIds.push(manager.id);
        if (
          sylvia &&
          sylvia.id !== contact.id &&
          (!manager || sylvia.id !== manager.id)
        ) {
          subscriberIds.push(sylvia.id);
        }
        const r = await createMessageBoardPost(
          client.basecamp_project_id,
          title,
          body,
          subscriberIds
        );
        out.basecamp.ok = r.ok;
        if (r.ok) {
          recordOutreach({
            clientId: client.id,
            clientName: client.name,
            weekStart,
            month: ask.month,
            channel: "basecamp",
            amSlug: am?.slug || "",
            amLabel: am?.label || "",
            sentTo: contact.name,
          });
          recordReachout({
            clientId: client.id,
            clientName: client.name,
            channel: "basecamp_message",
            ymd: todayYmd(),
            detail: "Weekly snapshot ask",
          });
          clearFailure("contact_unresolved", client.name);
        } else {
          out.basecamp.error = r.error || "Basecamp refused the card";
        }
      }
    } catch (e) {
      out.basecamp.error = (e as Error).message;
    }
  }

  return out;
}

/**
 * The Friday sweep.
 *
 * This path never emails a client and never posts to Basecamp. A person sends
 * one client from Client Services, which calls sendWeeklyAsk. `dryRun` on the
 * options is ignored so a cron caller cannot turn a live send back on.
 *
 * Still skips a client who is paused, who has nothing outstanding, or who was
 * already asked this week, and reports what a real send would have done.
 */
export async function runWeeklyAsks(opts?: {
  /** Ignored. The sweep never sends. */
  dryRun?: boolean;
  only?: string;
  today?: string;
}): Promise<WeeklyRunResult> {
  const today = opts?.today || todayYmd();
  const weekStart = currentWeekStart(today);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  const already = new Set(outreachForWeek(weekStart).map((row) => row.client_id));
  const dryRun = true;

  const result: WeeklyRunResult = {
    weekStart,
    considered: 0,
    sent: [],
    skipped: { paused: 0, nothingToAsk: 0, alreadySent: 0 },
    dryRun,
    sendingEnabled: sendingEnabled(),
  };

  for (const client of listFridayAskClients()) {
    if (opts?.only && client.id !== opts.only && client.name !== opts.only) continue;
    result.considered++;
    // Targeting one client lifts the pacing gates in this report, so a dry run
    // can still show them. It does not send. A real send is sendWeeklyAsk.
    const targeted = Boolean(opts?.only);
    if (!targeted && client.outreach_paused) {
      result.skipped.paused++;
      continue;
    }
    if (!targeted && already.has(client.id)) {
      result.skipped.alreadySent++;
      continue;
    }
    const ask = weeklyAskFor(client.id, today);
    if (!targeted && (!ask || !hasSomethingToAsk(ask))) {
      result.skipped.nothingToAsk++;
      continue;
    }
    result.sent.push(
      await sendWeeklyAsk({
        client,
        weekStart,
        appUrl,
        dryRun,
      })
    );
  }

  return result;
}

/* ------------------------------------------------------- dashboard rollup */

export type AskStatus =
  | "paused"
  | "nothing_to_ask"
  | "not_sent"
  | "sent"
  | "delivered"
  | "opened"
  | "bounced"
  | "submitted";

export interface ClientServiceRow {
  clientId: string;
  name: string;
  accountManager: string;
  accountManagerEmail: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  paused: boolean;
  hasBasecamp: boolean;
  snapshotUrl: string;
  month: string;
  monthLabel: string;
  leadsWaiting: number;
  revenueIn: boolean;
  revenueAmount: number | null;
  /** Fully answered: this month's revenue is in. */
  submitted: boolean;
  status: AskStatus;
  emailSentAt: string | null;
  emailDeliveredAt: string | null;
  emailOpenedAt: string | null;
  emailBouncedAt: string | null;
  basecampSentAt: string | null;
}

/**
 * One row per active client for the dashboard.
 *
 * status is the furthest point the client has reached this week, so the column
 * reads as a pipeline rather than as four independent booleans. Submitted
 * outranks opened: somebody who answered without the pixel ever firing has
 * plainly engaged, and showing them as "not opened" would be wrong.
 */
export function clientServiceRows(today?: string): ClientServiceRow[] {
  const weekStart = currentWeekStart(today);
  const outreach = outreachForWeek(weekStart);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

  return listFridayAskClients().map((client) => {
    const ask = weeklyAskFor(client.id, today);
    const mine = outreach.filter((row) => row.client_id === client.id);
    const email = mine.find((row) => row.channel === "email") || null;
    const bc = mine.find((row) => row.channel === "basecamp") || null;
    const am = accountManagerFor(client);
    const token = client.snapshot_token || "";

    const leadsWaiting = ask?.unansweredLeads.length ?? 0;
    const revenueIn = ask?.revenueIn ?? true;
    const submitted = revenueIn;

    let status: AskStatus;
    if (submitted) status = "submitted";
    else if (client.outreach_paused) status = "paused";
    else if (!ask || !hasSomethingToAsk(ask)) status = "nothing_to_ask";
    else if (email?.bounced_at) status = "bounced";
    else if (email?.opened_at) status = "opened";
    else if (email?.delivered_at) status = "delivered";
    else if (email?.sent_at || bc?.sent_at) status = "sent";
    else status = "not_sent";

    return {
      clientId: client.id,
      name: client.name,
      accountManager: am?.label || (client.account_manager || "").trim(),
      accountManagerEmail: am?.email || "",
      contactName: client.contact_name || "",
      contactEmail: client.contact_email || "",
      contactPhone: client.contact_phone || "",
      paused: Boolean(client.outreach_paused),
      hasBasecamp: Boolean(client.basecamp_project_id),
      snapshotUrl: token && appUrl ? `${appUrl}/snapshot/${token}` : "",
      month: ask?.month || "",
      monthLabel: ask?.monthLabel || "",
      leadsWaiting,
      revenueIn,
      revenueAmount: ask?.revenueAmount ?? null,
      submitted,
      status,
      emailSentAt: email?.sent_at || null,
      emailDeliveredAt: email?.delivered_at || null,
      emailOpenedAt: email?.opened_at || null,
      emailBouncedAt: email?.bounced_at || null,
      basecampSentAt: bc?.sent_at || null,
    };
  });
}

export interface ClientServiceSummary {
  weekStart: string;
  clients: number;
  sent: number;
  opened: number;
  submitted: number;
  waiting: number;
}

export function clientServiceSummary(
  rows: ClientServiceRow[],
  today?: string
): ClientServiceSummary {
  return {
    weekStart: currentWeekStart(today),
    clients: rows.length,
    sent: rows.filter((r) => r.emailSentAt || r.basecampSentAt).length,
    opened: rows.filter((r) => r.emailOpenedAt).length,
    submitted: rows.filter((r) => r.submitted).length,
    waiting: rows.filter((r) => !r.submitted && !r.paused).length,
  };
}
