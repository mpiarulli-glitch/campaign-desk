import { APP_TIME_ZONE } from "./cadence";
import {
  asPerson,
  createScheduleEntry,
  hasConnection,
} from "./basecamp";
import { getConnection } from "./basecamp-identity";
import { cacheScheduleEntry } from "./basecamp-events";
import { scheduleEntryTimes } from "./forecast-time";
import { linkTaskEvent, type ForecastTask } from "./forecast";
import { getRevClient } from "./revenue";

export function resolveForecastProjectId(input: {
  clientId?: string;
  basecampProjectId?: string;
}): string {
  const explicit = (input.basecampProjectId || "").trim();
  if (explicit) return explicit;
  const clientId = (input.clientId || "").trim();
  if (clientId.startsWith("internal:")) return clientId.slice("internal:".length);
  if (!clientId) return "";
  return (getRevClient(clientId)?.basecamp_project_id || "").trim();
}

export type BookTypedMeetingResult =
  | { ok: true; eventId: string; projectId: string }
  | { ok: false; status: number; error: string; needsBasecamp?: boolean };

/**
 * Create a Basecamp calendar entry for a typed forecast meeting, then cache it
 * so the picker can see it. Hours later log against that recording.
 */
export async function bookTypedMeetingOnBasecamp(input: {
  person: string;
  taskDate: string;
  startTime: string;
  hours: number;
  title: string;
  clientId?: string;
  clientName?: string;
  basecampProjectId?: string;
}): Promise<BookTypedMeetingResult> {
  const projectId = resolveForecastProjectId(input);
  if (!projectId) {
    return {
      ok: false,
      status: 400,
      error: "Pick a client or project so this can go on that Basecamp calendar.",
    };
  }
  if (!hasConnection(input.person)) {
    return {
      ok: false,
      status: 409,
      needsBasecamp: true,
      error:
        "Connect your own Basecamp account first, so this meeting is added as you.",
    };
  }

  const times = scheduleEntryTimes({
    date: input.taskDate,
    startTime: input.startTime,
    hours: input.hours,
    timeZone: APP_TIME_ZONE,
  });
  const conn = getConnection(input.person);
  const created = await createScheduleEntry(
    projectId,
    {
      summary: input.title,
      startsAt: times.startsAt,
      endsAt: times.endsAt,
      allDay: times.allDay,
      participantIds: conn?.bc_person_id ? [conn.bc_person_id] : undefined,
    },
    asPerson(input.person)
  );
  if (!created.ok) {
    return { ok: false, status: 502, error: created.error };
  }

  const clientId = (input.clientId || "").trim();
  cacheScheduleEntry({
    id: created.id,
    projectId,
    clientId: clientId.startsWith("internal:") ? null : clientId || null,
    clientName: input.clientName || "",
    projectName: created.projectName,
    title: created.title,
    eventDate: input.taskDate,
    startsAt: created.startsAt,
    endsAt: created.endsAt,
    allDay: created.allDay,
    participants: created.participants.join(", "),
    appUrl: created.appUrl,
  });

  return { ok: true, eventId: created.id, projectId };
}

export type EnsureMeetingResult =
  | { ok: true; task: ForecastTask }
  | { ok: false; status: number; error: string; needsBasecamp?: boolean };

/**
 * Put a typed forecast meeting onto a project's Basecamp calendar if it is not
 * there yet, then store the event id on the row. Completing/logging is what
 * names the client; add only books the local forecast slot.
 */
export async function ensureMeetingOnBasecamp(input: {
  task: ForecastTask;
  person: string;
  clientId?: string;
  clientName?: string;
  basecampProjectId?: string;
}): Promise<EnsureMeetingResult> {
  if (input.task.basecamp_event_id) {
    return { ok: true, task: input.task };
  }
  const clientName = (input.clientName || input.task.client || "").trim();
  const booked = await bookTypedMeetingOnBasecamp({
    person: input.person,
    taskDate: input.task.task_date,
    startTime: input.task.start_time,
    hours: input.task.hours,
    title: input.task.notes || clientName || "Meeting",
    clientId: input.clientId,
    clientName,
    basecampProjectId: input.basecampProjectId || input.task.basecamp_project_id,
  });
  if (!booked.ok) return booked;
  const task =
    linkTaskEvent(input.task.id, {
      eventId: booked.eventId,
      projectId: booked.projectId,
      client: clientName,
    }) || input.task;
  return { ok: true, task };
}
