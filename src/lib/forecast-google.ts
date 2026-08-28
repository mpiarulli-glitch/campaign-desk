// Two-way Google Calendar sync for Forecast meetings.
//
// Pull: that person's primary-calendar events that look like client meetings
// become Forecast rows (or update the overlay we already created). Push: a
// typed Forecast meeting is created/updated on their Google calendar — never a
// work block, never an event that originated on Google, never a second event
// if they already have a Meet at that slot.

import { APP_TIME_ZONE } from "./cadence";
import {
  createTask,
  deleteTask,
  findUnlinkedMeetingAtSlot,
  getTask,
  getTaskByGoogleEventId,
  linkTaskGoogle,
  listGoogleOverlayTasks,
  updateTask,
  type ForecastTask,
} from "./forecast";

/** Off until FORECAST_GOOGLE_CALENDAR=1 is set on the server. */
export function forecastGoogleEnabled(): boolean {
  return process.env.FORECAST_GOOGLE_CALENDAR === "1";
}
import { isoToStartTime, isoToYmd, parseTimeInput, scheduleEntryTimes } from "./forecast-time";
import { addWeeks } from "./week";
import {
  createPrimaryEvent,
  deletePrimaryEvent,
  listPrimaryEvents,
  updatePrimaryEvent,
  type GoogleCalendarEvent,
} from "./google-calendar";
import {
  getGoogleConnection,
  googleConfigured,
  hasGoogleConnection,
  markGooglePulled,
} from "./google-identity";
import { listRevClients } from "./revenue";

const PULL_MIN_INTERVAL_MS = 45_000;
const SLOT_MATCH_MS = 2 * 60 * 1000;
const NOISE_EVENT_TYPES = new Set(["outOfOffice", "focusTime", "workingLocation"]);

export type MappedGoogleMeeting = {
  googleEventId: string;
  taskDate: string;
  startTime: string;
  hours: number;
  notes: string;
  client: string;
};

export function googleEventIsAllDay(event: GoogleCalendarEvent): boolean {
  return Boolean(event.start?.date && !event.start?.dateTime);
}

export function googleEventHours(event: GoogleCalendarEvent): number {
  const start = event.start?.dateTime ? Date.parse(event.start.dateTime) : NaN;
  const end = event.end?.dateTime ? Date.parse(event.end.dateTime) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round(((end - start) / 3_600_000) * 4) / 4;
}

export function selfResponseStatus(
  event: GoogleCalendarEvent,
  selfEmail: string
): string {
  const attendees = event.attendees || [];
  const self = attendees.find((a) => a.self) ||
    attendees.find(
      (a) =>
        selfEmail &&
        (a.email || "").toLowerCase() === selfEmail.toLowerCase()
    );
  return (self?.responseStatus || "").toLowerCase();
}

export function googleEventHasOtherAttendees(
  event: GoogleCalendarEvent,
  selfEmail: string
): boolean {
  const attendees = event.attendees || [];
  const self = selfEmail.trim().toLowerCase();
  return attendees.some((a) => {
    if (a.self || a.resource) return false;
    if (self && (a.email || "").toLowerCase() === self) return false;
    return true;
  });
}

export function matchingClientName(text: string, clientNames: string[]): string {
  const hay = (text || "").toLowerCase();
  if (!hay) return "";
  let best = "";
  for (const name of clientNames) {
    const n = (name || "").trim();
    if (n.length < 3) continue;
    if (hay.includes(n.toLowerCase()) && n.length > best.length) best = n;
  }
  return best;
}

/**
 * Whether this Google event should appear on Forecast.
 *
 * Default: timed events with someone besides the owner, that they have not
 * declined. All-day OOO / focus time stay hidden. A title that names a known
 * client is enough even with no attendees. Missing a client call is worse
 * than showing a personal appointment that happened to have another person.
 */
export function shouldImportGoogleEvent(
  event: GoogleCalendarEvent,
  opts: { selfEmail: string; clientNames: string[] }
): boolean {
  if (!event.id) return false;
  if ((event.status || "").toLowerCase() === "cancelled") return false;
  if (NOISE_EVENT_TYPES.has(event.eventType || "")) return false;
  if (googleEventIsAllDay(event)) return false;
  if (!event.start?.dateTime) return false;
  if (selfResponseStatus(event, opts.selfEmail) === "declined") return false;
  const text = `${event.summary || ""} ${event.description || ""}`;
  if (matchingClientName(text, opts.clientNames)) return true;
  return googleEventHasOtherAttendees(event, opts.selfEmail);
}

export function mapGoogleEventToMeeting(
  event: GoogleCalendarEvent,
  opts: { selfEmail: string; clientNames: string[]; timeZone?: string }
): MappedGoogleMeeting | null {
  if (!shouldImportGoogleEvent(event, opts)) return null;
  const timeZone = opts.timeZone || APP_TIME_ZONE;
  const startIso = event.start?.dateTime || "";
  const taskDate = isoToYmd(startIso, timeZone);
  const startTime = isoToStartTime(startIso, timeZone);
  const hours = googleEventHours(event);
  if (!taskDate || !startTime || hours <= 0) return null;
  const notes = (event.summary || "").trim() || "Meeting";
  const client = matchingClientName(
    `${event.summary || ""} ${event.description || ""}`,
    opts.clientNames
  );
  return {
    googleEventId: event.id!,
    taskDate,
    startTime,
    hours,
    notes,
    client,
  };
}

