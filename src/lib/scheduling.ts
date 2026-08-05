import {
  BOOKING_SLOTS,
  advanceLastProduction,
  appDateTime,
  computeCycleStatus,
  findSendForWindow,
  isBlackout,
  nextWindow,
  productionWindowForDate,
  type CycleStatus,
  type Window,
} from "./cadence";
import { createSend, getOrCreateCrewToken } from "./calendar";
import { notifyProductionRequested } from "./notify";
import { sendProductionRequestReceived } from "./production-emails";
import { listVideographers, videographerBookedDates } from "./videographers";
import { getDb, type RevClient, type ScheduledSend } from "./db";
import { getAppUrl } from "./auth";
import { durationAllowsStart, isRealDate, slotHasPassed } from "./scheduling-rules";
import {
  fulfillMatchingExtraRequest,
  listOpenExtraRequests as listOpenExtraWindows,
} from "./extra-requests";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The link put in front of the crew. Points at the no-login view, because the
// people who need an address on the day are videographers and account managers
// who should not have to sign in to read one. Falls back to the admin page if a
// token cannot be minted.
function crewUrl(sendId: string): string {
  const token = getOrCreateCrewToken(sendId);
  return token
    ? `${getAppUrl()}/crew/${token}`
    : `${getAppUrl()}/admin/production/${sendId}`;
}

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
  // Productions requested outside the normal cadence (cadence_window_start is
  // null), open ones first. Shown so a client doesn't lose track of an extra
  // request they already sent in, or fire off a second one by accident.
  extraRequests: {
    sendDate: string;
    sendTime: string;
    status: string;
  }[];
  // An admin-picked window inviting an extra production, if one is open. When
  // present, the client's out-of-cycle date picker is bounded to it.
  extraWindow: { start: string; end: string; note: string } | null;
}

// A client's own not-cancelled, not-yet-sent out-of-cycle bookings. Ordered
// newest first so a repeat request always reads as "still pending" rather
// than getting buried under an older one.
function listOpenExtraBookings(clientId: string): {
  sendDate: string;
  sendTime: string;
  status: string;
}[] {
  return (
    getDb()
      .prepare(
        `SELECT send_date, send_time, status FROM scheduled_sends
         WHERE client_id = ? AND requested_by_client = 1
           AND cadence_window_start IS NULL
           AND cancelled_at IS NULL AND status != 'sent'
         ORDER BY created_at DESC`
      )
      .all(clientId) as Array<{ send_date: string; send_time: string; status: string }>
  ).map((r) => ({ sendDate: r.send_date, sendTime: r.send_time, status: r.status }));
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
    extraRequests: listOpenExtraBookings(client.id),
    extraWindow: (() => {
      const open = listOpenExtraWindows(client.id)[0];
      return open
        ? { start: open.window_start, end: open.window_end, note: open.note }
        : null;
    })(),
  };
}

export type BookingResult =
  | { ok: true; send: ScheduledSend; client: RevClient }
  | { ok: false; httpStatus: number; error: string };

// Longest accepted value for a brief field or a crew note. Generous for anything
// real: the longest field in use is an address plus access instructions. It
// exists because the booking endpoint needs no login, so the input is unbounded
// otherwise, and a 200KB address would be stored, mailed and rendered on the crew
// page without complaint.
export const MAX_FIELD_LENGTH = 2000;

// The production brief's fields, in one place. The client booking form, the
// admin log form and the admin edit form all validate against this list, so a
// field added here reaches every one of them.
export const BRIEF_FIELDS = [
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
  const tooLong = Object.entries(brief).find(
    ([, value]) => value.length > MAX_FIELD_LENGTH
  );
  if (tooLong || note.length > MAX_FIELD_LENGTH) {
    return {
      ok: false,
      httpStatus: 400,
      error: `Keep each answer under ${MAX_FIELD_LENGTH} characters.`,
    };
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

  if (!isRealDate(date)) {
    return { ok: false, httpStatus: 400, error: "That is not a real date." };
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
    accountManagerName: result.client.account_manager,
    sendDate: date,
    sendTime: time,
    duration,
    detailsUrl: crewUrl(result.send.id),
    note,
  });
  await sendProductionRequestReceived(result.client, result.send);

  return result;
}

