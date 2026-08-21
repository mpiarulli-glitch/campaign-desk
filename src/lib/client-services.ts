// The weekly Client Services ask: "here are the leads we sent you, did they
// turn into anything, and what did the month do in revenue?"
//
// One ask goes out per client per week, from that client's account manager, on
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
import {
  getOrCreateToken,
  listLeads,
  metricPeriodLabel,
  revenueAsk,
} from "./snapshot";
import { slugForName, teamLabel } from "./team";
import { getUser } from "./users";
import { mondayOf } from "./week";
import { sendEmailWithId } from "./email";
import { recordReachout } from "./reachouts";
import { clearFailure, recordFailure } from "./failures";
import {
  createScheduleCard,
  getProjectPeopleForMention,
  type BcPerson,
} from "./basecamp";

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The master switch for anything that leaves the building.
 *
 * Off unless CLIENT_SERVICES_SENDING is explicitly turned on, so the feature
 * ships dark: the sweep, the cron route and the Send now button all run their
 * full logic and report what they would have done, but no client is emailed and
 * no Basecamp card is posted. Defaulting to off rather than on means forgetting
 * to set it cannot mail the whole book by accident, which is the failure that
 * actually matters here.
 *
 * Flip it by setting CLIENT_SERVICES_SENDING=on.
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
 * Who the ask comes from.
 *
 * rev_clients.account_manager is free text (a slug, a first name, an email), so
 * it is resolved through the same matcher the rest of the app uses and then
 * looked up in the users table for a reply-to address. An unmatched or
 * address-less manager is not an error: the ask still goes, it just falls back
 * to the agency's own from and reply-to.
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
 * Resend will only send from a verified domain, so the account manager's own
 * address cannot go in From without every manager having a mailbox on that
 * domain. Their name does, and their address goes in Reply-To, which is what
 * actually decides where an answer lands. The inbox shows the manager; hitting
 * reply reaches the manager.
 */
export function senderFor(am: AccountManager | null): {
  from: string | undefined;
  replyTo: string | undefined;
} {
  const base = process.env.EMAIL_FROM || "";
  const address = base.match(/<([^>]+)>/)?.[1] || base;
  if (!am || !address) return { from: undefined, replyTo: undefined };
  return {
    from: `${am.label} (Marketing Empire Group) <${address}>`,
    replyTo: am.email || undefined,
  };
}

/* ------------------------------------------------------- what we're asking */

export interface WeeklyAsk {
  month: string;
  monthLabel: string;
  /** Leads the client has not said yes or no to yet. */
  unansweredLeads: SnapshotLead[];
  /** True once we have this month's revenue figure from them. */
  revenueIn: boolean;
  revenueAmount: number | null;
}

