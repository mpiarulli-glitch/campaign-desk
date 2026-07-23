import {
  BOOKING_SLOTS,
  computeCycleStatus,
  findSendForWindow,
  isBlackout,
  nextWindow,
  todayYmd,
  type CycleStatus,
  type Window,
} from "./cadence";
import { createSend } from "./calendar";
import { notifyProductionRequested } from "./notify";
import { sendProductionRequestReceived } from "./production-emails";
import { videographerBookedDates } from "./videographers";
import type { RevClient, ScheduledSend } from "./db";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface SchedulingStatus {
  client: { name: string };
  window: Window | null;
  status: CycleStatus;
  slots: string[];
  blackoutDates: string[];
  videographerBooked: string[];
  existingSend: {
    sendDate: string;
    sendTime: string;
    status: string;
    note: string;
  } | null;
}

// The GET payload for a client's production-booking view, keyed off an
// already-resolved client (caller decides how the client was authenticated —
// schedule_token or dashboard_token both resolve to the same RevClient shape).
export function getSchedulingStatus(client: RevClient): SchedulingStatus {
  const today = todayYmd();
  const window = nextWindow(client, today);
  const status = computeCycleStatus(client, window, today);
  const existing = window ? findSendForWindow(client.id, window.start) : null;

  return {
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
  };
}

export type BookingResult =
  | { ok: true; send: ScheduledSend }
  | { ok: false; httpStatus: number; error: string };

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
  "offersPromotions",
  "avoidRequests",
  "additionalNotes",
] as const;

// Books a production slot for an already-resolved client. Same validation
// (window/blackout/videographer-conflict/required brief fields) regardless
// of which token authenticated the request.
export function submitProductionBooking(
  client: RevClient,
  body: Record<string, unknown>
): BookingResult {
  const today = todayYmd();
  const window = nextWindow(client, today);
  const status = computeCycleStatus(client, window, today);
  if (!window || status === "inactive" || status === "not_configured") {
    return {
      ok: false,
      httpStatus: 400,
      error: "Scheduling isn't open for this account right now.",
    };
  }
  if (status !== "due" && status !== "not_due") {
    return {
      ok: false,
      httpStatus: 409,
      error: "This production window has already been scheduled.",
    };
  }

  const date = typeof body.date === "string" ? body.date : "";
  const time = typeof body.time === "string" ? body.time : "";
  const duration = body.duration === "full" ? "full" : "half";
  const note = typeof body.note === "string" ? body.note.trim() : "";

  const rawBrief =
    body.brief && typeof body.brief === "object"
      ? (body.brief as Record<string, unknown>)
      : {};
  const brief: Record<string, string> = {};
  for (const key of BRIEF_FIELDS) {
    const v = rawBrief[key];
    if (typeof v === "string" && v.trim()) brief[key] = v.trim();
  }
  if (!brief.locations) {
    return {
      ok: false,
      httpStatus: 400,
      error: "Add the production location so the crew knows where to go.",
    };
  }
  if (!brief.onsiteContactName || !brief.onsiteContactPhone) {
    return {
      ok: false,
      httpStatus: 400,
      error: "Add an on-site contact name and phone number.",
    };
  }

  if (!DATE_RE.test(date)) {
    return { ok: false, httpStatus: 400, error: "date must be YYYY-MM-DD" };
  }
  if (date < window.start || date > window.end) {
    return {
      ok: false,
      httpStatus: 400,
      error: "Pick a day inside your production window.",
    };
  }
  if (!BOOKING_SLOTS.includes(time)) {
    return { ok: false, httpStatus: 400, error: "Pick a time between 9 AM and 5 PM." };
  }
  if (isBlackout(date, client)) {
    return {
      ok: false,
      httpStatus: 400,
      error: "That day isn't available. Pick another day in the window.",
    };
  }
  if (videographerBookedDates(client.videographer_id, date, date, client.id).length > 0) {
    return {
      ok: false,
      httpStatus: 409,
      error: "That day was just taken. Please pick another day in the window.",
    };
  }

  const send = createSend({
    clientId: client.id,
    clientName: client.name,
    title: `${client.name} production`,
    sendDate: date,
    sendTime: time,
    duration,
    status: "requested",
    note,
    productionBrief: JSON.stringify(brief),
    cadenceWindowStart: window.start,
    requestedByClient: true,
  });

  notifyProductionRequested({ clientName: client.name, sendDate: date, note });
  void sendProductionRequestReceived(client, send);

  return { ok: true, send };
}
