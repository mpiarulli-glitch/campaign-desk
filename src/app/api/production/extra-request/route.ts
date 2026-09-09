import { NextResponse } from "next/server";
import { getSession, isAdminAuthenticated, scheduleUrl } from "@/lib/auth";
import { getOrCreateScheduleToken } from "@/lib/cadence";
import { getRevClient } from "@/lib/revenue";
import {
  createExtraRequest,
  listExtraRequestsForClient,
  sendExtraRequestOutreach,
} from "@/lib/extra-requests";
import { isRealDate } from "@/lib/scheduling-rules";
import { teamLabel } from "@/lib/team";

// One client's history of ad hoc scheduling invitations (open, fulfilled, and
// cancelled), for the admin production view.
export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const clientId = new URL(request.url).searchParams.get("clientId") || "";
  if (!clientId) {
    return NextResponse.json({ error: "Pick a client." }, { status: 400 });
  }
  return NextResponse.json({ requests: listExtraRequestsForClient(clientId) });
}

// Defines a hand-picked window for a client. By default reaches out (Basecamp
// card + email); pass sendOutreach: false to only open the window and return
// the scheduling link for the operator to send themselves.
export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  const windowStart = typeof body.windowStart === "string" ? body.windowStart : "";
  const windowEnd = typeof body.windowEnd === "string" ? body.windowEnd : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const sendOutreach = body.sendOutreach !== false;

  if (!clientId) {
    return NextResponse.json({ error: "Pick a client." }, { status: 400 });
  }
  if (!isRealDate(windowStart) || !isRealDate(windowEnd)) {
    return NextResponse.json(
      { error: "Pick a real start and end date." },
      { status: 400 }
    );
  }
  if (windowEnd < windowStart) {
    return NextResponse.json(
      { error: "The window's end date is before its start date." },
      { status: 400 }
    );
  }
  if (note.length > 2000) {
    return NextResponse.json(
      { error: "Keep the note under 2000 characters." },
      { status: 400 }
    );
  }

  const client = getRevClient(clientId);
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const session = await getSession();
  const createdBy = session?.person ? teamLabel(session.person) : "Team";
  try {
    const extraRequest = createExtraRequest({
      clientId,
      windowStart,
      windowEnd,
      note,
      createdBy,
    });
    const token = getOrCreateScheduleToken(client.id);
    const scheduleLink = token ? scheduleUrl(token) : "";
    const outreach = sendOutreach
      ? await sendExtraRequestOutreach(extraRequest, client)
      : {
          basecamp: { ok: false, skipped: true as const },
          email: { ok: false, skipped: true as const },
        };

    return NextResponse.json(
      { request: extraRequest, outreach, scheduleUrl: scheduleLink },
      { status: 201 }
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : "";
    return NextResponse.json(
      {
        error: detail
          ? `Could not open the scheduling window. ${detail}`
          : "Could not open the scheduling window.",
      },
      { status: 500 }
    );
  }
}
