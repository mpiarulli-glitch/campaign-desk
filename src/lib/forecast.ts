import { nanoid } from "nanoid";
import { getDb, nowIso, type ForecastNote, type ForecastPriority, type ForecastTask } from "./db";
import { PEOPLE, isValidPerson, personLabel } from "./people";
import { parseTimeInput } from "./forecast-time";
import { runningSeconds } from "./forecast-timer";
import { addWeeks } from "./week";

export type { ForecastTask, ForecastPriority };

const PRIORITIES: ForecastPriority[] = ["urgent", "important", "flexible"];
function normPriority(v: unknown): ForecastPriority {
  return PRIORITIES.includes(v as ForecastPriority) ? (v as ForecastPriority) : "flexible";
}
export { PEOPLE, isValidPerson, personLabel };

export const WEEKLY_CAPACITY_HOURS = 40;

// The five workday dates (Mon-Fri) making up a Monday-keyed week.
export function weekdays(weekStart: string): string[] {
  const [y, m, d] = weekStart.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < 5; i++) {
    const dt = new Date(y, m - 1, d + i);
    out.push(
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`
    );
  }
  return out;
}

export function listTasksForPersonWeek(person: string, weekStart: string): ForecastTask[] {
  const end = addWeeks(weekStart, 1);
  return getDb()
    .prepare(
      `SELECT * FROM forecast_tasks
       WHERE person = ? AND task_date >= ? AND task_date < ?
       ORDER BY task_date ASC,
         CASE WHEN start_time = '' THEN 1 ELSE 0 END,
         start_time ASC,
         created_at ASC`
    )
    .all(person, weekStart, end) as ForecastTask[];
}

export function getTask(id: string): ForecastTask | null {
  return (
    (getDb().prepare(`SELECT * FROM forecast_tasks WHERE id = ?`).get(id) as
      | ForecastTask
      | undefined) || null
  );
}

export function createTask(input: {
  person: string;
  taskDate: string;
  client?: string;
  notes?: string;
  hours: number;
  priority?: ForecastPriority;
  basecampTodoId?: string;
  // Set when the picked item was a Basecamp subtask. basecampTodoId then carries
  // the PARENT to-do, because a step takes no timesheet entries of its own.
  basecampStepId?: string;
  basecampProjectId?: string;
  basecampEventId?: string;
  startTime?: string;
}): ForecastTask {
  const startTime = parseTimeInput(input.startTime || "");
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  // A row is a todo or a meeting, never both. If somehow given both, the meeting
  // wins and the todo link is dropped, so booking a meeting can never end up
  // closing an unrelated todo when the row is ticked off.
  const eventId = (input.basecampEventId || "").trim();
  const todoId = eventId ? "" : (input.basecampTodoId || "").trim();
  // A step id without its parent to-do is useless — ticking it would work but
  // logging time would have nothing timesheetable to land on — so it is only
  // kept when both arrived together.
  const stepId = todoId ? (input.basecampStepId || "").trim() : "";
  db.prepare(
    `INSERT INTO forecast_tasks (id, person, task_date, client, notes, hours, priority, basecamp_todo_id, basecamp_step_id, basecamp_project_id, basecamp_event_id, start_time, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.person,
    input.taskDate,
    (input.client || "").trim(),
    (input.notes || "").trim(),
    input.hours,
    normPriority(input.priority),
    todoId,
    stepId,
    (input.basecampProjectId || "").trim(),
    eventId,
    startTime,
    ts,
    ts
  );
  return getTask(id)!;
}

export function updateTask(
  id: string,
  updates: Partial<{
    taskDate: string;
    client: string;
    notes: string;
    hours: number;
    completed: boolean;
    priority: ForecastPriority;
    actualHours: number;
    basecampTimeEntryId: string;
    // Set when a manually-typed task gets a shadow Basecamp todo created for
    // it on first time-log, so a retry after a failed timesheet write reuses
    // that todo instead of creating another one.
    basecampTodoId: string;
    startTime: string;
  }>
): ForecastTask | null {
  const existing = getTask(id);
  if (!existing) return null;
  getDb()
    .prepare(
      `UPDATE forecast_tasks SET task_date = ?, client = ?, notes = ?, hours = ?, completed = ?, priority = ?, actual_hours = ?, basecamp_time_entry_id = ?, basecamp_todo_id = ?, start_time = ?, updated_at = ? WHERE id = ?`
    )
    .run(
      updates.taskDate ?? existing.task_date,
      updates.client !== undefined ? updates.client.trim() : existing.client,
      updates.notes !== undefined ? updates.notes.trim() : existing.notes,
      updates.hours ?? existing.hours,
      updates.completed !== undefined ? (updates.completed ? 1 : 0) : existing.completed,
      updates.priority ? normPriority(updates.priority) : existing.priority,
      updates.actualHours ?? existing.actual_hours,
      updates.basecampTimeEntryId ?? existing.basecamp_time_entry_id,
      updates.basecampTodoId ?? existing.basecamp_todo_id,
      updates.startTime !== undefined
        ? parseTimeInput(updates.startTime)
        : existing.start_time,
      nowIso(),
      id
    );
  return getTask(id);
}

/**
 * Record hours that Basecamp has just accepted for a task.
 *
 * Time is logged as the work happens, not only once it's finished, so a task can
 * take several entries: half an hour this morning, two more this afternoon.
 * `actual_hours` therefore accumulates, and every Basecamp entry id is kept in a
 * comma-separated list so nothing that was sent is forgotten — the column's
 * emptiness is still what "nothing logged yet" means everywhere it's read.
 */
export function recordTimeEntry(
  id: string,
  hours: number,
  entryId: string
): ForecastTask | null {
  const existing = getTask(id);
  if (!existing) return null;
  const ids = existing.basecamp_time_entry_id
    ? existing.basecamp_time_entry_id.split(",").filter(Boolean)
    : [];
  if (entryId && !ids.includes(entryId)) ids.push(entryId);
  getDb()
    .prepare(
      `UPDATE forecast_tasks SET actual_hours = ?, basecamp_time_entry_id = ?, updated_at = ? WHERE id = ?`
    )
    .run(
      Math.round((existing.actual_hours + hours) * 100) / 100,
      ids.join(","),
      nowIso(),
      id
    );
  return getTask(id);
}

/* ------------------------------------------------------ start / stop timer */

// The task this person currently has a timer running on, if any.
export function runningTaskForPerson(person: string): ForecastTask | null {
  return (
    (getDb()
      .prepare(
        `SELECT * FROM forecast_tasks WHERE person = ? AND timer_started_at != '' ORDER BY timer_started_at DESC LIMIT 1`
      )
      .get(person) as ForecastTask | undefined) || null
  );
}

// Bank whatever a running timer has measured and stop it. A no-op on a task with
// nothing running, so stopping twice is harmless.
export function stopTimer(id: string, now = Date.now()): ForecastTask | null {
  const task = getTask(id);
  if (!task) return null;
  if (!task.timer_started_at) return task;
  const banked = (task.tracked_seconds || 0) + runningSeconds(task, now);
  getDb()
    .prepare(
      `UPDATE forecast_tasks SET tracked_seconds = ?, timer_started_at = '', updated_at = ? WHERE id = ?`
    )
    .run(banked, nowIso(), id);
  return getTask(id);
}

/**
 * Start timing a task.
 *
 * Only one timer runs per person: you can only be doing one thing, and two
 * timers left running overnight would both bank a full night. Whatever else was
 * running is stopped first and keeps the time it measured, and it comes back in
 * `stopped` so the page can say which task that was.
 */
export function startTimer(
  person: string,
  id: string,
  now = Date.now()
): { task: ForecastTask | null; stopped: ForecastTask | null } {
  const task = getTask(id);
  if (!task || task.person !== person) return { task: null, stopped: null };
  if (task.timer_started_at) return { task, stopped: null };

  const running = runningTaskForPerson(person);
  const stopped = running && running.id !== id ? stopTimer(running.id, now) : null;

  getDb()
    .prepare(
      `UPDATE forecast_tasks SET timer_started_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(new Date(now).toISOString(), nowIso(), id);
  return { task: getTask(id), stopped };
}

export function deleteTask(id: string): boolean {
  return getDb().prepare(`DELETE FROM forecast_tasks WHERE id = ?`).run(id).changes > 0;
}

/* --------------------------------------------------------- week notes */

export function getWeekNote(person: string, weekStart: string): string {
  const row = getDb()
    .prepare(`SELECT body FROM forecast_notes WHERE person = ? AND week_start = ?`)
    .get(person, weekStart) as ForecastNote | undefined;
  return row?.body || "";
}

// One row per person per week — blank body clears it back to nothing rather
// than leaving an empty row behind.
export function upsertWeekNote(person: string, weekStart: string, body: string): string {
  const db = getDb();
  const trimmed = body.trim();
  const ts = nowIso();
  const existing = db
    .prepare(`SELECT id FROM forecast_notes WHERE person = ? AND week_start = ?`)
    .get(person, weekStart) as { id: string } | undefined;
  if (existing) {
    db.prepare(`UPDATE forecast_notes SET body = ?, updated_at = ? WHERE id = ?`).run(
      trimmed,
      ts,
      existing.id
    );
  } else if (trimmed) {
    db.prepare(
      `INSERT INTO forecast_notes (id, person, week_start, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(nanoid(12), person, weekStart, trimmed, ts, ts);
  }
  return trimmed;
}

export interface PersonWeekSummary {
  person: string;
  label: string;
  hours: number;
  capacity: number;
  allocationPct: number;
  urgentPct: number;
  importantPct: number;
  flexiblePct: number;
}

// Total forecasted hours per person for a week, against the flat weekly
// capacity, for the master allocation dashboard.
export function weekSummaryForAllPeople(weekStart: string): PersonWeekSummary[] {
  const end = addWeeks(weekStart, 1);
  const rows = getDb()
    .prepare(
      `SELECT person, SUM(hours) AS hours FROM forecast_tasks
       WHERE task_date >= ? AND task_date < ?
       GROUP BY person`
    )
    .all(weekStart, end) as Array<{ person: string; hours: number }>;
  const byPerson = new Map(rows.map((r) => [r.person, r.hours]));

  const priorityRows = getDb()
    .prepare(
      `SELECT person, priority, SUM(hours) AS hours FROM forecast_tasks
       WHERE task_date >= ? AND task_date < ?
       GROUP BY person, priority`
    )
    .all(weekStart, end) as Array<{ person: string; priority: ForecastPriority; hours: number }>;
  const priorityByPerson = new Map<string, Record<ForecastPriority, number>>();
  for (const row of priorityRows) {
    const entry = priorityByPerson.get(row.person) || { urgent: 0, important: 0, flexible: 0 };
    entry[row.priority] = row.hours;
    priorityByPerson.set(row.person, entry);
  }

  return PEOPLE.map((p) => {
    const hours = byPerson.get(p.slug) || 0;
    const priorityHours = priorityByPerson.get(p.slug) || { urgent: 0, important: 0, flexible: 0 };
    const priorityTotal = priorityHours.urgent + priorityHours.important + priorityHours.flexible;
    return {
      person: p.slug,
      label: p.label,
      hours,
      capacity: WEEKLY_CAPACITY_HOURS,
      allocationPct: Math.round((hours / WEEKLY_CAPACITY_HOURS) * 100),
      urgentPct: priorityTotal ? Math.round((priorityHours.urgent / priorityTotal) * 100) : 0,
      importantPct: priorityTotal ? Math.round((priorityHours.important / priorityTotal) * 100) : 0,
      flexiblePct: priorityTotal ? Math.round((priorityHours.flexible / priorityTotal) * 100) : 0,
    };
  });
}
