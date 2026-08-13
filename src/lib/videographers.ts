import { nanoid } from "nanoid";
import { getDb, nowIso, type Videographer } from "./db";
import { hasProductionBriefSql } from "./production-brief";

export type { Videographer };

export function listVideographers(includeInactive = false): Videographer[] {
  const where = includeInactive ? "" : "WHERE active = 1";
  return getDb()
    .prepare(`SELECT * FROM videographers ${where} ORDER BY name COLLATE NOCASE ASC`)
    .all() as Videographer[];
}

export function createVideographer(name: string): Videographer {
  const id = nanoid(12);
  const ts = nowIso();
  getDb()
    .prepare(
      `INSERT INTO videographers (id, name, active, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?)`
    )
    .run(id, name.trim(), ts, ts);
  return getDb()
    .prepare(`SELECT * FROM videographers WHERE id = ?`)
    .get(id) as Videographer;
}

export function updateVideographer(
  id: string,
  updates: { name?: string; active?: boolean }
): Videographer | null {
  const existing = getDb()
    .prepare(`SELECT * FROM videographers WHERE id = ?`)
    .get(id) as Videographer | undefined;
  if (!existing) return null;
  getDb()
    .prepare(`UPDATE videographers SET name = ?, active = ?, updated_at = ? WHERE id = ?`)
    .run(
      updates.name?.trim() ?? existing.name,
      updates.active === undefined ? existing.active : updates.active ? 1 : 0,
      nowIso(),
      id
    );
  return getDb()
    .prepare(`SELECT * FROM videographers WHERE id = ?`)
    .get(id) as Videographer;
}

// Dates in [start, end] where the given videographer already has a production
// on the books (any status). One production/day per videographer, so these
// dates are unavailable even when the other production belongs to the same
// client under a different cadence window.
export function videographerBookedDates(
  videographerId: string,
  start: string,
  end: string
): string[] {
  if (!videographerId) return [];
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT s.send_date AS d
       FROM scheduled_sends s
       JOIN rev_clients c ON c.id = s.client_id
       WHERE c.videographer_id = ?
         AND ${hasProductionBriefSql("s")}
         AND s.send_date >= ? AND s.send_date <= ?`
    )
    .all(videographerId, start, end) as Array<{
    d: string;
  }>;
  return rows.map((r) => r.d);
}
