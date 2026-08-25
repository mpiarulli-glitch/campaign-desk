import { runningTasksForPerson } from "./forecast";
import { forecastSlugForSession } from "./people";

export type RunningTimerTask = {
  id: string;
  person: string;
  notes: string;
  client: string;
  tracked_seconds: number;
  timer_started_at: string;
};

/**
 * Running timers for whoever this session is — never a person from the query
 * string, so an admin looking at someone else's week cannot pull their clock.
 */
export function runningTimersForSession(session: {
  role: "admin" | "forecast";
  person: string | null;
  impersonating?: boolean;
} | null): {
  status: 200 | 401;
  body:
    | { error: string }
    | { person: string; tasks: RunningTimerTask[] };
} {
  const person = forecastSlugForSession(session);
  if (!person) {
    return { status: 401, body: { error: "Unauthorized" } };
  }
  return {
    status: 200,
    body: {
      person,
      tasks: runningTasksForPerson(person).map((task) => ({
        id: task.id,
        person: task.person,
        notes: task.notes,
        client: task.client,
        tracked_seconds: task.tracked_seconds,
        timer_started_at: task.timer_started_at,
      })),
    },
  };
}