export function shouldPushToGoogle(task: {
  kind?: string;
  basecamp_event_id?: string;
  from_google?: number;
  start_time?: string;
}): { ok: true } | { ok: false; reason: string } {
  if (task.from_google) return { ok: false, reason: "from-google" };
  const meeting =
    task.kind === "meeting" || Boolean(task.basecamp_event_id);
  if (!meeting) return { ok: false, reason: "not-a-meeting" };
  if (!parseTimeInput(task.start_time || "")) {
    return { ok: false, reason: "blank-start" };
  }
  return { ok: true };
}

export function googleEventsAtSlot(
  events: GoogleCalendarEvent[],
  startsAtIso: string
): GoogleCalendarEvent[] {
  const want = Date.parse(startsAtIso);
  if (!Number.isFinite(want)) return [];
  return events.filter((e) => {
    if ((e.status || "").toLowerCase() === "cancelled") return false;
    if (!e.start?.dateTime) return false;
    const got = Date.parse(e.start.dateTime);
    return Number.isFinite(got) && Math.abs(got - want) < SLOT_MATCH_MS;
  });
}

function meetingTitle(task: ForecastTask): string {
  return (task.notes || task.client || "Meeting").trim() || "Meeting";
}

function eventBodyForTask(task: ForecastTask): {
  summary: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
} | null {
  const startTime = parseTimeInput(task.start_time);
  if (!startTime) return null;
  const times = scheduleEntryTimes({
    date: task.task_date,
    startTime,
    hours: task.hours,
    timeZone: APP_TIME_ZONE,
  });
  if (times.allDay) return null;
  return {
    summary: meetingTitle(task),
    start: { dateTime: times.startsAt, timeZone: APP_TIME_ZONE },
    end: { dateTime: times.endsAt, timeZone: APP_TIME_ZONE },
  };
}

function rangeIso(fromYmd: string, toYmdExclusive: string): {
  timeMin: string;
  timeMax: string;
} {
  const start = scheduleEntryTimes({
    date: fromYmd,
    startTime: "00:00",
    hours: 0.25,
    timeZone: APP_TIME_ZONE,
  });
  const end = scheduleEntryTimes({
    date: toYmdExclusive,
    startTime: "00:00",
    hours: 0.25,
    timeZone: APP_TIME_ZONE,
  });
  return { timeMin: start.startsAt, timeMax: end.startsAt };
}

export type PullGoogleResult = {
  ok: boolean;
  skipped?: string;
  error?: string;
  created: number;
  updated: number;
  linked: number;
  removed: number;
};

function clientNames(): string[] {
  return listRevClients(false).map((c) => c.name);
}

function applyOverlay(existing: ForecastTask, mapped: MappedGoogleMeeting): void {
  if (
    existing.task_date === mapped.taskDate &&
    existing.start_time === mapped.startTime &&
    existing.hours === mapped.hours &&
    existing.notes === mapped.notes &&
    (existing.client || mapped.client) === (mapped.client || existing.client)
  ) {
    return;
  }
  updateTask(existing.id, {
    taskDate: mapped.taskDate,
    startTime: mapped.startTime,
    hours: mapped.hours,
    notes: mapped.notes,
    client: mapped.client || existing.client,
  });
}

