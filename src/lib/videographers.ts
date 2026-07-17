import { nanoid } from "nanoid";
import { getDb, nowIso, type Videographer } from "./db";

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
// on the books (any status) for a DIFFERENT client. One production/day per
// videographer, so these days are unavailable to everyone else who shares them.
export function videographerBookedDates(
  videographerId: string,
  start: string,
  end: string,
  excludeClientId?: string
): string[] {
  if (!videographerId) return [];
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT s.send_date AS d
       FROM scheduled_sends s
       JOIN rev_clients c ON c.id = s.client_id
       WHERE c.videographer_id = ?
         AND s.send_date >= ? AND s.send_date <= ?
         AND (? = '' OR s.client_id != ?)`
    )
    .all(videographerId, start, end, excludeClientId || "", excludeClientId || "") as Array<{
    d: string;
  }>;
  return rows.map((r) => r.d);
}
