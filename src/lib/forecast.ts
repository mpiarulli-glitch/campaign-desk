import { nanoid } from "nanoid";
import { getDb, nowIso, type ForecastNote, type ForecastTask } from "./db";
import { PEOPLE, isValidPerson, personLabel } from "./people";
import { addWeeks } from "./week";

export type { ForecastTask };
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
       ORDER BY task_date ASC, created_at ASC`
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
}): ForecastTask {
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  db.prepare(
    `INSERT INTO forecast_tasks (id, person, task_date, client, notes, hours, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.person,
    input.taskDate,
    (input.client || "").trim(),
    (input.notes || "").trim(),
    input.hours,
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
  }>
): ForecastTask | null {
  const existing = getTask(id);
  if (!existing) return null;
  getDb()
    .prepare(
      `UPDATE forecast_tasks SET task_date = ?, client = ?, notes = ?, hours = ?, completed = ?, updated_at = ? WHERE id = ?`
    )
    .run(
      updates.taskDate ?? existing.task_date,
      updates.client !== undefined ? updates.client.trim() : existing.client,
      updates.notes !== undefined ? updates.notes.trim() : existing.notes,
      updates.hours ?? existing.hours,
      updates.completed !== undefined ? (updates.completed ? 1 : 0) : existing.completed,
      nowIso(),
      id
    );
  return getTask(id);
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
  return PEOPLE.map((p) => {
    const hours = byPerson.get(p.slug) || 0;
    return {
      person: p.slug,
      label: p.label,
      hours,
      capacity: WEEKLY_CAPACITY_HOURS,
      allocationPct: Math.round((hours / WEEKLY_CAPACITY_HOURS) * 100),
    };
  });
}
