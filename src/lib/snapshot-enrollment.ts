// Who is on the weekly snapshot roster.
//
// The old allowlist is only the one-time seed. After that, add and remove
// write this table. The seed runs the first time the roster is read, not
// inside getDb(), so it does not sit on the path that has to answer /api/health.

import { getDb, nowIso } from "./db";
import { isSnapshotAllowlisted } from "./snapshot-allowlist";

const SEED_KEY = "snapshot_enrollment_seeded";

function seedFlag(): string {
  const row = getDb()
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(SEED_KEY) as { value: string } | undefined;
  return row?.value || "";
}

/** Insert today's allowlisted clients once. A later remove is not undone. */
export function seedSnapshotEnrollment(): { seeded: boolean; enrolled: number } {
  if (seedFlag() === "1") return { seeded: false, enrolled: 0 };
  const db = getDb();
  const clients = db
    .prepare(`SELECT id, name FROM rev_clients`)
    .all() as Array<{ id: string; name: string }>;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO snapshot_enrollments (client_id, enrolled_at, enrolled_by)
     VALUES (?, ?, 'seed')`
  );
  const now = nowIso();
  let enrolled = 0;
  const run = db.transaction(() => {
    for (const client of clients) {
      if (!isSnapshotAllowlisted(client.name)) continue;
      const res = insert.run(client.id, now);
      enrolled += res.changes;
    }
    db.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, '1', ?)
       ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = excluded.updated_at`
    ).run(SEED_KEY, now);
  });
  run();
  return { seeded: true, enrolled };
}

export function isSnapshotEnrolled(clientId: string): boolean {
  seedSnapshotEnrollment();
  const row = getDb()
    .prepare(`SELECT client_id FROM snapshot_enrollments WHERE client_id = ?`)
    .get(clientId) as { client_id: string } | undefined;
  return Boolean(row);
}

export function enrolledClientIds(): Set<string> {
  seedSnapshotEnrollment();
  const rows = getDb()
    .prepare(`SELECT client_id FROM snapshot_enrollments`)
    .all() as Array<{ client_id: string }>;
  return new Set(rows.map((row) => row.client_id));
}

export function enrollSnapshotClient(clientId: string, enrolledBy = ""): boolean {
  seedSnapshotEnrollment();
  const client = getDb()
    .prepare(`SELECT id FROM rev_clients WHERE id = ?`)
    .get(clientId) as { id: string } | undefined;
  if (!client) return false;
  getDb()
    .prepare(
      `INSERT INTO snapshot_enrollments (client_id, enrolled_at, enrolled_by)
       VALUES (?, ?, ?)
       ON CONFLICT(client_id) DO UPDATE SET
         enrolled_at = excluded.enrolled_at,
         enrolled_by = excluded.enrolled_by`
    )
    .run(clientId, nowIso(), enrolledBy);
  return true;
}

/** Drop the roster row only. The client, their history, and pause stay. */
export function unenrollSnapshotClient(clientId: string): boolean {
  seedSnapshotEnrollment();
  const res = getDb()
    .prepare(`DELETE FROM snapshot_enrollments WHERE client_id = ?`)
    .run(clientId);
  return res.changes > 0;
}