// A client asking for a shoot outside their regular cadence — usually because
// they've fallen behind and don't want to wait for their next window. Same
// validation as a normal booking minus anything window-shaped: no window to
// stay inside, so any real upcoming date works. Written with
// cadence_window_start left null, which is what keeps it from ever advancing
// or fulfilling the client's regular cycle (see advanceLastProduction's
// callers, which all gate on that column being set).
export async function submitOutOfCycleBooking(
  client: RevClient,
  body: Record<string, unknown>
): Promise<BookingResult> {
  if (!client.production_enrolled) {
    return {
      ok: false,
      httpStatus: 400,
      error: "Scheduling isn't open for this account right now.",
    };
  }
  const now = appDateTime();
  const today = now.date;

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
  const tooLong = Object.entries(brief).find(
    ([, value]) => value.length > MAX_FIELD_LENGTH
  );
  if (tooLong || note.length > MAX_FIELD_LENGTH) {
    return {
      ok: false,
      httpStatus: 400,
      error: `Keep each answer under ${MAX_FIELD_LENGTH} characters.`,
    };
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

  if (!isRealDate(date) || date < today) {
    return { ok: false, httpStatus: 400, error: "Pick a real, upcoming date." };
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
      error: "That day isn't available. Pick another day.",
    };
  }
  // An open window an admin invited them into bounds the date. Without one,
  // any real upcoming date is fair game.
  const openWindow = listOpenExtraWindows(client.id)[0];
  if (openWindow && (date < openWindow.window_start || date > openWindow.window_end)) {
    return {
      ok: false,
      httpStatus: 400,
      error: "Pick a day inside the window you were invited to.",
    };
  }

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
    if (
      videographerBookedDates(currentClient.videographer_id, date, date)
        .length > 0
    ) {
      return {
        ok: false,
        httpStatus: 409,
        error: "That day was just taken. Please pick another day.",
      };
    }

    const send = createSend({
      clientId: currentClient.id,
      clientName: currentClient.name,
      title: `${currentClient.name} out-of-cycle production`,
      sendDate: date,
      sendTime: time,
      duration,
      status: "requested",
      note,
      productionBrief: JSON.stringify(brief),
      cadenceWindowStart: null,
      requestedByClient: true,
    });
    return { ok: true, send, client: currentClient };
  });

  const result = reserve.immediate();
  if (!result.ok) return result;
  fulfillMatchingExtraRequest(result.client.id, date, result.send.id);
  const videographer = result.client.videographer_id
    ? listVideographers(true).find(
        (person) => person.id === result.client.videographer_id
      )
    : undefined;

  await notifyProductionRequested({
    clientName: result.client.name,
    videographerName: videographer?.name,
    accountManagerName: result.client.account_manager,
    sendDate: date,
    sendTime: time,
    duration,
    detailsUrl: crewUrl(result.send.id),
    note: note ? `Out-of-cycle request. ${note}` : "Out-of-cycle request.",
  });
  await sendProductionRequestReceived(result.client, result.send);

  return result;
}

const MANUAL_STATUSES = ["requested", "scheduled", "sent"] as const;
export type ManualProductionStatus = (typeof MANUAL_STATUSES)[number];

