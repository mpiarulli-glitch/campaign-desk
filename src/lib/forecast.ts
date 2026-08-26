import { nanoid } from "nanoid";
import { todayYmd } from "./cadence";
import {
  getDb,
  nowIso,
  type ForecastNote,
  type ForecastSubtask,
  type ForecastTask,
} from "./db";
import { PEOPLE, isValidPerson, personLabel } from "./people";
import { normalizeTaskColor } from "./forecast-colors";
import { parseTimeInput } from "./forecast-time";
import { runningSeconds } from "./forecast-timer";
import { addWeeks } from "./week";

export type { ForecastSubtask, ForecastTask, ForecastTimeLog } from "./db";
export { PEOPLE, isValidPerson, personLabel };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ForecastTaskWithSubtasks = ForecastTask & { subtasks: ForecastSubtask[] };

export const WEEKLY_CAPACITY_HOURS = 40;
export const DAILY_CAPACITY_HOURS = WEEKLY_CAPACITY_HOURS / 5;

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

export function listTasksForPersonWeek(person: string, weekStart: string): ForecastTaskWithSubtasks[] {
  const end = addWeeks(weekStart, 1);
  const tasks = getDb()
    .prepare(
      `SELECT * FROM forecast_tasks
       WHERE person = ? AND task_date >= ? AND task_date < ?
       ORDER BY task_date ASC,
         sort_order ASC,
         CASE WHEN start_time = '' THEN 1 ELSE 0 END,
         start_time ASC,
         created_at ASC`
    )
    .all(person, weekStart, end) as ForecastTask[];
  return attachSubtasks(tasks);
}

function attachSubtasks(tasks: ForecastTask[]): ForecastTaskWithSubtasks[] {
  if (!tasks.length) return [];
  const ids = tasks.map((t) => t.id);
  const placeholders = ids.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT * FROM forecast_subtasks
        WHERE task_id IN (${placeholders})
        ORDER BY sort_order ASC, created_at ASC`
    )
    .all(...ids) as ForecastSubtask[];
  const byTask = new Map<string, ForecastSubtask[]>();
  for (const row of rows) {
    const list = byTask.get(row.task_id) || [];
    list.push(row);
    byTask.set(row.task_id, list);
  }
  return tasks.map((t) => ({ ...t, subtasks: byTask.get(t.id) || [] }));
}

function nextSortOrder(person: string, date: string): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(MAX(sort_order), -1) AS m
         FROM forecast_tasks
        WHERE person = ? AND task_date = ?`
    )
    .get(person, date) as { m: number };
  return row.m + 1;
}

/**
 * Put these tasks on `date` in the given order, so a drag-and-drop can both
 * reschedule and rearrange in one move. Anything already on that day that
 * wasn't named is pushed after the named ones, rather than left interleaved
 * with colliding sort_order values.
 */
export function reorderDayTasks(
  person: string,
  date: string,
  orderedIds: string[]
): boolean {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const id of orderedIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  if (unique.length === 0) return false;

  const db = getDb();
  const tasks = unique.map((id) => getTask(id));
  if (tasks.some((t) => !t || t.person !== person)) return false;

  const named = new Set(unique);
  const leftovers = (
    db
      .prepare(
        `SELECT id FROM forecast_tasks
          WHERE person = ? AND task_date = ?
          ORDER BY sort_order ASC, created_at ASC`
      )
      .all(person, date) as Array<{ id: string }>
  )
    .map((row) => row.id)
    .filter((id) => !named.has(id));

  const ts = nowIso();
  const run = db.transaction(() => {
    const update = db.prepare(
      `UPDATE forecast_tasks SET task_date = ?, sort_order = ?, updated_at = ? WHERE id = ?`
    );
    unique.forEach((id, i) => update.run(date, i, ts, id));
    leftovers.forEach((id, i) => update.run(date, unique.length + i, ts, id));
  });
  run();
  return true;
}

export function getTask(id: string): ForecastTask | null {
  return (
    (getDb().prepare(`SELECT * FROM forecast_tasks WHERE id = ?`).get(id) as
      | ForecastTask
      | undefined) || null
  );
}

export function getSubtask(id: string): ForecastSubtask | null {
  return (
    (getDb().prepare(`SELECT * FROM forecast_subtasks WHERE id = ?`).get(id) as
      | ForecastSubtask
      | undefined) || null
  );
}

