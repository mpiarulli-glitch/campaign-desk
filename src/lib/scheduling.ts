import {
  BOOKING_SLOTS,
  appDateTime,
  computeCycleStatus,
  findSendForWindow,
  isBlackout,
  nextWindow,
  type CycleStatus,
  type Window,
} from "./cadence";
import { createSend } from "./calendar";
import { notifyProductionRequested } from "./notify";
import { sendProductionRequestReceived } from "./production-emails";
import { listVideographers, videographerBookedDates } from "./videographers";
import { getDb, type RevClient, type ScheduledSend } from "./db";
import { getAppUrl } from "./auth";
import { durationAllowsStart, slotHasPassed } from "./scheduling-rules";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface SchedulingStatus {
  client: { name: string };
  window: Window | null;
  status: CycleStatus;
  today: string;
  currentTime: string;
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

function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  let current = new Date(Date.UTC(sy, sm - 1, sd));
  const last = new Date(Date.UTC(ey, em - 1, ed));
  while (current <= last) {
    dates.push(current.toISOString().slice(0, 10));
    current = new Date(current.getTime() + 86_400_000);
  }
  return dates;
}

// The GET payload for a client's production-booking view, keyed off an
// already-resolved client (caller decides how the client was authenticated —
// schedule_token or dashboard_token both resolve to the same RevClient shape).
export function getSchedulingStatus(client: RevClient): SchedulingStatus {
  const now = appDateTime();
  const today = now.date;
  const window = nextWindow(client, today);
  const status = client.production_enrolled
    ? computeCycleStatus(client, window, today)
    : "inactive";
  const existing = window ? findSendForWindow(client.id, window.start) : null;

  return {
    client: { name: client.name },
    window,
    status,
    today,
    currentTime: now.time,
    slots: BOOKING_SLOTS,
    blackoutDates: (() => {
      const configured = (() => {
        try {
          return JSON.parse(client.blackout_dates || "[]") as string[];
        } catch {
          return [];
        }
      })();
      const contractBlocked = window
        ? datesBetween(window.start, window.end).filter((date) =>
            isBlackout(date, { ...client, blackout_dates: "[]" })
          )
        : [];
      try {
        return [...new Set([...configured, ...contractBlocked])];
      } catch {
        return [];
      }
    })(),
    videographerBooked: window
      ? videographerBookedDates(client.videographer_id, window.start, window.end)
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
  | { ok: true; send: ScheduledSend; client: RevClient }
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
export async function submitProductionBooking(
  client: RevClient,
  body: Record<string, unknown>
): Promise<BookingResult> {
  const now = appDateTime();
  const today = now.date;
  const window = nextWindow(client, today);
  const status = computeCycleStatus(client, window, today);
  if (
    !client.production_enrolled ||
    !window ||
    status === "inactive" ||
    status === "not_configured"
  ) {
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
  if (slotHasPassed(date, time, today, now.time)) {
    return {
      ok: false,
      httpStatus: 400,
      error: "That start time has already passed. Pick a future slot.",
    };
  }
  if (!BOOKING_SLOTS.includes(time)) {
    return {
      ok: false,
      httpStatus: 400,
      error: "Pick a start time between 9 AM and 1 PM.",
    };
  }
  if (!durationAllowsStart(duration, time)) {
    return {
      ok: false,
      httpStatus: 400,
      error: "Full-day productions start at 9 AM.",
    };
  }
  if (isBlackout(date, client)) {
    return {
      ok: false,
      httpStatus: 400,
      error: "That day isn't available. Pick another day in the window.",
    };
  }
  // Serialize the last availability check and insert. This prevents two
  // simultaneous requests from claiming the same videographer/day or cadence
  // window before either request can see the other's insert.
  const reserve = getDb().transaction((): BookingResult => {
    const currentClient = getDb()
      .prepare(`SELECT * FROM rev_clients WHERE id = ?`)
      .get(client.id) as RevClient | undefined;
    if (!currentClient?.production_enrolled) {
      return {
        ok: false,
        httpStatus: 404,
        error: "This scheduling link is no longer active.",
      };
    }
    const currentWindow = nextWindow(currentClient, today);
    const currentStatus = computeCycleStatus(
      currentClient,
      currentWindow,
      today
    );
    if (
      !currentWindow ||
      currentWindow.start !== window.start ||
      (currentStatus !== "due" && currentStatus !== "not_due")
    ) {
      return {
        ok: false,
        httpStatus: 409,
        error: "This production window has already been scheduled.",
      };
    }
    if (
      videographerBookedDates(
        currentClient.videographer_id,
        date,
        date
      ).length > 0
    ) {
      return {
        ok: false,
        httpStatus: 409,
        error: "That day was just taken. Please pick another day in the window.",
      };
    }

    const send = createSend({
      clientId: currentClient.id,
      clientName: currentClient.name,
      title: `${currentClient.name} production`,
      sendDate: date,
      sendTime: time,
      duration,
      status: "requested",
      note,
      productionBrief: JSON.stringify(brief),
      cadenceWindowStart: currentWindow.start,
      requestedByClient: true,
    });
    return { ok: true, send, client: currentClient };
  });

  const result = reserve.immediate();
  if (!result.ok) return result;
  const videographer = result.client.videographer_id
    ? listVideographers(true).find(
        (person) => person.id === result.client.videographer_id
      )
    : undefined;

  await notifyProductionRequested({
    clientName: result.client.name,
    videographerName: videographer?.name,
    sendDate: date,
    sendTime: time,
    duration,
    detailsUrl: `${getAppUrl()}/admin/production/${result.send.id}`,
    note,
  });
  await sendProductionRequestReceived(result.client, result.send);

  return result;
}