// Logs a production that was arranged outside the app — over the phone, by an
// account manager, or in another booking system. Deliberately more permissive
// than submitProductionBooking: past dates are allowed so historical
// productions can be backfilled, the brief is optional because the
// conversation already happened, and the client email is opt-in rather than
// automatic.
//
// What it does NOT relax is the cadence link. The row is written with the same
// requested_by_client flag and cadence_window_start a client booking would get,
// so it shows up in the production queue, stops the scheduling reminders for
// that window, and advances the client's cadence anchor once it's marked
// complete. Anything less and the record looks right while the cadence keeps
// treating the window as unbooked.
export async function recordManualProduction(
  client: RevClient,
  body: Record<string, unknown>
): Promise<BookingResult> {
  if (!client.color_week || !client.production_cadence) {
    return {
      ok: false,
      httpStatus: 400,
      error:
        "Set this client's color week and cadence before logging a production.",
    };
  }

  const date = typeof body.date === "string" ? body.date : "";
  if (!isRealDate(date)) {
    return { ok: false, httpStatus: 400, error: "That is not a real date." };
  }

  const time = typeof body.time === "string" ? body.time : "";
  if (time && !BOOKING_SLOTS.includes(time)) {
    return {
      ok: false,
      httpStatus: 400,
      error: "Pick a start time between 9 AM and 1 PM.",
    };
  }

  const duration = body.duration === "full" ? "full" : "half";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const status: ManualProductionStatus = MANUAL_STATUSES.includes(
    body.status as ManualProductionStatus
  )
    ? (body.status as ManualProductionStatus)
    : "scheduled";

  // Which cadence window this production settles. Derived from the date so it
  // lands on the client's real beat; an explicit override covers productions
  // that happened off-window.
  const override =
    typeof body.cadenceWindowStart === "string" && body.cadenceWindowStart
      ? body.cadenceWindowStart
      : "";
  if (override && !DATE_RE.test(override)) {
    return {
      ok: false,
      httpStatus: 400,
      error: "cadenceWindowStart must be YYYY-MM-DD",
    };
  }
  const derived = productionWindowForDate(client.color_week, date);
  const windowStart = override || derived?.start || "";
  if (!windowStart) {
    return {
      ok: false,
      httpStatus: 400,
      error:
        `${date} isn't inside a ${client.color_week} production week. ` +
        "Pick a date in one of their windows, or choose the window this production counts toward.",
    };
  }

  const rawBrief =
    body.brief && typeof body.brief === "object"
      ? (body.brief as Record<string, unknown>)
      : {};
  const brief: Record<string, string> = {};
  for (const key of BRIEF_FIELDS) {
    const v = rawBrief[key];
    if (typeof v === "string" && v.trim()) brief[key] = v.trim();
  }
  if (
    Object.values(brief).some((value) => value.length > MAX_FIELD_LENGTH) ||
    note.length > MAX_FIELD_LENGTH
  ) {
    return {
      ok: false,
      httpStatus: 400,
      error: `Keep each answer under ${MAX_FIELD_LENGTH} characters.`,
    };
  }

  // Serialize the duplicate check with the insert so two people logging the
  // same production can't both land a row for one window.
  const reserve = getDb().transaction((): BookingResult => {
    const currentClient = getDb()
      .prepare(`SELECT * FROM rev_clients WHERE id = ?`)
      .get(client.id) as RevClient | undefined;
    if (!currentClient) {
      return { ok: false, httpStatus: 404, error: "Client not found." };
    }
    if (findSendForWindow(currentClient.id, windowStart)) {
      return {
        ok: false,
        httpStatus: 409,
        error:
          "This production window already has a booking. Open it from the queue to edit instead.",
      };
    }
    const send = createSend({
      clientId: currentClient.id,
      clientName: currentClient.name,
      title: `${currentClient.name} production`,
      sendDate: date,
      sendTime: time,
      duration,
      status,
      note,
      productionBrief: JSON.stringify(brief),
      cadenceWindowStart: windowStart,
      requestedByClient: true,
    });
    return { ok: true, send, client: currentClient };
  });

  const result = reserve.immediate();
  if (!result.ok) return result;

  // Moving the anchor reshapes every future window for this client, so it's the
  // caller's explicit choice rather than a side effect. Defaulted on by the UI
  // when logging a completed production, since that's the case where the
  // cadence genuinely should step forward.
  if (body.advanceAnchor === true && status === "sent") {
    advanceLastProduction(result.client.id, date);
  }

  if (body.notifyTeam === true) {
    const videographer = result.client.videographer_id
      ? listVideographers(true).find(
          (person) => person.id === result.client.videographer_id
        )
      : undefined;
    await notifyProductionRequested({
      clientName: result.client.name,
      videographerName: videographer?.name,
    accountManagerName: result.client.account_manager,
      sendDate: date,
      sendTime: time,
      duration,
      detailsUrl: crewUrl(result.send.id),
      note,
    });
  }
  if (body.notifyClient === true) {
    await sendProductionRequestReceived(result.client, result.send);
  }

  return result;
}

