// The start/stop timer on a forecast task.
//
// Time measured here is deliberately NOT the same number as the hours logged to
// Basecamp. Tracking runs while the work happens; sending hours to a
// client-visible timesheet is a separate, deliberate act. So a task carries both:
// `tracked_seconds` is what the timer has measured, `actual_hours` is what has
// been sent. The log box just offers the tracked figure as its default.

export interface TimedTask {
  tracked_seconds: number;
  timer_started_at: string;
}

export function isRunning(task: TimedTask): boolean {
  return Boolean(task.timer_started_at);
}

// The shell dock and the forecast page share this so starting/stopping in one
// place refreshes the other without waiting for the next poll.
export const FORECAST_TIMER_CHANGED = "forecast-timer-changed";

export function notifyForecastTimerChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(FORECAST_TIMER_CHANGED));
}

// Seconds since the timer started, or 0 when nothing is running. Never negative:
// a clock that has moved backwards since the timer started would otherwise take
// time off the total.
export function runningSeconds(task: TimedTask, nowMs: number): number {
  if (!task.timer_started_at) return 0;
  const started = Date.parse(task.timer_started_at);
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.floor((nowMs - started) / 1000));
}

// Everything the timer has measured for this task, including the segment still
// running.
export function trackedSeconds(task: TimedTask, nowMs: number): number {
  return (task.tracked_seconds || 0) + runningSeconds(task, nowMs);
}

export function trackedHours(task: TimedTask, nowMs: number): number {
  return Math.round((trackedSeconds(task, nowMs) / 3600) * 100) / 100;
}

// "1:04:09" while a timer is running, "1h 04m" once it has stopped — seconds
// matter when you're watching them go by and are noise afterwards.
export function formatTracked(seconds: number, live: boolean): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (live) {
    return h
      ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
      : `${m}:${String(sec).padStart(2, "0")}`;
  }
  if (!h) return `${m}m`;
  return m ? `${h}h ${String(m).padStart(2, "0")}m` : `${h}h`;
}

/**
 * How long a task's calendar block should draw as.
 *
 * The plan is the floor and measured time pushes past it: a two-hour block that
 * has taken three hours draws three hours long, so the calendar shows the day
 * that actually happened rather than the one that was planned. It never shrinks
 * below the plan, because a task half done is still booked for its full estimate.
 */
export function blockHours(
  task: TimedTask & { hours: number },
  nowMs: number
): number {
  return Math.max(task.hours || 0, trackedHours(task, nowMs));
}

/**
 * Hours to offer when logging time on a task, as a string for an input.
 *
 * Measured time wins whenever the timer has run and some of it is unsent — that
 * is the whole point of having timed it, and subtracting what has already gone
 * keeps a second log from double-counting. Otherwise it is the forecast estimate
 * the first time, and blank once hours are on the row, so a repeat log is always
 * a number somebody typed on purpose.
 *
 * "" therefore means "nothing outstanding", which is also the signal not to ask
 * about a task being ticked off: it has already been accounted for.
 */
export function hoursToOffer(
  task: TimedTask & { hours: number; actual_hours: number; basecamp_time_entry_id: string },
  nowMs: number
): string {
  const outstanding =
    Math.round((trackedHours(task, nowMs) - task.actual_hours) * 100) / 100;
  if (outstanding > 0) return String(outstanding);
  if (task.basecamp_time_entry_id) return "";
  return String(task.hours);
}

/** Somewhere hours can land without inventing a Basecamp recording. */
export function hasTimesheetDestination(task: {
  basecamp_todo_id?: string;
  basecamp_event_id?: string;
  basecamp_project_id?: string;
}): boolean {
  return Boolean(
    task.basecamp_todo_id || task.basecamp_event_id || task.basecamp_project_id
  );
}

/**
 * Whether finishing a task should raise the "log the time?" card.
 *
 * Linked work only asks while hours are still outstanding. Unlinked work
 * (typed, restored, or missing Basecamp ids) still asks — there is nowhere
 * for the hours to have gone, and hiding the card made those ticks look like
 * the time had already been handled.
 */
export function shouldAskToLogOnComplete(
  task: TimedTask & {
    hours: number;
    actual_hours: number;
    basecamp_time_entry_id: string;
    basecamp_todo_id?: string;
    basecamp_event_id?: string;
    basecamp_project_id?: string;
  },
  nowMs: number
): boolean {
  if (!hasTimesheetDestination(task)) return true;
  return hoursToOffer(task, nowMs) !== "";
}
