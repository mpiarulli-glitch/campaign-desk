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

export const WEEKDAY_LABEL: Record<number, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

// The weekdays a videographer never shoots, as day numbers.
export function unavailableWeekdays(videographer: Videographer): number[] {
  return (
    (videographer.unavailable_weekdays || "")
      .split(",")
      .map((part) => part.trim())
      // Empty segments have to go before Number(), because Number("") is 0,
      // which is a valid weekday. Without this every videographer with no days
      // off parsed as unavailable on Sundays.
      .filter((part) => part !== "")
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
  );
}

export function formatUnavailableWeekdays(videographer: Videographer): string {
  const days = unavailableWeekdays(videographer);
  if (!days.length) return "Every weekday";
  return `No ${days.sort().map((d) => WEEKDAY_LABEL[d]).join(", ")}`;
}

// Dates in [start, end] that fall on one of a videographer's standing days off.
//
// Read in UTC, the same way every other date in the scheduler is built, so this
// cannot drift by a day against the window arithmetic.
export function videographerOffDates(
  videographerId: string,
  start: string,
  end: string
): string[] {
  if (!videographerId) return [];
  const videographer = getDb()
    .prepare(`SELECT * FROM videographers WHERE id = ?`)
    .get(videographerId) as Videographer | undefined;
  if (!videographer) return [];
  const days = unavailableWeekdays(videographer);
  if (!days.length) return [];

  const out: string[] = [];
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  let cursor = Date.UTC(sy, sm - 1, sd);
  const last = Date.UTC(ey, em - 1, ed);
  while (cursor <= last) {
    const day = new Date(cursor);
    if (days.includes(day.getUTCDay())) {
      out.push(day.toISOString().slice(0, 10));
    }
    cursor += 86_400_000;
  }
  return out;
}

export function updateVideographer(
  id: string,
  updates: { name?: string; active?: boolean; unavailableWeekdays?: number[] }
): Videographer | null {
  const existing = getDb()
    .prepare(`SELECT * FROM videographers WHERE id = ?`)
    .get(id) as Videographer | undefined;
  if (!existing) return null;
  getDb()
    .prepare(
      `UPDATE videographers
       SET name = ?, active = ?, unavailable_weekdays = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      updates.name?.trim() ?? existing.name,
      updates.active === undefined ? existing.active : updates.active ? 1 : 0,
      updates.unavailableWeekdays === undefined
        ? existing.unavailable_weekdays
        : [...new Set(updates.unavailableWeekdays)]
            .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
            .sort()
            .join(","),
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
         AND s.production_brief != ''
         AND s.send_date >= ? AND s.send_date <= ?`
    )
    .all(videographerId, start, end) as Array<{
    d: string;
  }>;
  return rows.map((r) => r.d);
}
