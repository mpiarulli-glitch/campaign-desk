import { nanoid } from "nanoid";
import { getDb, nowIso } from "./db";
import {
  createAssignedTodo,
  type BcIdentity,
} from "./basecamp";
import {
  nextRepeatDueOn,
  type TodoRepeat,
} from "./forecast-tasks";

export type RepeatFrequency = Exclude<TodoRepeat, "once">;

export type ForecastTodoRepeat = {
  id: string;
  person: string;
  project_id: string;
  recording_id: string;
  kind: string;
  frequency: RepeatFrequency;
  title: string;
  list_id: string;
  assignee_id: number;
  created_at: string;
  updated_at: string;
};

export function listRepeatsForPerson(person: string): ForecastTodoRepeat[] {
  return getDb()
    .prepare(`SELECT * FROM forecast_todo_repeats WHERE person = ?`)
    .all(person) as ForecastTodoRepeat[];
}

export function getRepeat(
  projectId: string,
  recordingId: string
): ForecastTodoRepeat | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM forecast_todo_repeats WHERE project_id = ? AND recording_id = ?`
    )
    .get(projectId, recordingId) as ForecastTodoRepeat | undefined;
  return row || null;
}

export function upsertRepeat(input: {
  person: string;
  projectId: string;
  recordingId: string;
  kind?: string;
  frequency: RepeatFrequency;
  title: string;
  listId?: string;
  assigneeId?: number;
}): ForecastTodoRepeat {
  const existing = getRepeat(input.projectId, input.recordingId);
  const ts = nowIso();
  const db = getDb();
  if (existing) {
    db.prepare(
      `UPDATE forecast_todo_repeats
          SET frequency = ?, title = ?, list_id = ?, assignee_id = ?,
              kind = ?, person = ?, updated_at = ?
        WHERE id = ?`
    ).run(
      input.frequency,
      input.title.trim(),
      (input.listId || existing.list_id || "").trim(),
      input.assigneeId ?? existing.assignee_id,
      input.kind || existing.kind || "todo",
      input.person,
      ts,
      existing.id
    );
    return getRepeat(input.projectId, input.recordingId)!;
  }
  const id = nanoid(12);
  db.prepare(
    `INSERT INTO forecast_todo_repeats
       (id, person, project_id, recording_id, kind, frequency, title, list_id,
        assignee_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.person,
    input.projectId,
    input.recordingId,
    input.kind || "todo",
    input.frequency,
    input.title.trim(),
    (input.listId || "").trim(),
    input.assigneeId || 0,
    ts,
    ts
  );
  return getRepeat(input.projectId, input.recordingId)!;
}

export function deleteRepeat(projectId: string, recordingId: string): void {
  getDb()
    .prepare(
      `DELETE FROM forecast_todo_repeats WHERE project_id = ? AND recording_id = ?`
    )
    .run(projectId, recordingId);
}

/**
 * After a repeating to-do is completed, open the next occurrence on the same
 * list with a due date one interval out, then point the repeat row at it.
 */
export async function spawnNextRepeat(input: {
  person: string;
  projectId: string;
  recordingId: string;
  dueOn?: string | null;
  identity: BcIdentity;
}): Promise<{ created: boolean; todoId?: string; error?: string }> {
  const repeat = getRepeat(input.projectId, input.recordingId);
  if (!repeat) return { created: false };
  const fromDue = (input.dueOn || "").trim();
  const seed = fromDue || new Date().toISOString().slice(0, 10);
  const nextDue = nextRepeatDueOn(seed, repeat.frequency);
  const assignees = repeat.assignee_id > 0 ? [repeat.assignee_id] : [];
  const created = await createAssignedTodo({
    projectId: input.projectId,
    title: repeat.title,
    assigneeIds: assignees,
    dueOn: nextDue,
    identity: input.identity,
    listId: repeat.list_id || undefined,
    listName: repeat.list_id ? undefined : "Tasks",
    notify: false,
  });
  if (!created.ok) return { created: false, error: created.error };
  deleteRepeat(input.projectId, input.recordingId);
  upsertRepeat({
    person: repeat.person || input.person,
    projectId: input.projectId,
    recordingId: created.todoId,
    kind: repeat.kind,
    frequency: repeat.frequency,
    title: repeat.title,
    listId: created.listId || repeat.list_id,
    assigneeId: repeat.assignee_id,
  });
  return { created: true, todoId: created.todoId };
}
