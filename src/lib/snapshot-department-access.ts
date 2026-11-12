// Who sees which weekly-snapshot department on the team desk.
//
// The owner and anyone who can send the Friday snapshot (canSeeFridayAsk)
// see every section. So does a person with no department stored, so an
// unset account can still fill the snapshot. Everyone else sees the
// departments saved for them on Access.
//
// PERSON_TEAM in ./people is a different list. It scopes deliverable rows,
// and it is not edited from Access.

import { getDb, nowIso } from "./db";
import { canSeeFridayAsk } from "./people";
import {
  SNAPSHOT_DEPARTMENTS,
  isSnapshotDepartment,
  type SnapshotDepartmentSlug,
} from "./snapshot-department-list";

export type SnapshotDepartmentViewer = {
  role: "admin" | "forecast" | null;
  person: string | null;
  owner: boolean;
};

export function assignedSnapshotDepartments(
  person: string | null
): SnapshotDepartmentSlug[] {
  if (!person) return [];
  const rows = getDb()
    .prepare(
      `SELECT department FROM user_snapshot_departments WHERE person = ?`
    )
    .all(person) as Array<{ department: string }>;
  const order = new Map(SNAPSHOT_DEPARTMENTS.map((dept, index) => [dept.slug, index]));
  return rows
    .map((row) => row.department)
    .filter(isSnapshotDepartment)
    .sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
}

/** Friday-send people, and anyone with no department rows, see every section. */
export function seesEverySnapshotDepartment(who: SnapshotDepartmentViewer): boolean {
  if (canSeeFridayAsk({ person: who.person, owner: who.owner })) return true;
  if (!who.person) return true;
  return assignedSnapshotDepartments(who.person).length === 0;
}

/**
 * Null means every department. A list is the sections this person may see
 * and edit. Existing rows in other departments stay in the database.
 */
export function visibleSnapshotDepartments(
  who: SnapshotDepartmentViewer
): SnapshotDepartmentSlug[] | null {
  if (seesEverySnapshotDepartment(who)) return null;
  return assignedSnapshotDepartments(who.person);
}

export function canWriteSnapshotDepartment(
  who: SnapshotDepartmentViewer,
  department: string
): boolean {
  const visible = visibleSnapshotDepartments(who);
  if (!visible) return true;
  return isSnapshotDepartment(department) && visible.includes(department);
}

export function filterDepartmentNotesForViewer<T extends { department: string }>(
  notes: T[],
  who: SnapshotDepartmentViewer
): T[] {
  const visible = visibleSnapshotDepartments(who);
  if (!visible) return notes;
  const allow = new Set<string>(visible);
  return notes.filter((note) => allow.has(note.department));
}

/** Replace this person's departments. An empty list puts them back on every section. */
export function setSnapshotDepartments(
  person: string,
  departments: readonly string[],
  by: string
): SnapshotDepartmentSlug[] {
  const unique: SnapshotDepartmentSlug[] = [];
  for (const department of departments) {
    if (!isSnapshotDepartment(department)) {
      throw new Error("Pick a department from the weekly snapshot list.");
    }
    if (!unique.includes(department)) unique.push(department);
  }
  const db = getDb();
  const now = nowIso();
  const run = db.transaction(() => {
    db.prepare(`DELETE FROM user_snapshot_departments WHERE person = ?`).run(person);
    const insert = db.prepare(
      `INSERT INTO user_snapshot_departments (person, department, updated_at, updated_by)
       VALUES (?, ?, ?, ?)`
    );
    for (const department of unique) insert.run(person, department, now, by);
  });
  run();
  return assignedSnapshotDepartments(person);
}

export function usersWithoutSnapshotDepartment(): Array<{
  slug: string;
  label: string;
  role: string;
}> {
  const rows = getDb()
    .prepare(
      `SELECT slug, label, role FROM users ORDER BY label COLLATE NOCASE, slug`
    )
    .all() as Array<{ slug: string; label: string; role: string }>;
  return rows.filter((row) => assignedSnapshotDepartments(row.slug).length === 0);
}