export async function pullGoogleMeetings(
  person: string,
  fromYmd: string,
  toYmdExclusive: string,
  opts?: { force?: boolean }
): Promise<PullGoogleResult> {
  const empty = { created: 0, updated: 0, linked: 0, removed: 0 };
  if (!forecastGoogleEnabled()) {
    return { ok: true, skipped: "disabled", ...empty };
  }
  if (!googleConfigured()) {
    return { ok: true, skipped: "unconfigured", ...empty };
  }
  if (!hasGoogleConnection(person)) {
    return { ok: true, skipped: "not-connected", ...empty };
  }
  const conn = getGoogleConnection(person);
  if (!opts?.force && conn?.last_pulled_at) {
    const pulled = Date.parse(conn.last_pulled_at);
    if (Number.isFinite(pulled) && Date.now() - pulled < PULL_MIN_INTERVAL_MS) {
      return { ok: true, skipped: "throttled", ...empty };
    }
  }

  const { timeMin, timeMax } = rangeIso(fromYmd, toYmdExclusive);
  const listed = await listPrimaryEvents(person, timeMin, timeMax);
  if (!listed.ok) {
    return { ok: false, error: listed.error, ...empty };
  }

  const names = clientNames();
  const selfEmail = conn?.google_email || "";
  const seen = new Set<string>();
  let created = 0;
  let updated = 0;
  let linked = 0;

  for (const event of listed.items) {
    const mapped = mapGoogleEventToMeeting(event, {
      selfEmail,
      clientNames: names,
      timeZone: APP_TIME_ZONE,
    });
    if (!mapped) continue;
    seen.add(mapped.googleEventId);

    const existing = getTaskByGoogleEventId(person, mapped.googleEventId);
    if (existing) {
      if (existing.from_google) {
        applyOverlay(existing, mapped);
        updated += 1;
      }
      continue;
    }

    const slot = findUnlinkedMeetingAtSlot(
      person,
      mapped.taskDate,
      mapped.startTime
    );
    if (slot) {
      linkTaskGoogle(slot.id, { eventId: mapped.googleEventId });
      linked += 1;
      continue;
    }

    createTask({
      person,
      taskDate: mapped.taskDate,
      startTime: mapped.startTime,
      hours: mapped.hours,
      notes: mapped.notes,
      client: mapped.client,
      kind: "meeting",
      googleEventId: mapped.googleEventId,
      fromGoogle: true,
    });
    created += 1;
  }

  let removed = 0;
  for (const row of listGoogleOverlayTasks(person, fromYmd, toYmdExclusive)) {
    if (seen.has(row.google_event_id)) continue;
    if (row.actual_hours || row.tracked_seconds) continue;
    if (deleteTask(row.id)) removed += 1;
  }

  markGooglePulled(person);
  return { ok: true, created, updated, linked, removed };
}

export async function pullGoogleMeetingsForWeek(
  person: string,
  weekStart: string,
  opts?: { force?: boolean }
): Promise<PullGoogleResult> {
  return pullGoogleMeetings(person, weekStart, addWeeks(weekStart, 1), opts);
}

export type PushGoogleResult =
  | { ok: true; skipped: string; eventId?: string }
  | { ok: true; eventId: string; skipped?: undefined }
  | { ok: false; error: string };

export async function pushForecastMeetingToGoogle(
  taskOrId: ForecastTask | string
): Promise<PushGoogleResult> {
  const task = typeof taskOrId === "string" ? getTask(taskOrId) : taskOrId;
  if (!task) return { ok: false, error: "Not found" };
  if (!forecastGoogleEnabled()) return { ok: true, skipped: "disabled" };
  const gate = shouldPushToGoogle(task);
  if (!gate.ok) return { ok: true, skipped: gate.reason };
  if (!hasGoogleConnection(task.person)) {
    return { ok: true, skipped: "not-connected" };
  }

  const body = eventBodyForTask(task);
  if (!body) return { ok: true, skipped: "blank-start" };

  if (task.google_event_id) {
    if (!task.google_managed) {
      return { ok: true, skipped: "linked-existing", eventId: task.google_event_id };
    }
    const updated = await updatePrimaryEvent(
      task.person,
      task.google_event_id,
      body
    );
    if (!updated.ok) return { ok: false, error: updated.error };
    return { ok: true, eventId: task.google_event_id };
  }

  // List this local day so we can attach an invite the client already sent.
  const dayRange = rangeIso(task.task_date, addDay(task.task_date, 1));
  const listed = await listPrimaryEvents(task.person, dayRange.timeMin, dayRange.timeMax);
  if (listed.ok) {
    const hits = googleEventsAtSlot(listed.items, body.start.dateTime);
    const match =
      hits.find(
        (e) =>
          (e.summary || "").trim().toLowerCase() === body.summary.toLowerCase()
      ) || hits[0];
    if (match?.id) {
      linkTaskGoogle(task.id, { eventId: match.id });
      return { ok: true, skipped: "existing-slot", eventId: match.id };
    }
  }

  const created = await createPrimaryEvent(task.person, body);
  if (!created.ok) return { ok: false, error: created.error };
  linkTaskGoogle(task.id, { eventId: created.id, googleManaged: true });
  return { ok: true, eventId: created.id };
}

function addDay(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export async function deleteForecastGoogleEvent(
  task: ForecastTask
): Promise<{ ok: true; skipped?: string } | { ok: false; error: string }> {
  if (!task.google_event_id) return { ok: true, skipped: "none" };
  if (task.from_google || !task.google_managed) {
    return { ok: true, skipped: "not-managed" };
  }
  if (!hasGoogleConnection(task.person)) {
    return { ok: true, skipped: "not-connected" };
  }
  const result = await deletePrimaryEvent(task.person, task.google_event_id);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}

export function googleStatusFor(
  person: string,
  canConnect: boolean
): {
  configured: boolean;
  connected: boolean;
  email: string | null;
  name: string | null;
  error: string | null;
  canConnect: boolean;
} | null {
  if (!forecastGoogleEnabled()) return null;
  const configured = googleConfigured();
  const conn = getGoogleConnection(person);
  const connected = hasGoogleConnection(person);
  return {
    configured,
    connected,
    email: connected ? conn?.google_email || null : null,
    name: connected ? conn?.google_name || null : null,
    error: !configured
      ? "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set."
      : conn?.last_error || null,
    canConnect,
  };
}