export function weeklyAskFor(clientId: string, today?: string): WeeklyAsk | null {
  const ask = revenueAsk(clientId, today);
  // revenueAsk returns null when we already know the month's revenue from
  // another source, which is the one case where there is nothing to ask about
  // on the revenue side. Leads can still be outstanding, so the month is
  // recovered rather than bailing out.
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

/** Nothing outstanding means there is nothing worth emailing about. */
export function hasSomethingToAsk(ask: WeeklyAsk): boolean {
  return !ask.revenueIn || ask.unansweredLeads.length > 0;
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

export function weeklyAskEmail(args: {
  client: RevClient;
  am: AccountManager | null;
  ask: WeeklyAsk;
  link: string;
}): { subject: string; html: string; text: string } {
  const { client, am, ask, link } = args;
  const first = (client.contact_name || "").trim().split(/\s+/)[0];
  const greeting = first ? `Hi ${esc(first)},` : "Hi there,";
  const signer = am?.label || "Marketing Empire Group";
  const leadCount = ask.unansweredLeads.length;

  const bullets: string[] = [];
  const textBullets: string[] = [];
  if (leadCount > 0) {
    const line =
      leadCount === 1
        ? "One lead we sent over is still waiting on a yes or no. Did it turn into business?"
        : `${leadCount} leads we sent over are still waiting on a yes or no. Did any of them turn into business?`;
    bullets.push(line);
    textBullets.push(`- ${line}`);
  }
  if (!ask.revenueIn) {
    const line = `What ${esc(ask.monthLabel)} came to in revenue.`;
    bullets.push(line);
    textBullets.push(`- What ${ask.monthLabel} came to in revenue.`);
  }

  const listHtml = bullets
    .map(
      (b) =>
        `<tr><td valign="top" style="padding:0 10px 10px 0;font-size:16px;line-height:1.6;color:#333333;">&bull;</td>` +
        `<td valign="top" style="padding:0 0 10px;font-size:16px;line-height:1.6;color:#333333;">${b}</td></tr>`
    )
    .join("");

  const subject =
    leadCount > 0 && !ask.revenueIn
      ? `Quick one: your leads and ${ask.monthLabel} revenue`
      : leadCount > 0
        ? "Quick one: did these leads turn into business?"
        : `Quick one: what did ${ask.monthLabel} come to?`;

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
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Two quick numbers and you are done for the week.</div>
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
            <p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#333333;">Your snapshot is up to date with everything we worked on. Two things would help us read it properly:</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">${listHtml}</table>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px;">
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
            <p style="margin:0 0 22px;font-size:16px;line-height:1.6;color:#333333;">It takes about a minute. Thanks,<br>${esc(signer)}</p>
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
    "Your snapshot is up to date with everything we worked on. Two things would help us read it properly:",
    "",
    ...textBullets,
    "",
    `Open your snapshot: ${link}`,
    "",
    "It takes about a minute. Thanks,",
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

export function weeklyAskCardContent(args: {
  ask: WeeklyAsk;
  link: string;
  mention: string;
  amLabel: string;
}): { title: string; body: string } {
  const { ask, link, mention, amLabel } = args;
  const parts: string[] = [];
  if (ask.unansweredLeads.length > 0) {
    parts.push(
      ask.unansweredLeads.length === 1
        ? "<li>One lead is still waiting on a yes or no. Did it turn into business?</li>"
        : `<li>${ask.unansweredLeads.length} leads are still waiting on a yes or no. Did any turn into business?</li>`
    );
  }
  if (!ask.revenueIn) {
    parts.push(`<li>What ${esc(ask.monthLabel)} came to in revenue.</li>`);
  }
  const body =
    `<div>${mention} your weekly snapshot is up to date. Two things would help us read it properly:</div>` +
    `<ul>${parts.join("")}</ul>` +
    `<div><a href="${esc(link)}">Open your snapshot</a></div>` +
    `<div><br>Thanks, ${esc(amLabel)}</div>`;
  return { title: "Weekly snapshot: leads and revenue", body };
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
  /** False when CLIENT_SERVICES_SENDING is off, i.e. nothing actually left. */
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
  // A run with sending switched off behaves exactly like a dry run: everything
  // is resolved and reported, nothing is sent, and nothing is written to the
  // outreach log (so the week does not look spent when it was not).
  const held = !dryRun && !sendingEnabled();
  const simulate = Boolean(dryRun) || held;
  const heldReason = held ? "sending disabled" : "dry run";
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
  const { from, replyTo } = senderFor(am);

  // ---- email
  if (!client.contact_email?.trim()) {
    out.email.skipped = "no contact email";
  } else if (simulate) {
    out.email = { ok: true, skipped: heldReason };
  } else {
    const { subject, html, text } = weeklyAskEmail({ client, am, ask, link });
    const res = await sendEmailWithId({
      to: client.contact_email,
      subject,
      html,
      text,
      from,
      replyTo,
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
        sentTo: client.contact_email,
        providerMessageId: res.id,
      });
      recordReachout({
        clientId: client.id,
        clientName: client.name,
        channel: "email",
        ymd: todayYmd(),
        detail: "Weekly snapshot ask",
      });
      clearFailure("email", client.contact_email);
    } else {
      out.email.error = "Resend refused the send";
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
      // An untagged card pings nobody, so it would sit on the board looking
      // like the client was asked when they were not. Same rule the production
      // sweep uses.
      if (!contact) {
        out.basecamp.skipped = "contact not on the Basecamp project";
        recordFailure({
          kind: "contact_unresolved",
          subject: client.name,
          detail: client.contact_name
            ? `No Basecamp person matches "${client.contact_name}", so no weekly snapshot card was posted.`
            : "No contact name on this client, so no weekly snapshot card was posted.",
          hint: "Check the contact name matches their name in Basecamp exactly.",
        });
      } else {
        const { title, body } = weeklyAskCardContent({
          ask,
          link,
          mention: mentionHtml(contact),
          amLabel: am?.label || "Marketing Empire Group",
        });
        const r = await createScheduleCard(
          client.basecamp_project_id,
          title,
          body,
          [contact.id]
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
            channel: "basecamp_card",
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
 * Skips a client who is paused, who has nothing outstanding to be asked about,
 * or who has already been asked this week. That last one is what makes the run
 * safe to repeat: a re-run on the same Friday sends nothing twice.
 */
export async function runWeeklyAsks(opts?: {
  dryRun?: boolean;
  only?: string;
  today?: string;
}): Promise<WeeklyRunResult> {
  const today = opts?.today || todayYmd();
  const weekStart = currentWeekStart(today);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  const already = new Set(outreachForWeek(weekStart).map((row) => row.client_id));

  const result: WeeklyRunResult = {
    weekStart,
    considered: 0,
    sent: [],
    skipped: { paused: 0, nothingToAsk: 0, alreadySent: 0 },
    dryRun: Boolean(opts?.dryRun),
    sendingEnabled: sendingEnabled(),
  };

  for (const client of listRevClients()) {
    if (opts?.only && client.id !== opts.only && client.name !== opts.only) continue;
    result.considered++;
    // Targeting a single client by hand lifts the pacing gates, so a test send
    // is not silently swallowed by "already sent this week".
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
        dryRun: opts?.dryRun,
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
  paused: boolean;
  hasBasecamp: boolean;
  snapshotUrl: string;
  month: string;
  monthLabel: string;
  leadsWaiting: number;
  revenueIn: boolean;
  revenueAmount: number | null;
  /** Fully answered: revenue in and no lead left hanging. */
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

  return listRevClients().map((client) => {
    const ask = weeklyAskFor(client.id, today);
    const mine = outreach.filter((row) => row.client_id === client.id);
    const email = mine.find((row) => row.channel === "email") || null;
    const bc = mine.find((row) => row.channel === "basecamp") || null;
    const am = accountManagerFor(client);
    const token = client.snapshot_token || "";

    const leadsWaiting = ask?.unansweredLeads.length ?? 0;
    const revenueIn = ask?.revenueIn ?? true;
    const submitted = revenueIn && leadsWaiting === 0;

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
