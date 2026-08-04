import { NextResponse } from "next/server";
import { getAppUrl } from "@/lib/auth";
import { approveByCrew, getOrCreateCrewToken } from "@/lib/calendar";
import { notifyProductionApproved } from "@/lib/notify";
import { sendProductionConfirmed } from "@/lib/production-emails";
import { getRevClient } from "@/lib/revenue";
import { listVideographers } from "@/lib/videographers";

// The crew accepting a job from their link.
//
// A client booking arrives as a request, which is not yet a scheduled
// production: it is waiting on the crew to say they can do it, which is what the
// Needs Approval card on the client's board represents. Approving here is what
// turns it into a scheduled production, tells the client, and lets the account
// manager know without them opening the app.
//
// Authorised by the token alone, like the client review and scheduling links.
// This link only ever goes to the Video Editing Campfire.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const result = approveByCrew(token);
  if (!result.ok) {
    const status = result.error === "Not found" ? 404 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }
  const send = result.send;

  // Pressing it twice, or two people pressing it, must not email the client
  // twice or post to the Campfire again.
  if (!result.alreadyDone) {
    const client = send.client_id ? getRevClient(send.client_id) : null;
    if (client) {
      await sendProductionConfirmed(client, send);
      const videographer = client.videographer_id
        ? listVideographers(true).find((p) => p.id === client.videographer_id)
        : undefined;
      const crewToken = getOrCreateCrewToken(send.id);
      await notifyProductionApproved({
        clientName: client.name,
        videographerName: videographer?.name,
        accountManagerName: client.account_manager,
        sendDate: send.send_date,
        sendTime: send.send_time,
        detailsUrl: crewToken
          ? `${getAppUrl()}/crew/${crewToken}`
          : `${getAppUrl()}/admin/production/${send.id}`,
      });
    }
  }

  return NextResponse.json({
    approved: true,
    alreadyDone: result.alreadyDone,
    status: send.status,
    approvedAt: send.crew_approved_at,
  });
}