function nextSubtaskSortOrder(taskId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(MAX(sort_order), -1) AS m FROM forecast_subtasks WHERE task_id = ?`
    )
    .get(taskId) as { m: number };
  return row.m + 1;
}

export function createSubtask(input: {
  taskId: string;
  notes: string;
  completed?: boolean;
}): ForecastSubtask | null {
  const notes = input.notes.trim();
  if (!notes) return null;
  if (!getTask(input.taskId)) return null;
  const id = nanoid(12);
  const ts = nowIso();
  getDb()
    .prepare(
      `INSERT INTO forecast_subtasks (id, task_id, notes, completed, sort_order, basecamp_step_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '', ?, ?)`
    )
    .run(
      id,
      input.taskId,
      notes,
      input.completed === false ? 0 : 1,
      nextSubtaskSortOrder(input.taskId),
      ts,
      ts
    );
  return getSubtask(id);
}

export function linkSubtaskBasecamp(
  id: string,
  basecampStepId: string
): ForecastSubtask | null {
  if (!getSubtask(id)) return null;
  getDb()
    .prepare(
      `UPDATE forecast_subtasks SET basecamp_step_id = ?, updated_at = ? WHERE id = ?`
    )
    .run(basecampStepId.trim(), nowIso(), id);
  return getSubtask(id);
}

export function linkTaskBasecamp(
  id: string,
  basecampTodoId: string,
  basecampProjectId: string,
  basecampStepId = ""
): ForecastTask | null {
  if (!getTask(id)) return null;
  const todoId = basecampTodoId.trim();
  const projectId = basecampProjectId.trim();
  if (!todoId || !projectId) return null;
  // A step id without its parent to-do is useless — logging time has to land
  // on the parent — so it is only kept when both arrived together.
  const stepId = todoId ? basecampStepId.trim() : "";
  getDb()
    .prepare(
      `UPDATE forecast_tasks SET basecamp_todo_id = ?, basecamp_project_id = ?, basecamp_step_id = ?, updated_at = ? WHERE id = ?`
    )
    .run(todoId, projectId, stepId, nowIso(), id);
  return getTask(id);
}

/**
 * Attach a just-created Basecamp schedule entry to a forecast meeting.
 *
 * Clears any todo link: a meeting must never close or log against a to-do.
 */
export function linkTaskEvent(
  id: string,
  input: { eventId: string; projectId: string; client?: string }
): ForecastTask | null {
  const existing = getTask(id);
  if (!existing) return null;
  const eventId = input.eventId.trim();
  const projectId = input.projectId.trim();
  if (!eventId || !projectId) return null;
  getDb()
    .prepare(
      `UPDATE forecast_tasks
          SET basecamp_event_id = ?, basecamp_project_id = ?, client = ?,
              basecamp_todo_id = '', basecamp_step_id = '', kind = 'meeting',
              updated_at = ?
        WHERE id = ?`
    )
    .run(
      eventId,
      projectId,
      input.client !== undefined ? input.client.trim() : existing.client,
      nowIso(),
      id
    );
  return getTask(id);
}

export function updateSubtask(
  id: string,
  updates: Partial<{ notes: string; completed: boolean }>
): ForecastSubtask | null {
  const existing = getSubtask(id);
  if (!existing) return null;
  const notes =
    updates.notes !== undefined ? updates.notes.trim() : existing.notes;
  if (!notes) return null;
  getDb()
    .prepare(
      `UPDATE forecast_subtasks SET notes = ?, completed = ?, updated_at = ? WHERE id = ?`
    )
    .run(
      notes,
      updates.completed !== undefined
        ? updates.completed
          ? 1
          : 0
        : existing.completed,
      nowIso(),
      id
    );
  return getSubtask(id);
}

export function deleteSubtask(id: string): boolean {
  return getDb().prepare(`DELETE FROM forecast_subtasks WHERE id = ?`).run(id)
    .changes > 0;
}

export function createTask(input: {
  person: string;
  taskDate: string;
  client?: string;
  notes?: string;
  hours: number;
  color?: string;
  basecampTodoId?: string;
  // Set when the picked item was a Basecamp subtask. basecampTodoId then carries
  // the PARENT to-do, because a step takes no timesheet entries of its own.
  basecampStepId?: string;
  basecampProjectId?: string;
  basecampEventId?: string;
  // Typed meetings have no event id yet. Storing kind=meeting is what lets
  // complete ask for a client and write the calendar entry, instead of treating
  // the row as unlinked work that needs a todo.
  kind?: "work" | "meeting";
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
  const isMeeting = Boolean(eventId) || input.kind === "meeting";
  const kind: ForecastTask["kind"] = isMeeting ? "meeting" : "work";
  const todoId = isMeeting ? "" : (input.basecampTodoId || "").trim();
  // A step id without its parent to-do is useless — ticking it would work but
  // logging time would have nothing timesheetable to land on — so it is only
  // kept when both arrived together.
  const stepId = todoId ? (input.basecampStepId || "").trim() : "";
  db.prepare(
    `INSERT INTO forecast_tasks (id, person, task_date, client, notes, hours, color, basecamp_todo_id, basecamp_step_id, basecamp_project_id, basecamp_event_id, kind, start_time, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.person,
    input.taskDate,
    (input.client || "").trim(),
    (input.notes || "").trim(),
    input.hours,
    normalizeTaskColor(input.color),
    todoId,
    stepId,
    (input.basecampProjectId || "").trim(),
    eventId,
    kind,
    startTime,
    nextSortOrder(input.person, input.taskDate),
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
    color: string;
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
  const nextDate = updates.taskDate ?? existing.task_date;
  const sortOrder =
    nextDate !== existing.task_date
      ? nextSortOrder(existing.person, nextDate)
      : existing.sort_order;
  getDb()
    .prepare(
      `UPDATE forecast_tasks SET task_date = ?, client = ?, notes = ?, hours = ?, completed = ?, color = ?, actual_hours = ?, basecamp_time_entry_id = ?, basecamp_todo_id = ?, start_time = ?, sort_order = ?, updated_at = ? WHERE id = ?`
    )
    .run(
      nextDate,
      updates.client !== undefined ? updates.client.trim() : existing.client,
      updates.notes !== undefined ? updates.notes.trim() : existing.notes,
      updates.hours ?? existing.hours,
      updates.completed !== undefined ? (updates.completed ? 1 : 0) : existing.completed,
      updates.color !== undefined ? normalizeTaskColor(updates.color) : existing.color,
      updates.actualHours ?? existing.actual_hours,
      updates.basecampTimeEntryId ?? existing.basecamp_time_entry_id,
      updates.basecampTodoId ?? existing.basecamp_todo_id,
      updates.startTime !== undefined
        ? parseTimeInput(updates.startTime)
        : existing.start_time,
      sortOrder,
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
 *
 * Each write also lands in forecast_time_logs on the day it was logged (app
 * timezone), so day/week gauges keep those hours when the task is rescheduled.
 */
export function recordTimeEntry(
  id: string,
  hours: number,
  entryId: string,
  loggedDate?: string
): ForecastTask | null {
  const existing = getTask(id);
  if (!existing) return null;
  const ids = existing.basecamp_time_entry_id
    ? existing.basecamp_time_entry_id.split(",").filter(Boolean)
    : [];
  if (entryId && !ids.includes(entryId)) ids.push(entryId);
  const date = loggedDate && DATE_RE.test(loggedDate) ? loggedDate : todayYmd();
  const nextHours = Math.round((existing.actual_hours + hours) * 100) / 100;
  const rounded = Math.round(hours * 100) / 100;
  const db = getDb();
  const ts = nowIso();
  const run = db.transaction(() => {
    db.prepare(
      `UPDATE forecast_tasks SET actual_hours = ?, basecamp_time_entry_id = ?, updated_at = ? WHERE id = ?`
    ).run(nextHours, ids.join(","), ts, id);
    db.prepare(
      `INSERT INTO forecast_time_logs
         (id, task_id, person, logged_date, hours, basecamp_time_entry_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(nanoid(12), id, existing.person, date, rounded, entryId || "", ts);
  });
  run();
  return getTask(id);
}

/** Hours logged on each calendar day in [startInclusive, endExclusive). */
export function loggedHoursByDate(
  person: string,
  startInclusive: string,
  endExclusive: string
): Record<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT logged_date, SUM(hours) AS hours
         FROM forecast_time_logs
        WHERE person = ? AND logged_date >= ? AND logged_date < ?
        GROUP BY logged_date`
    )
    .all(person, startInclusive, endExclusive) as Array<{
    logged_date: string;
    hours: number;
  }>;
  const out: Record<string, number> = {};
  for (const row of rows) {
    out[row.logged_date] = Math.round(row.hours * 100) / 100;
  }
  return out;
}

export function loggedHoursOnDate(person: string, date: string): number {
  return loggedHoursByDate(person, date, addDays(date, 1))[date] || 0;
}

export function loggedHoursForWeek(person: string, weekStart: string): number {
  const byDate = loggedHoursByDate(person, weekStart, addWeeks(weekStart, 1));
  return Object.values(byDate).reduce((s, n) => s + n, 0);
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/* ------------------------------------------------------ start / stop timer */

// Two at once is enough to split attention without leaving a night of timers
// running on every task you touched. Oldest first, so a third start knows which
// one to bank.
export const MAX_RUNNING_TIMERS = 2;

export function runningTasksForPerson(person: string): ForecastTask[] {
  return getDb()
    .prepare(
      `SELECT * FROM forecast_tasks WHERE person = ? AND timer_started_at != '' ORDER BY timer_started_at ASC`
    )
    .all(person) as ForecastTask[];
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
 * Up to MAX_RUNNING_TIMERS can run at once for the same person. Starting a
 * second does not touch the first. Starting past that limit banks the oldest
 * running timer (it keeps the time it measured) and returns it in `stopped` so
 * the page can say which task gave way.
 */
export function startTimer(
  person: string,
  id: string,
  now = Date.now()
): { task: ForecastTask | null; stopped: ForecastTask | null } {
  const task = getTask(id);
  if (!task || task.person !== person) return { task: null, stopped: null };
  if (task.timer_started_at) return { task, stopped: null };

  const running = runningTasksForPerson(person).filter((t) => t.id !== id);
  const stopped =
    running.length >= MAX_RUNNING_TIMERS ? stopTimer(running[0].id, now) : null;

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

/* --------------------------------------------------------- plan undo */

export type PlanUndoMoved = { id: string; taskDate: string; startTime: string };

export type PlanUndoSnapshot = {
  createdIds: string[];
  moved: PlanUndoMoved[];
  note: string;
};

export function hasPlanUndo(person: string, weekStart: string): boolean {
  const row = getDb()
    .prepare(`SELECT id FROM forecast_plan_undos WHERE person = ? AND week_start = ?`)
    .get(person, weekStart) as { id: string } | undefined;
  return Boolean(row);
}

export function savePlanUndo(
  person: string,
  weekStart: string,
  snapshot: PlanUndoSnapshot
): void {
  if (!snapshot.createdIds.length && !snapshot.moved.length) return;
  const db = getDb();
  const ts = nowIso();
  const existing = db
    .prepare(`SELECT id FROM forecast_plan_undos WHERE person = ? AND week_start = ?`)
    .get(person, weekStart) as { id: string } | undefined;
  const createdIds = JSON.stringify(snapshot.createdIds);
  const moved = JSON.stringify(snapshot.moved);
  if (existing) {
    db.prepare(
      `UPDATE forecast_plan_undos SET created_ids = ?, moved = ?, note_before = ?, created_at = ? WHERE id = ?`
    ).run(createdIds, moved, snapshot.note, ts, existing.id);
    return;
  }
  db.prepare(
    `INSERT INTO forecast_plan_undos (id, person, week_start, created_ids, moved, note_before, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(nanoid(12), person, weekStart, createdIds, moved, snapshot.note, ts);
}

export function applyPlanUndo(
  person: string,
  weekStart: string
): { deleted: number; restored: number } | null {
  const row = getDb()
    .prepare(
      `SELECT id, created_ids, moved, note_before FROM forecast_plan_undos
       WHERE person = ? AND week_start = ?`
    )
    .get(person, weekStart) as
    | { id: string; created_ids: string; moved: string; note_before: string }
    | undefined;
  if (!row) return null;
  let createdIds: string[] = [];
  let moved: PlanUndoMoved[] = [];
  try {
    createdIds = JSON.parse(row.created_ids) as string[];
    moved = JSON.parse(row.moved) as PlanUndoMoved[];
  } catch {
    createdIds = [];
    moved = [];
  }
  let deleted = 0;
  for (const id of createdIds) {
    if (deleteTask(id)) deleted += 1;
  }
  let restored = 0;
  for (const item of moved) {
    const existing = getTask(item.id);
    if (!existing || existing.person !== person) continue;
    updateTask(item.id, { taskDate: item.taskDate, startTime: item.startTime });
    restored += 1;
  }
  upsertWeekNote(person, weekStart, row.note_before);
  getDb().prepare(`DELETE FROM forecast_plan_undos WHERE id = ?`).run(row.id);
  return { deleted, restored };
}

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
  // How much of the week is already finished, which is the useful split now that
  // priority is gone: what someone has left to do says more about their week
  // than how they had labelled it.
  donePct: number;
  taskCount: number;
  doneCount: number;
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

  const progressRows = getDb()
    .prepare(
      `SELECT person,
              COUNT(*) AS tasks,
              SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS done,
              SUM(CASE WHEN completed = 1 THEN hours ELSE 0 END) AS done_hours
         FROM forecast_tasks
        WHERE task_date >= ? AND task_date < ?
        GROUP BY person`
    )
    .all(weekStart, end) as Array<{
    person: string;
    tasks: number;
    done: number;
    done_hours: number;
  }>;
  const progressByPerson = new Map(progressRows.map((r) => [r.person, r]));

  return PEOPLE.map((p) => {
    const hours = byPerson.get(p.slug) || 0;
    const progress = progressByPerson.get(p.slug);
    return {
      person: p.slug,
      label: p.label,
      hours,
      capacity: WEEKLY_CAPACITY_HOURS,
      allocationPct: Math.round((hours / WEEKLY_CAPACITY_HOURS) * 100),
      donePct: hours ? Math.round(((progress?.done_hours || 0) / hours) * 100) : 0,
      taskCount: progress?.tasks || 0,
      doneCount: progress?.done || 0,
    };
  });
}
