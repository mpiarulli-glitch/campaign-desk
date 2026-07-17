import { NextResponse } from "next/server";
import {
  BOOKING_SLOTS,
  computeCycleStatus,
  findSendForWindow,
  isBlackout,
  nextWindow,
  todayYmd,
  getClientByScheduleToken,
} from "@/lib/cadence";
import { createSend } from "@/lib/calendar";
import { notifyProductionRequested } from "@/lib/notify";
import { videographerBookedDates } from "@/lib/videographers";

type Params = { params: Promise<{ token: string }> };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(_request: Request, { params }: Params) {
  const { token } = await params;
  const client = getClientByScheduleToken(token);
  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const today = todayYmd();
  const window = nextWindow(client, today);
  const status = computeCycleStatus(client, window, today);
  const existing = window ? findSendForWindow(client.id, window.start) : null;

  return NextResponse.json({
    client: { name: client.name },
    window,
    status,
    slots: BOOKING_SLOTS,
    blackoutDates: (() => {
      try {
        return JSON.parse(client.blackout_dates || "[]") as string[];
      } catch {
        return [];
      }
    })(),
    // Days their videographer is already booked (unavailable to this client).
    videographerBooked: window
      ? videographerBookedDates(client.videographer_id, window.start, window.end, client.id)
      : [],
    existingSend: existing
      ? {
          sendDate: existing.send_date,
          sendTime: existing.send_time,
          status: existing.status,
          note: existing.note,
        }
      : null,
  });
}

export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  const client = getClientByScheduleToken(token);
  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const today = todayYmd();
  const window = nextWindow(client, today);
  const status = computeCycleStatus(client, window, today);
  if (!window || status === "inactive" || status === "not_configured") {
    return NextResponse.json(
      { error: "Scheduling isn't open for this account right now." },
      { status: 400 }
    );
  }
  if (status !== "due" && status !== "not_due") {
    return NextResponse.json(
      { error: "This production window has already been scheduled." },
      { status: 409 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const date = typeof body.date === "string" ? body.date : "";
  const time = typeof body.time === "string" ? body.time : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";

  // Known production-brief fields. Anything else on body.brief is ignored.
  const BRIEF_FIELDS = [
    "locations",
    "onsiteContactName",
    "onsiteContactPhone",
    "locationState",
    "powerAccess",
    "timeRestrictions",
    "parking",
    "onCameraPeople",
    "participantsConsent",
    "mediaRelease",
    "propertyApproval",
    "safetyCompliance",
    "captureRequests",
    "avoidRequests",
    "additionalNotes",
  ] as const;
  const rawBrief =
    body.brief && typeof body.brief === "object" ? body.brief : {};
  const brief: Record<string, string> = {};
  for (const key of BRIEF_FIELDS) {
    const v = rawBrief[key];
    if (typeof v === "string" && v.trim()) brief[key] = v.trim();
  }
  // Section 01 essentials are the only required fields.
  if (!brief.locations) {
    return NextResponse.json(
      { error: "Add the production location so the crew knows where to go." },
      { status: 400 }
    );
  }
  if (!brief.onsiteContactName || !brief.onsiteContactPhone) {
    return NextResponse.json(
      { error: "Add an on-site contact name and phone number." },
      { status: 400 }
    );
  }

  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  if (date < window.start || date > window.end) {
    return NextResponse.json(
      { error: "Pick a day inside your production window." },
      { status: 400 }
    );
  }
  if (!BOOKING_SLOTS.includes(time)) {
    return NextResponse.json(
      { error: "Pick a time between 9 AM and 5 PM." },
      { status: 400 }
    );
  }
  if (isBlackout(date, client)) {
    return NextResponse.json(
      { error: "That day isn't available. Pick another day in the window." },
      { status: 400 }
    );
  }
  // Videographer already booked that day for another client.
  if (
    videographerBookedDates(client.videographer_id, date, date, client.id).length > 0
  ) {
    return NextResponse.json(
      { error: "That day was just taken. Please pick another day in the window." },
      { status: 409 }
    );
  }

  const send = createSend({
    clientId: client.id,
    clientName: client.name,
    title: `${client.name} production`,
    sendDate: date,
    sendTime: time,
    status: "requested",
    note,
    productionBrief: JSON.stringify(brief),
    cadenceWindowStart: window.start,
    requestedByClient: true,
  });

  notifyProductionRequested({ clientName: client.name, sendDate: date, note });

  return NextResponse.json({ send }, { status: 201 });
}
