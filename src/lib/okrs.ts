import { nanoid } from "nanoid";
import { getDb, nowIso, type ClientOkr, type OkrKeyResult, type OkrStatus } from "./db";

export type { ClientOkr, OkrKeyResult, OkrStatus };

export const OKR_STATUSES: { value: OkrStatus; label: string }[] = [
  { value: "on_track", label: "On track" },
  { value: "at_risk", label: "At risk" },
  { value: "off_track", label: "Off track" },
  { value: "achieved", label: "Achieved" },
];
const STATUS_VALUES = OKR_STATUSES.map((s) => s.value);
function normStatus(v: unknown): OkrStatus {
  return STATUS_VALUES.includes(v as OkrStatus) ? (v as OkrStatus) : "on_track";
}

export interface Okr extends Omit<ClientOkr, "key_results"> {
  keyResults: OkrKeyResult[];
}

function parseKeyResults(json: string): OkrKeyResult[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toOkr(row: ClientOkr): Okr {
  const { key_results, ...rest } = row;
  return { ...rest, keyResults: parseKeyResults(key_results) };
}

export function listOkrs(clientId: string): Okr[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM client_okrs WHERE client_id = ? AND active = 1
       ORDER BY sort_order ASC, created_at ASC`
    )
    .all(clientId) as ClientOkr[];
  return rows.map(toOkr);
}

export function getOkr(id: string): Okr | null {
  const row = getDb().prepare(`SELECT * FROM client_okrs WHERE id = ?`).get(id) as
    | ClientOkr
    | undefined;
  return row ? toOkr(row) : null;
}

export function createOkr(
  clientId: string,
  input: {
    objective: string;
    keyResults?: OkrKeyResult[];
    targetDate?: string | null;
    status?: OkrStatus;
  }
): Okr {
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  const max = db
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM client_okrs WHERE client_id = ?`)
    .get(clientId) as { m: number };
  const keyResults = (input.keyResults || []).map((kr) => ({
    ...kr,
    id: kr.id || nanoid(8),
  }));
  db.prepare(
    `INSERT INTO client_okrs
      (id, client_id, objective, key_results, target_date, status, sort_order, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(
    id,
    clientId,
    input.objective.trim(),
    JSON.stringify(keyResults),
    input.targetDate || null,
    normStatus(input.status),
    max.m + 1,
    ts,
    ts
  );
  return getOkr(id)!;
}

export function updateOkr(
  id: string,
  updates: Partial<{
    objective: string;
    keyResults: OkrKeyResult[];
    targetDate: string | null;
    status: OkrStatus;
    sortOrder: number;
  }>
): Okr | null {
  const existing = getOkr(id);
  if (!existing) return null;
  const keyResults = updates.keyResults
    ? updates.keyResults.map((kr) => ({ ...kr, id: kr.id || nanoid(8) }))
    : existing.keyResults;
  getDb()
    .prepare(
      `UPDATE client_okrs
       SET objective = ?, key_results = ?, target_date = ?, status = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      updates.objective?.trim() ?? existing.objective,
      JSON.stringify(keyResults),
      updates.targetDate !== undefined ? updates.targetDate || null : existing.target_date,
      updates.status ? normStatus(updates.status) : existing.status,
      updates.sortOrder ?? existing.sort_order,
      nowIso(),
      id
    );
  return getOkr(id);
}

// Soft-delete so historical goals stay auditable.
export function deleteOkr(id: string): boolean {
  return getDb().prepare(`UPDATE client_okrs SET active = 0 WHERE id = ?`).run(id).changes > 0;
}