// The admin-side counterpart to submitOutOfCycleBooking: the team books an
// extra shoot directly, on behalf of a client who's fallen behind, without
// touching that client's regular cadence. Deliberately does not accept
// advanceAnchor at all — an out-of-cycle production must never move the
// cadence anchor, unlike recordManualProduction where that's the caller's
// choice. Doesn't require color_week/production_cadence to be set either,
// since there's no window to derive.
export async function recordOutOfCycleProduction(
  client: RevClient,
  body: Record<string, unknown>
): Promise<BookingResult> {
  const date = typeof body.date === "string" ? body.date : "";
  if (!isRealDate(date)) {
    return { ok: false, httpStatus: 400, error: "That is not a real date." };
  }

  const time = typeof body.time === "string" ? body.time : "";
  if (time && !BOOKING_SLOTS.includes(time)) {
    return {
      ok: false,
      httpStatus: 400,
      error: "Pick a start time between 9 AM and 1 PM.",
    };
  }

  const duration = body.duration === "full" ? "full" : "half";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const status: ManualProductionStatus = MANUAL_STATUSES.includes(
    body.status as ManualProductionStatus
  )
    ? (body.status as ManualProductionStatus)
    : "scheduled";

  const rawBrief =
    body.brief && typeof body.brief === "object"
      ? (body.brief as Record<string, unknown>)
      : {};
  const brief: Record<string, string> = {};
  for (const key of BRIEF_FIELDS) {
    const v = rawBrief[key];
    if (typeof v === "string" && v.trim()) brief[key] = v.trim();
  }
  if (
    Object.values(brief).some((value) => value.length > MAX_FIELD_LENGTH) ||
    note.length > MAX_FIELD_LENGTH
  ) {
    return {
      ok: false,
      httpStatus: 400,
      error: `Keep each answer under ${MAX_FIELD_LENGTH} characters.`,
    };
  }

  const reserve = getDb().transaction((): BookingResult => {
    const currentClient = getDb()
      .prepare(`SELECT * FROM rev_clients WHERE id = ?`)
      .get(client.id) as RevClient | undefined;
    if (!currentClient) {
      return { ok: false, httpStatus: 404, error: "Client not found." };
    }
    const send = createSend({
      clientId: currentClient.id,
      clientName: currentClient.name,
      title: `${currentClient.name} out-of-cycle production`,
      sendDate: date,
      sendTime: time,
      duration,
      status,
      note,
      productionBrief: JSON.stringify(brief),
      cadenceWindowStart: null,
      requestedByClient: true,
    });
    return { ok: true, send, client: currentClient };
  });

  const result = reserve.immediate();
  if (!result.ok) return result;
  fulfillMatchingExtraRequest(result.client.id, date, result.send.id);

  if (body.notifyTeam === true) {
    const videographer = result.client.videographer_id
      ? listVideographers(true).find(
          (person) => person.id === result.client.videographer_id
        )
      : undefined;
    await notifyProductionRequested({
      clientName: result.client.name,
      videographerName: videographer?.name,
      accountManagerName: result.client.account_manager,
      sendDate: date,
      sendTime: time,
      duration,
      detailsUrl: crewUrl(result.send.id),
      note: note ? `Out-of-cycle request. ${note}` : "Out-of-cycle request.",
    });
  }
  if (body.notifyClient === true) {
    await sendProductionRequestReceived(result.client, result.send);
  }

  return result;
}
