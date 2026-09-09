import { NextResponse } from "next/server";
import { getSession, isAdminAuthenticated, scheduleUrl } from "@/lib/auth";
import { teamLabel } from "@/lib/team";
import { COLORS, CADENCE_LABEL, getOrCreateScheduleToken, todayYmd } from "@/lib/cadence";
import { isRealDate } from "@/lib/scheduling-rules";
import { getRevClient, updateRevClient } from "@/lib/revenue";
import {
  createExtraRequest,
  listOpenExtraRequests,
  sendExtraRequestOutreach,
} from "@/lib/extra-requests";
import { recordReachout } from "@/lib/reachouts";
import type { ColorWeek, ProductionCadence } from "@/lib/db";

const COLOR_SET = new Set<string>(COLORS);
const CADENCE_SET = new Set(Object.keys(CADENCE_LABEL));

// Enrolls a client onto the production schedule (if they weren't already),
// sets color week + cadence, and opens a first-production window. By default
// sends Basecamp + email; pass sendOutreach: false to only open the window
// and return the scheduling link for the operator to send themselves.
export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  const windowStart = typeof body.windowStart === "string" ? body.windowStart : "";
  const windowEnd = typeof body.windowEnd === "string" ? body.windowEnd : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const colorWeek = typeof body.colorWeek === "string" ? body.colorWeek : "";
  const productionCadence =
    typeof body.productionCadence === "string" ? body.productionCadence : "";
  const videographerId =
    typeof body.videographerId === "string" ? body.videographerId : undefined;
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

  const existing = getRevClient(clientId);
  if (!existing) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }
  if (existing.last_production_date) {
    return NextResponse.json(
      {
        error:
          "This client already has a production on record. Use Ask to schedule for an extra one.",
      },
      { status: 409 }
    );
  }
  if (listOpenExtraRequests(existing.id).length > 0) {
    return NextResponse.json(
      {
        error:
          "This client already has an open scheduling ask. Cancel or finish that one first.",
      },
      { status: 409 }
    );
  }

  const nextColor = (colorWeek || existing.color_week) as ColorWeek;
  const nextCadence = (productionCadence ||
    existing.production_cadence) as ProductionCadence;
  if (!COLOR_SET.has(nextColor) || !CADENCE_SET.has(nextCadence)) {
    return NextResponse.json(
      {
        error:
          "Set a color week and cadence so their next productions stay on the schedule after this first one.",
      },
      { status: 400 }
    );
  }

  const client = updateRevClient(existing.id, {
    productionEnrolled: true,
    colorWeek: nextColor,
    productionCadence: nextCadence,
    ...(videographerId !== undefined ? { videographerId } : {}),
  });
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }

  const session = await getSession();
  const createdBy = session?.person ? teamLabel(session.person) : "Team";
  const extraRequest = createExtraRequest({
    clientId: client.id,
    windowStart,
    windowEnd,
    note,
    createdBy,
    kind: "first",
  });
  const token = getOrCreateScheduleToken(client.id);
  const scheduleLink = token ? scheduleUrl(token) : "";
  const outreach = sendOutreach
    ? await sendExtraRequestOutreach(extraRequest, client)
    : {
        basecamp: { ok: false, skipped: true as const },
        email: { ok: false, skipped: true as const },
      };
  const today = todayYmd();
  if (outreach.email.ok) {
    recordReachout({
      clientId: client.id,
      clientName: client.name,
      channel: "email",
      windowStart: extraRequest.window_start,
      ymd: today,
      detail: "First production invitation",
    });
  }
  if (outreach.basecamp.ok) {
    recordReachout({
      clientId: client.id,
      clientName: client.name,
      channel: "basecamp_card",
      windowStart: extraRequest.window_start,
      ymd: today,
      detail: "First production invitation",
    });
  }

  return NextResponse.json(
    { request: extraRequest, outreach, client, scheduleUrl: scheduleLink },
    { status: 201 }
  );
}
