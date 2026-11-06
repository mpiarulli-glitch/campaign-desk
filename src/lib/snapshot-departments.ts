// What each department did on a client's weekly snapshot.
//
// Every department section, always shown to the team. Each one is an ordered list
// of items. The client, the Friday email, and the Basecamp post only receive
// departments that have at least one item. Deliverable rows are a different
// record and are not read or removed here.
//
// Older builds stored one text blob in snapshot_department_notes. The first
// read copies that blob into a single list item and marks the blob migrated,
// so clearing the list later does not bring the blob back.

import { nanoid } from "nanoid";
import { getDb, nowIso } from "./db";
import {
  SNAPSHOT_DEPARTMENTS,
  snapshotItemStatusFrom,
  type SnapshotDepartmentSlug,
  type SnapshotItemStatus,
} from "./snapshot-department-list";

export {
  SNAPSHOT_DEPARTMENTS,
  departmentLabel,
  isSnapshotDepartment,
  type SnapshotDepartmentSlug,
} from "./snapshot-department-list";

export type SnapshotDepartmentItem = {
  id: string;
  body: string;
  /** True when status is completed. Kept so older readers still see the check. */
  completed: boolean;
  status: SnapshotItemStatus;
  sourceKey: string;
  /** "sent" keeps the Sent for approval badge. Empty for a normal line. */
  mark: "" | "sent";
};

export type SnapshotDepartmentNote = {
  department: SnapshotDepartmentSlug;
  label: string;
  items: SnapshotDepartmentItem[];
};

type ItemRow = {
  id: string;
  department: string;
  body: string;
  sort_order: number;
  completed: number;
  source_key: string;
  mark: string;
  status?: string;
};

/** Copy each unmigrated single-note blob into one list item. Idempotent. */
export function migrateLegacyDepartmentNotes(): void {
  const db = getDb();
  const pending = db
    .prepare(
      `SELECT id, client_id, week_start, department, body, logged_by, created_at
       FROM snapshot_department_notes
       WHERE migrated = 0`
    )
    .all() as Array<{
    id: string;
    client_id: string;
    week_start: string;
    department: string;
    body: string;
    logged_by: string;
    created_at: string;
  }>;
  if (!pending.length) return;
  const insert = db.prepare(
    `INSERT INTO snapshot_department_items
       (id, client_id, week_start, department, body, sort_order, logged_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`
  );
  const mark = db.prepare(
    `UPDATE snapshot_department_notes SET migrated = 1 WHERE id = ?`
  );
  const now = nowIso();
  const run = db.transaction(() => {
    for (const row of pending) {
      const body = (row.body || "").trim();
      if (body) {
        insert.run(
          nanoid(12),
          row.client_id,
          row.week_start,
          row.department,
          body,
          row.logged_by || "",
          row.created_at || now,
          now
        );
      }
      mark.run(row.id);
    }
  });
  run();
}

/** All six sections, in display order. A department with no items has []. */
export function departmentNotesForWeek(
  clientId: string,
  weekStart: string
): SnapshotDepartmentNote[] {
  migrateLegacyDepartmentNotes();
  const rows = getDb()
    .prepare(
      `SELECT id, department, body, sort_order, completed, source_key, mark, status
       FROM snapshot_department_items
       WHERE client_id = ? AND week_start = ?
       ORDER BY sort_order ASC, created_at ASC, id ASC`
    )
    .all(clientId, weekStart) as ItemRow[];
  const bySlug = new Map<string, SnapshotDepartmentItem[]>();
  for (const row of rows) {
    const body = (row.body || "").trim();
    if (!body) continue;
    const list = bySlug.get(row.department) || [];
    const mark = row.mark === "sent" ? "sent" : "";
    const status = snapshotItemStatusFrom({
      status: row.status,
      completed: row.completed,
      mark,
    });
    list.push({
      id: row.id,
      body,
      completed: status === "completed",
      status,
      sourceKey: row.source_key || "",
      mark,
    });
    bySlug.set(row.department, list);
  }
  return SNAPSHOT_DEPARTMENTS.map((dept) => ({
    department: dept.slug,
    label: dept.label,
    items: bySlug.get(dept.slug) || [],
  }));
}

/** Client-facing list: departments that have items, still in display order. */
export function filledDepartmentNotes(
  clientId: string,
  weekStart: string
): SnapshotDepartmentNote[] {
  return departmentNotesForWeek(clientId, weekStart).filter((note) => note.items.length > 0);
}

