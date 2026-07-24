import { nanoid } from "nanoid";
import { getDb, nowIso, type ClientFlag, type FlagLevel } from "./db";

export type { ClientFlag, FlagLevel };

const LEVELS: FlagLevel[] = ["red", "yellow", "green"];
export function normLevel(v: unknown): FlagLevel {
  return LEVELS.includes(v as FlagLevel) ? (v as FlagLevel) : "yellow";
}

// Worst-first ordering so a client's status is the most severe active flag.
const SEVERITY: Record<FlagLevel, number> = { red: 0, yellow: 1, green: 2 };

export function listFlags(clientId: string, opts?: { activeOnly?: boolean }): ClientFlag[] {
  const where = opts?.activeOnly ? "AND resolved = 0" : "";
  return getDb()
    .prepare(
      `SELECT * FROM client_flags WHERE client_id = ? ${where}
       ORDER BY resolved ASC,
         CASE level WHEN 'red' THEN 0 WHEN 'yellow' THEN 1 ELSE 2 END ASC,
         created_at DESC`
    )
    .all(clientId) as ClientFlag[];
}

export function createFlag(input: {
  clientId: string;
  level: FlagLevel;
  note?: string;
  createdBy?: string;
}): ClientFlag {
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  db.prepare(
    `INSERT INTO client_flags (id, client_id, level, note, created_by, resolved, resolved_by, resolved_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, '', NULL, ?, ?)`
  ).run(id, input.clientId, normLevel(input.level), (input.note || "").trim(), input.createdBy || "", ts, ts);
  return db.prepare(`SELECT * FROM client_flags WHERE id = ?`).get(id) as ClientFlag;
}

export function resolveFlag(id: string, resolvedBy: string): ClientFlag | null {
  const existing = getDb().prepare(`SELECT * FROM client_flags WHERE id = ?`).get(id) as ClientFlag | undefined;
  if (!existing) return null;
  const ts = nowIso();
  getDb()
    .prepare(`UPDATE client_flags SET resolved = 1, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?`)
    .run(resolvedBy || "", ts, ts, id);
  return getDb().prepare(`SELECT * FROM client_flags WHERE id = ?`).get(id) as ClientFlag;
}

export function reopenFlag(id: string): ClientFlag | null {
  const existing = getDb().prepare(`SELECT * FROM client_flags WHERE id = ?`).get(id) as ClientFlag | undefined;
  if (!existing) return null;
  getDb()
    .prepare(`UPDATE client_flags SET resolved = 0, resolved_by = '', resolved_at = NULL, updated_at = ? WHERE id = ?`)
    .run(nowIso(), id);
  return getDb().prepare(`SELECT * FROM client_flags WHERE id = ?`).get(id) as ClientFlag;
}

export function deleteFlag(id: string): boolean {
  return getDb().prepare(`DELETE FROM client_flags WHERE id = ?`).run(id).changes > 0;
}

// The single live status for a client = its most severe active flag, or null.
export function clientFlagStatus(clientId: string): FlagLevel | null {
  const row = getDb()
    .prepare(`SELECT level FROM client_flags WHERE client_id = ? AND resolved = 0`)
    .all(clientId) as Array<{ level: FlagLevel }>;
  if (!row.length) return null;
  return row.map((r) => r.level).sort((a, b) => SEVERITY[a] - SEVERITY[b])[0];
}

// Active-flag summary per client, worst-first, for the agency roll-up.
export interface FlagSummary {
  clientId: string;
  status: FlagLevel;
  counts: { red: number; yellow: number; green: number };
}
export function activeFlagSummary(): Record<string, FlagSummary> {
  const rows = getDb()
    .prepare(`SELECT client_id, level FROM client_flags WHERE resolved = 0`)
    .all() as Array<{ client_id: string; level: FlagLevel }>;
  const map: Record<string, FlagSummary> = {};
  for (const r of rows) {
    const s = (map[r.client_id] ??= {
      clientId: r.client_id,
      status: r.level,
      counts: { red: 0, yellow: 0, green: 0 },
    });
    s.counts[r.level] += 1;
    if (SEVERITY[r.level] < SEVERITY[s.status]) s.status = r.level;
  }
  return map;
}
