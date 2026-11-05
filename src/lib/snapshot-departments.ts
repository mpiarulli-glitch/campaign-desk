// What each department did on a client's weekly snapshot.
//
// Six fixed sections, always shown to the team. The client, the Friday email,
// and the Basecamp post only receive the ones that have text. Deliverable
// rows are a different record and are not read or removed here.

import { nanoid } from "nanoid";
import { getDb, nowIso } from "./db";
import {
  SNAPSHOT_DEPARTMENTS,
  departmentLabel,
  type SnapshotDepartmentSlug,
} from "./snapshot-department-list";

export {
  SNAPSHOT_DEPARTMENTS,
  departmentLabel,
  isSnapshotDepartment,
  type SnapshotDepartmentSlug,
} from "./snapshot-department-list";

export type SnapshotDepartmentNote = {
  department: SnapshotDepartmentSlug;
  label: string;
  body: string;
};

/** All six sections, in display order. Missing rows are empty strings. */
export function departmentNotesForWeek(
  clientId: string,
  weekStart: string
): SnapshotDepartmentNote[] {
  const rows = getDb()
    .prepare(
      `SELECT department, body FROM snapshot_department_notes
       WHERE client_id = ? AND week_start = ?`
    )
    .all(clientId, weekStart) as Array<{ department: string; body: string }>;
  const bySlug = new Map(rows.map((row) => [row.department, row.body || ""]));
  return SNAPSHOT_DEPARTMENTS.map((dept) => ({
    department: dept.slug,
    label: dept.label,
    body: bySlug.get(dept.slug) || "",
  }));
}

/** Client-facing list: filled departments only, still in display order. */
export function filledDepartmentNotes(
  clientId: string,
  weekStart: string
): SnapshotDepartmentNote[] {
  return departmentNotesForWeek(clientId, weekStart).filter((note) => note.body.trim());
}

export function saveDepartmentNote(input: {
  clientId: string;
  weekStart: string;
  department: SnapshotDepartmentSlug;
  body: string;
  loggedBy?: string;
}): SnapshotDepartmentNote {
  const db = getDb();
  const now = nowIso();
  const body = input.body;
  const existing = db
    .prepare(
      `SELECT id FROM snapshot_department_notes
       WHERE client_id = ? AND week_start = ? AND department = ?`
    )
    .get(input.clientId, input.weekStart, input.department) as { id: string } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE snapshot_department_notes
         SET body = ?, logged_by = ?, updated_at = ?
       WHERE id = ?`
    ).run(body, input.loggedBy || "", now, existing.id);
  } else {
    db.prepare(
      `INSERT INTO snapshot_department_notes
         (id, client_id, week_start, department, body, logged_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      nanoid(12),
      input.clientId,
      input.weekStart,
      input.department,
      body,
      input.loggedBy || "",
      now,
      now
    );
  }
  return {
    department: input.department,
    label: departmentLabel(input.department),
    body,
  };
}
