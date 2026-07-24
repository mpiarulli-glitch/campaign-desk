import { nanoid } from "nanoid";
import { getDb, nowIso, type ForecastPriority, type Todo, type TodoStatus } from "./db";

export type { Todo, TodoStatus };

const PRIORITIES: ForecastPriority[] = ["urgent", "important", "flexible"];
function normPriority(v: unknown): ForecastPriority {
  return PRIORITIES.includes(v as ForecastPriority) ? (v as ForecastPriority) : "flexible";
}

function parseTags(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

// A todo with tags parsed into a real array, which is what every caller wants.
export interface TodoView extends Omit<Todo, "tags"> {
  tags: string[];
}

function toView(row: Todo): TodoView {
  return { ...row, tags: parseTags(row.tags) };
}

export interface TodoFilter {
  clientId?: string | null; // null = team-wide only; undefined = any
  assignee?: string; // matches assignee OR a tag
  status?: TodoStatus;
}

export function listTodos(filter: TodoFilter = {}): TodoView[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filter.clientId === null) {
    where.push("client_id IS NULL");
  } else if (typeof filter.clientId === "string") {
    where.push("client_id = ?");
    params.push(filter.clientId);
  }
  if (filter.status) {
    where.push("status = ?");
    params.push(filter.status);
  }

  const sql = `SELECT * FROM todos ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY status ASC,
      CASE priority WHEN 'urgent' THEN 0 WHEN 'important' THEN 1 ELSE 2 END ASC,
      (due_date IS NULL) ASC, due_date ASC, sort_order ASC, created_at ASC`;
  let rows = (getDb().prepare(sql).all(...params) as Todo[]).map(toView);

  if (filter.assignee) {
    rows = rows.filter(
      (t) => t.assignee === filter.assignee || t.tags.includes(filter.assignee!)
    );
  }
  return rows;
}

export function getTodo(id: string): TodoView | null {
  const row = getDb().prepare(`SELECT * FROM todos WHERE id = ?`).get(id) as
    | Todo
    | undefined;
  return row ? toView(row) : null;
}

export function createTodo(input: {
  title: string;
  notes?: string;
  clientId?: string | null;
  assignee?: string;
  tags?: string[];
  dueDate?: string | null;
  priority?: ForecastPriority;
  source?: string;
  listName?: string;
  createdBy?: string;
}): TodoView {
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  db.prepare(
    `INSERT INTO todos
      (id, title, notes, client_id, assignee, tags, due_date, status, priority, source, list_name, created_by, sort_order, completed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, 0, NULL, ?, ?)`
  ).run(
    id,
    input.title.trim(),
    (input.notes || "").trim(),
    input.clientId ?? null,
    (input.assignee || "").trim(),
    JSON.stringify(input.tags || []),
    input.dueDate || null,
    normPriority(input.priority),
    input.source || "manual",
    (input.listName || "").trim(),
    input.createdBy || "",
    ts,
    ts
  );
  return getTodo(id)!;
}

export function updateTodo(
  id: string,
  updates: Partial<{
    title: string;
    notes: string;
    clientId: string | null;
    assignee: string;
    tags: string[];
    dueDate: string | null;
    status: TodoStatus;
    priority: ForecastPriority;
  }>
): TodoView | null {
  const existing = getTodo(id);
  if (!existing) return null;

  const status = updates.status ?? existing.status;
  const completedAt =
    status === "done"
      ? existing.completed_at || nowIso()
      : null;

  getDb()
    .prepare(
      `UPDATE todos SET title = ?, notes = ?, client_id = ?, assignee = ?, tags = ?,
        due_date = ?, status = ?, priority = ?, completed_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      updates.title !== undefined ? updates.title.trim() : existing.title,
      updates.notes !== undefined ? updates.notes.trim() : existing.notes,
      updates.clientId !== undefined ? updates.clientId : existing.client_id,
      updates.assignee !== undefined ? updates.assignee.trim() : existing.assignee,
      updates.tags !== undefined ? JSON.stringify(updates.tags) : JSON.stringify(existing.tags),
      updates.dueDate !== undefined ? updates.dueDate : existing.due_date,
      status,
      updates.priority ? normPriority(updates.priority) : existing.priority,
      completedAt,
      nowIso(),
      id
    );
  return getTodo(id);
}

export function deleteTodo(id: string): boolean {
  return getDb().prepare(`DELETE FROM todos WHERE id = ?`).run(id).changes > 0;
}

// Open-todo counts per person (assignee or tagged), for badges/dashboards.
export function openCountsByPerson(): Map<string, number> {
  const rows = listTodos({ status: "open" });
  const map = new Map<string, number>();
  for (const t of rows) {
    const people = new Set([t.assignee, ...t.tags].filter(Boolean));
    for (const p of people) map.set(p, (map.get(p) || 0) + 1);
  }
  return map;
}
