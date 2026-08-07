import { NextResponse } from "next/server";
import { isAdminAuthenticated, isProductionAuthenticated } from "@/lib/auth";
import { getRevClient, listRevClients } from "@/lib/revenue";
import { effectiveCycleStatus, findSendForWindow, nextWindow, todayYmd } from "@/lib/cadence";
import { recordManualProduction, recordOutOfCycleProduction } from "@/lib/scheduling";
import { getReminder, getLatestReminder } from "@/lib/reminders";
import {
  lastReachoutForClient,
  listRecentReachouts,
  reachoutsForWindow,
} from "@/lib/reachouts";
import { listVideographers } from "@/lib/videographers";
import { listProductionSends } from "@/lib/calendar";
import { listOpenExtraRequests } from "@/lib/extra-requests";

export async function GET() {
  if (!(await isProductionAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const today = todayYmd();
  const clients = listRevClients(true).map((client) => {
    const window = nextWindow(client, today);
    const { status, real: realStatus, overridden } = effectiveCycleStatus(
      client,
      window,
      today
    );
    const existingSend = window ? findSendForWindow(client.id, window.start) : null;
    const currentReminder = window ? getReminder(client.id, window.start) : null;
    const latestReminder = getLatestReminder(client.id);
    const lastReachout = lastReachoutForClient(client.id);
    // Outreach for the window in front of them, on every channel. This is what
    // the status pill reads: a client asked only on Basecamp has an email count
    // of zero and used to show as untouched.
    const currentReachout = window
      ? reachoutsForWindow(client.id, window.start)
      : { count: 0, last: null };
    const openExtraRequest = listOpenExtraRequests(client.id)[0] || null;
    return {
      client: {
        id: client.id,
        name: client.name,
        active: client.active,
        contact_name: client.contact_name,
        contact_email: client.contact_email,
        account_manager: client.account_manager,
        color_week: client.color_week,
        production_cadence: client.production_cadence,
        last_production_date: client.last_production_date,
        schedule_token: client.schedule_token,
        production_enrolled: client.production_enrolled,
        status_override: client.status_override,
        outreach_paused: client.outreach_paused,
        basecamp_project_id: client.basecamp_project_id,
        videographer_id: client.videographer_id,
      },
      window,
      // `status` is what the row should display: the hand-set one if there is
      // one. `realStatus` is what the cadence engine actually computes, kept
      // alongside so an override never hides the truth.
      status,
      realStatus,
      overridden,
      existingSend: existingSend
        ? {
            id: existingSend.id,
            sendDate: existingSend.send_date,
            status: existingSend.status,
          }
        : null,
      // Reminder emails: count on the current window, plus the most recent
      // send date and which window it was for (mirrors the tracker sheet).
      currentReminderCount: currentReminder?.count || 0,
      lastEmailSent: latestReminder?.last_sent || null,
      lastWindowEmailed: latestReminder?.window_start || null,
      // The last time this client was contacted on ANY channel. The email
      // fields above miss a client chased on Basecamp, which is most of them
      // on a Wednesday or Friday.
      lastReachout: lastReachout
        ? {
            channel: lastReachout.channel,
            ymd: lastReachout.ymd,
            detail: lastReachout.detail,
          }
        : null,
      currentReachoutCount: currentReachout.count,
      currentReachoutLast: currentReachout.last
        ? {
            channel: currentReachout.last.channel,
            ymd: currentReachout.last.ymd,
          }
        : null,
      openExtraRequest: openExtraRequest
        ? {
            id: openExtraRequest.id,
            windowStart: openExtraRequest.window_start,
            windowEnd: openExtraRequest.window_end,
            bcCardAt: openExtraRequest.bc_card_at,
            emailSentAt: openExtraRequest.email_sent_at,
          }
        : null,
    };
  });
  return NextResponse.json({
    clients,
    // Cancelled rows come back too, so the Cancelled tab can show them.
    productions: listProductionSends(true),
    today,
    videographers: listVideographers(false),
    // The reach-out log, newest first. Every outbound contact on every channel,
    // which is the surface that answers "who have we chased and when".
    reachouts: listRecentReachouts(200),
  });
}

// Logs a production that was booked outside the app, or (when outOfCycle is
// set) books an extra shoot for a client who's fallen behind. Admin only:
// the manual path can backdate a production and move the client's cadence
// anchor, and the out-of-cycle path skips the cadence link entirely.
export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  if (!clientId) {
    return NextResponse.json({ error: "Pick a client." }, { status: 400 });
  }
  const client = getRevClient(clientId);
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }
  const result = body.outOfCycle === true
    ? await recordOutOfCycleProduction(client, body)
    : await recordManualProduction(client, body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.httpStatus });
  }
  return NextResponse.json({ send: result.send }, { status: 201 });
}