export function addDepartmentItem(input: {
  clientId: string;
  weekStart: string;
  department: SnapshotDepartmentSlug;
  body: string;
  loggedBy?: string;
  /** Set when the line is a completed Basecamp to-do. */
  completed?: boolean;
  status?: SnapshotItemStatus;
  sourceKey?: string;
  /** "sent" when the line came from a Sent-for-approval card. */
  mark?: "" | "sent";
}): SnapshotDepartmentItem | null {
  const body = input.body.trim();
  if (!body) return null;
  migrateLegacyDepartmentNotes();
  const db = getDb();
  const now = nowIso();
  const max = db
    .prepare(
      `SELECT COALESCE(MAX(sort_order), -1) AS n
       FROM snapshot_department_items
       WHERE client_id = ? AND week_start = ? AND department = ?`
    )
    .get(input.clientId, input.weekStart, input.department) as { n: number };
  const id = nanoid(12);
  const sourceKey = (input.sourceKey || "").trim();
  const mark = input.mark === "sent" ? "sent" : "";
  const status = snapshotItemStatusFrom({
    status: input.status,
    completed: input.completed,
    mark,
  });
  const completed = status === "completed" ? 1 : 0;
  db.prepare(
    `INSERT INTO snapshot_department_items
       (id, client_id, week_start, department, body, sort_order, logged_by,
        created_at, updated_at, completed, source_key, mark, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.clientId,
    input.weekStart,
    input.department,
    body,
    (max?.n ?? -1) + 1,
    input.loggedBy || "",
    now,
    now,
    completed,
    sourceKey,
    mark,
    status
  );
  return { id, body, completed: Boolean(completed), status, sourceKey, mark };
}

export function updateDepartmentItem(input: {
  itemId: string;
  body?: string;
  completed?: boolean;
  status?: SnapshotItemStatus;
  loggedBy?: string;
}): SnapshotDepartmentItem | null {
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT id, body, completed, source_key, mark, status
       FROM snapshot_department_items WHERE id = ?`
    )
    .get(input.itemId) as
    | {
        id: string;
        body: string;
        completed: number;
        source_key: string;
        mark: string;
        status: string;
      }
    | undefined;
  if (!existing) return null;
  const body = input.body === undefined ? existing.body : input.body.trim();
  if (!body) return null;
  const mark = existing.mark === "sent" ? "sent" : "";
  let status = snapshotItemStatusFrom({
    status: existing.status,
    completed: existing.completed,
    mark,
  });
  if (input.status) status = input.status;
  else if (input.completed === true) status = "completed";
  else if (input.completed === false && status === "completed") status = "in_progress";
  const completed = status === "completed" ? 1 : 0;
  db.prepare(
    `UPDATE snapshot_department_items
       SET body = ?, completed = ?, status = ?, logged_by = ?, updated_at = ?
     WHERE id = ?`
  ).run(body, completed, status, input.loggedBy || "", nowIso(), input.itemId);
  return {
    id: existing.id,
    body,
    completed: Boolean(completed),
    status,
    sourceKey: existing.source_key || "",
    mark,
  };
}

/**
 * Move an item to a department and place it before `beforeId`, or at the end.
 * Text, check, Basecamp id, and sent-for-approval mark stay on the row.
 */
export function moveDepartmentItem(input: {
  itemId: string;
  department: SnapshotDepartmentSlug;
  beforeId?: string | null;
}): { clientId: string; weekStart: string } | null {
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT id, client_id, week_start FROM snapshot_department_items WHERE id = ?`
    )
    .get(input.itemId) as
    | { id: string; client_id: string; week_start: string }
    | undefined;
  if (!existing) return null;
  const siblings = db
    .prepare(
      `SELECT id FROM snapshot_department_items
       WHERE client_id = ? AND week_start = ? AND department = ? AND id != ?
       ORDER BY sort_order ASC, created_at ASC, id ASC`
    )
    .all(existing.client_id, existing.week_start, input.department, existing.id) as Array<{
    id: string;
  }>;
  const ids = siblings.map((row) => row.id);
  const before = (input.beforeId || "").trim();
  const index = before ? ids.indexOf(before) : -1;
  if (index >= 0) ids.splice(index, 0, existing.id);
  else ids.push(existing.id);
  const now = nowIso();
  const place = db.prepare(
    `UPDATE snapshot_department_items
       SET department = ?, sort_order = ?, updated_at = ?
     WHERE id = ?`
  );
  const run = db.transaction(() => {
    ids.forEach((id, order) => {
      place.run(input.department, order, now, id);
    });
  });
  run();
  return { clientId: existing.client_id, weekStart: existing.week_start };
}

export function departmentHasSourceKey(
  clientId: string,
  weekStart: string,
  sourceKey: string
): boolean {
  const key = sourceKey.trim();
  if (!key) return false;
  const row = getDb()
    .prepare(
      `SELECT id FROM snapshot_department_items
       WHERE client_id = ? AND week_start = ? AND source_key = ?
       LIMIT 1`
    )
    .get(clientId, weekStart, key) as { id: string } | undefined;
  return Boolean(row);
}

export function departmentItemClientId(itemId: string): string | null {
  const row = getDb()
    .prepare(`SELECT client_id FROM snapshot_department_items WHERE id = ?`)
    .get(itemId) as { client_id: string } | undefined;
  return row?.client_id || null;
}

export function deleteDepartmentItem(itemId: string): boolean {
  const res = getDb()
    .prepare(`DELETE FROM snapshot_department_items WHERE id = ?`)
    .run(itemId);
  return res.changes > 0;
}
