// Google Calendar API, always as a specific person.
//
// Primary calendar only. There is no shared token and no fallback: a missing
// connection is a skip, not a write under somebody else's name.

import {
  forceGoogleRefresh,
  googleAccessToken,
  hasGoogleConnection,
  noteGoogleError,
} from "./google-identity";

const CAL_BASE = "https://www.googleapis.com/calendar/v3";
const TIMEOUT_MS = 12_000;

export type GoogleAttendee = {
  email?: string;
  self?: boolean;
  resource?: boolean;
  responseStatus?: string;
  displayName?: string;
};

export type GoogleCalendarEvent = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: GoogleAttendee[];
  organizer?: { email?: string; self?: boolean };
  eventType?: string;
  transparency?: string;
};

export type GoogleEventTimes = {
  summary: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
};

async function gcal(
  person: string,
  path: string,
  init?: RequestInit
): Promise<Response | null> {
  const tok = await googleAccessToken(person);
  if (!tok) return null;
  const call = (t: string) =>
    fetch(`${CAL_BASE}${path}`, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${t}`,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
  let res = await call(tok);
  if (res.status === 401) {
    const fresh = await forceGoogleRefresh(person);
    if (!fresh) return res;
    res = await call(fresh);
  }
  return res;
}

export async function listPrimaryEvents(
  person: string,
  timeMin: string,
  timeMax: string
): Promise<{ ok: true; items: GoogleCalendarEvent[] } | { ok: false; error: string }> {
  if (!hasGoogleConnection(person)) {
    return { ok: false, error: "Google Calendar is not connected." };
  }
  const items: GoogleCalendarEvent[] = [];
  let pageToken = "";
  try {
    for (let i = 0; i < 8; i++) {
      const q = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "250",
        showDeleted: "false",
      });
      if (pageToken) q.set("pageToken", pageToken);
      const res = await gcal(person, `/calendars/primary/events?${q.toString()}`);
      if (!res) return { ok: false, error: "Google Calendar is not connected." };
      if (!res.ok) {
        const msg = `Google Calendar list failed (${res.status}).`;
        noteGoogleError(person, msg);
        return { ok: false, error: msg };
      }
      const d = (await res.json()) as {
        items?: GoogleCalendarEvent[];
        nextPageToken?: string;
      };
      if (Array.isArray(d.items)) items.push(...d.items);
      if (!d.nextPageToken) break;
      pageToken = d.nextPageToken;
    }
    return { ok: true, items };
  } catch (err) {
    const msg = (err as Error).message;
    noteGoogleError(person, msg);
    return { ok: false, error: msg };
  }
}

export async function createPrimaryEvent(
  person: string,
  event: GoogleEventTimes
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!hasGoogleConnection(person)) {
    return { ok: false, error: "Google Calendar is not connected." };
  }
  try {
    const res = await gcal(person, "/calendars/primary/events", {
      method: "POST",
      body: JSON.stringify(event),
    });
    if (!res) return { ok: false, error: "Google Calendar is not connected." };
    if (!res.ok) {
      const msg = `Google Calendar create failed (${res.status}).`;
      noteGoogleError(person, msg);
      return { ok: false, error: msg };
    }
    const d = (await res.json()) as { id?: string };
    if (!d.id) return { ok: false, error: "Google did not return an event id." };
    return { ok: true, id: d.id };
  } catch (err) {
    const msg = (err as Error).message;
    noteGoogleError(person, msg);
    return { ok: false, error: msg };
  }
}

export async function updatePrimaryEvent(
  person: string,
  eventId: string,
  event: GoogleEventTimes
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!hasGoogleConnection(person) || !eventId) {
    return { ok: false, error: "Google Calendar is not connected." };
  }
  try {
    const res = await gcal(
      person,
      `/calendars/primary/events/${encodeURIComponent(eventId)}`,
      { method: "PATCH", body: JSON.stringify(event) }
    );
    if (!res) return { ok: false, error: "Google Calendar is not connected." };
    if (res.status === 404) return { ok: true };
    if (!res.ok) {
      const msg = `Google Calendar update failed (${res.status}).`;
      noteGoogleError(person, msg);
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (err) {
    const msg = (err as Error).message;
    noteGoogleError(person, msg);
    return { ok: false, error: msg };
  }
}

export async function deletePrimaryEvent(
  person: string,
  eventId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!hasGoogleConnection(person) || !eventId) {
    return { ok: false, error: "Google Calendar is not connected." };
  }
  try {
    const res = await gcal(
      person,
      `/calendars/primary/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE" }
    );
    if (!res) return { ok: false, error: "Google Calendar is not connected." };
    if (res.status === 404 || res.status === 410) return { ok: true };
    if (!res.ok) {
      const msg = `Google Calendar delete failed (${res.status}).`;
      noteGoogleError(person, msg);
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (err) {
    const msg = (err as Error).message;
    noteGoogleError(person, msg);
    return { ok: false, error: msg };
  }
}
