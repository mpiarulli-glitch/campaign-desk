import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { isAdminAuthenticated, getAppUrl } from "@/lib/auth";
import { findSendForWindow, nextWindow, todayYmd } from "@/lib/cadence";
import { getOrCreateCrewToken } from "@/lib/calendar";
import { notifyProductionRequested } from "@/lib/notify";
import { listRevClients } from "@/lib/revenue";
import { listVideographers } from "@/lib/videographers";

// Re-sends the Video Editing Campfire notification for a client's current
// production.
//
// The notification is deliberately fire-and-forget: a failure is logged and the
// booking still succeeds, because a Campfire outage must never cost a client
// their slot. The cost of that is a notification can go missing with nobody
// knowing, which is exactly what happened when the service account was not yet a
// member of the Video Editing project. This replays it.
//
// It posts as the service identity, so the message comes from the mascot rather
// than whoever happens to be running it.

function secretMatches(provided: string | null): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || !provided) return false;
  const a = createHmac("sha256", expected).update(provided).digest();
  const b = createHmac("sha256", expected).update(expected).digest();
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function authorized(request: Request): Promise<boolean> {
  if (await isAdminAuthenticated()) return true;
  const url = new URL(request.url);
  const header = request.headers.get("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ")
    ? header.slice(7)
    : null;
  return secretMatches(bearer || url.searchParams.get("secret"));
}

export async function POST(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const only = (url.searchParams.get("only") || "").trim().toLowerCase();
  if (!only) {
    return NextResponse.json(
      { error: "Name the client with ?only=<client id or name>" },
      { status: 400 }
    );
  }
  // The videographer can be overridden, for a production booked before one was
  // assigned to the account.
  const videographerOverride = (url.searchParams.get("videographer") || "").trim();

  const today = todayYmd();
  const client = listRevClients(true).find(
    (candidate) =>
      candidate.id.toLowerCase() === only || candidate.name.toLowerCase() === only
  );
  if (!client) {
    return NextResponse.json({ error: "No client by that id or name." }, { status: 404 });
  }
  const window = nextWindow(client, today);
  const send = window ? findSendForWindow(client.id, window.start) : null;
  if (!send) {
    return NextResponse.json(
      { error: "That client has no production booked for their current window." },
      { status: 404 }
    );
  }

  const videographer = client.videographer_id
    ? listVideographers(true).find((person) => person.id === client.videographer_id)
    : undefined;

  const ok = await notifyProductionRequested({
    clientName: client.name,
    videographerName: videographerOverride || videographer?.name,
    accountManagerName: client.account_manager,
    sendDate: send.send_date,
    sendTime: send.send_time,
    duration: send.duration,
    detailsUrl: (() => {
      const token = getOrCreateCrewToken(send.id);
      return token
        ? `${getAppUrl()}/crew/${token}`
        : `${getAppUrl()}/admin/production/${send.id}`;
    })(),
    note: send.note,
  });

  return NextResponse.json({
    posted: ok,
    client: client.name,
    sendId: send.id,
    sendDate: send.send_date,
    videographer: videographerOverride || videographer?.name || null,
    accountManager: client.account_manager || null,
  });
}
