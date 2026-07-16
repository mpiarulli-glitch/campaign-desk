import { nanoid } from "nanoid";
import {
  getDb,
  nowIso,
  type RevClient,
  type SnapshotDeliverable,
  type SnapshotMetric,
  type SnapshotStatus,
  type SnapshotWin,
} from "./db";

export type { SnapshotDeliverable, SnapshotStatus, SnapshotWin, SnapshotMetric };

export const SNAPSHOT_STATUSES: { value: SnapshotStatus; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "shared", label: "Shared — awaiting approval" },
  { value: "approved", label: "Approved" },
];
const STATUS_VALUES = SNAPSHOT_STATUSES.map((s) => s.value);
function normStatus(v: unknown): SnapshotStatus {
  return STATUS_VALUES.includes(v as SnapshotStatus)
    ? (v as SnapshotStatus)
    : "not_started";
}

/* ------------------------------------------------------------ accounts */

export interface SnapshotAccount extends RevClient {
  deliverable_count: number;
}

export function listAccounts(): SnapshotAccount[] {
  return getDb()
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM snapshot_deliverables d
          WHERE d.client_id = c.id AND d.active = 1) AS deliverable_count
       FROM rev_clients c
       WHERE c.active = 1
       ORDER BY c.name COLLATE NOCASE`
    )
    .all() as SnapshotAccount[];
}

export function getAccount(id: string): RevClient | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM rev_clients WHERE id = ?`)
      .get(id) as RevClient | undefined) || null
  );
}

export function createAccount(name: string): RevClient {
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  db.prepare(
    `INSERT INTO rev_clients
      (id, name, business_model, retainer, monthly_cost, active, created_at, updated_at)
     VALUES (?, ?, 'home_service', 0, 0, 1, ?, ?)`
  ).run(id, name.trim(), ts, ts);
  return getAccount(id)!;
}

// Returns the account's share token, creating one on first request.
export function getOrCreateToken(id: string): string | null {
  const acct = getAccount(id);
  if (!acct) return null;
  if (acct.snapshot_token) return acct.snapshot_token;
  const token = nanoid(24);
  getDb()
    .prepare(`UPDATE rev_clients SET snapshot_token = ? WHERE id = ?`)
    .run(token, id);
  return token;
}

export function rotateToken(id: string): string | null {
  if (!getAccount(id)) return null;
  const token = nanoid(24);
  getDb()
    .prepare(`UPDATE rev_clients SET snapshot_token = ? WHERE id = ?`)
    .run(token, id);
  return token;
}

export function getAccountByToken(token: string): RevClient | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM rev_clients WHERE snapshot_token = ?`)
      .get(token) as RevClient | undefined) || null
  );
}

/* -------------------------------------------------------- deliverables */

export function listDeliverables(clientId: string): SnapshotDeliverable[] {
  return getDb()
    .prepare(
      `SELECT * FROM snapshot_deliverables
       WHERE client_id = ? AND active = 1
       ORDER BY sort_order ASC, created_at ASC`
    )
    .all(clientId) as SnapshotDeliverable[];
}

export function createDeliverable(input: {
  clientId: string;
  category: string;
  name: string;
  cadence: string;
}): SnapshotDeliverable {
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  const max = db
    .prepare(
      `SELECT COALESCE(MAX(sort_order), -1) AS m FROM snapshot_deliverables WHERE client_id = ?`
    )
    .get(input.clientId) as { m: number };
  db.prepare(
    `INSERT INTO snapshot_deliverables
      (id, client_id, category, name, cadence, sort_order, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(
    id,
    input.clientId,
    input.category.trim(),
    input.name.trim(),
    input.cadence.trim(),
    max.m + 1,
    ts,
    ts
  );
  return db
    .prepare(`SELECT * FROM snapshot_deliverables WHERE id = ?`)
    .get(id) as SnapshotDeliverable;
}

export function getDeliverable(id: string): SnapshotDeliverable | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM snapshot_deliverables WHERE id = ?`)
      .get(id) as SnapshotDeliverable | undefined) || null
  );
}

export function updateDeliverable(
  id: string,
  updates: Partial<{ category: string; name: string; cadence: string; sortOrder: number }>
): SnapshotDeliverable | null {
  const existing = getDeliverable(id);
  if (!existing) return null;
  getDb()
    .prepare(
      `UPDATE snapshot_deliverables
       SET category = ?, name = ?, cadence = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      updates.category?.trim() ?? existing.category,
      updates.name?.trim() ?? existing.name,
      updates.cadence?.trim() ?? existing.cadence,
      updates.sortOrder ?? existing.sort_order,
      nowIso(),
      id
    );
  return getDeliverable(id);
}

// Soft-delete so historical entries stay intact.
export function deleteDeliverable(id: string): boolean {
  return (
    getDb()
      .prepare(`UPDATE snapshot_deliverables SET active = 0 WHERE id = ?`)
      .run(id).changes > 0
  );
}

/* ------------------------------------------------------------- entries */

// A deliverable joined with its entry for a specific week (defaults when the
// team hasn't logged anything yet).
export interface WeekRow {
  deliverable_id: string;
  category: string;
  name: string;
  cadence: string;
  status: SnapshotStatus;
  work_done: string;
  next_steps: string;
  notes: string;
}

export function weekData(clientId: string, weekStart: string): WeekRow[] {
  const rows = getDb()
    .prepare(
      `SELECT d.id AS deliverable_id, d.category, d.name, d.cadence,
              e.status, e.work_done, e.next_steps, e.notes
       FROM snapshot_deliverables d
       LEFT JOIN snapshot_entries e
         ON e.deliverable_id = d.id AND e.week_start = ?
       WHERE d.client_id = ? AND d.active = 1
       ORDER BY d.sort_order ASC, d.created_at ASC`
    )
    .all(weekStart, clientId) as Array<{
    deliverable_id: string;
    category: string;
    name: string;
    cadence: string;
    status: SnapshotStatus | null;
    work_done: string | null;
    next_steps: string | null;
    notes: string | null;
  }>;

  return rows.map((r) => ({
    deliverable_id: r.deliverable_id,
    category: r.category,
    name: r.name,
    cadence: r.cadence,
    status: r.status ?? "not_started",
    work_done: r.work_done ?? "",
    next_steps: r.next_steps ?? "",
    notes: r.notes ?? "",
  }));
}

export function upsertEntry(input: {
  deliverableId: string;
  weekStart: string;
  status?: SnapshotStatus;
  workDone?: string;
  nextSteps?: string;
  notes?: string;
}): SnapshotEntryResult {
  const deliverable = getDeliverable(input.deliverableId);
  if (!deliverable) return { ok: false };
  const db = getDb();
  const ts = nowIso();
  const existing = db
    .prepare(
      `SELECT * FROM snapshot_entries WHERE deliverable_id = ? AND week_start = ?`
    )
    .get(input.deliverableId, input.weekStart) as
    | { id: string; status: SnapshotStatus; work_done: string; next_steps: string; notes: string }
    | undefined;

  const merged = {
    status: normStatus(input.status ?? existing?.status ?? "not_started"),
    work_done: input.workDone ?? existing?.work_done ?? "",
    next_steps: input.nextSteps ?? existing?.next_steps ?? "",
    notes: input.notes ?? existing?.notes ?? "",
  };

  if (existing) {
    db.prepare(
      `UPDATE snapshot_entries
       SET status = ?, work_done = ?, next_steps = ?, notes = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      merged.status,
      merged.work_done,
      merged.next_steps,
      merged.notes,
      ts,
      existing.id
    );
  } else {
    db.prepare(
      `INSERT INTO snapshot_entries
        (id, deliverable_id, client_id, week_start, status, work_done, next_steps, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      nanoid(12),
      input.deliverableId,
      deliverable.client_id,
      input.weekStart,
      merged.status,
      merged.work_done,
      merged.next_steps,
      merged.notes,
      ts,
      ts
    );
  }
  return { ok: true, clientId: deliverable.client_id };
}

interface SnapshotEntryResult {
  ok: boolean;
  clientId?: string;
}

/* --------------------------------------------------------------- wins */

export function listWins(clientId: string): SnapshotWin[] {
  return getDb()
    .prepare(
      `SELECT * FROM snapshot_wins WHERE client_id = ?
       ORDER BY (happened_on = '') ASC, happened_on DESC, created_at DESC`
    )
    .all(clientId) as SnapshotWin[];
}

export function addWin(input: {
  clientId: string;
  body: string;
  happenedOn?: string;
}): SnapshotWin {
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  db.prepare(
    `INSERT INTO snapshot_wins (id, client_id, body, happened_on, sort_order, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`
  ).run(id, input.clientId, input.body.trim(), (input.happenedOn || "").trim(), ts);
  return db.prepare(`SELECT * FROM snapshot_wins WHERE id = ?`).get(id) as SnapshotWin;
}

export function deleteWin(id: string): boolean {
  return getDb().prepare(`DELETE FROM snapshot_wins WHERE id = ?`).run(id).changes > 0;
}

/* ------------------------------------------------------- performance */

export interface MetricSeries {
  metric: string;
  unit: string;
  points: { period: string; value: number }[];
}

// All metric data points for an account, grouped into ordered series.
export function metricsSeries(clientId: string): MetricSeries[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM snapshot_metrics WHERE client_id = ?
       ORDER BY sort_order ASC, metric ASC, period ASC`
    )
    .all(clientId) as SnapshotMetric[];
  const map = new Map<string, MetricSeries>();
  for (const r of rows) {
    let s = map.get(r.metric);
    if (!s) {
      s = { metric: r.metric, unit: r.unit, points: [] };
      map.set(r.metric, s);
    }
    if (r.unit && !s.unit) s.unit = r.unit;
    s.points.push({ period: r.period, value: r.value });
  }
  for (const s of map.values()) s.points.sort((a, b) => a.period.localeCompare(b.period));
  return Array.from(map.values());
}

export function upsertMetric(input: {
  clientId: string;
  metric: string;
  period: string;
  value: number;
  unit?: string;
  sortOrder?: number;
}): SnapshotMetric {
  const db = getDb();
  const ts = nowIso();
  const existing = db
    .prepare(`SELECT * FROM snapshot_metrics WHERE client_id = ? AND metric = ? AND period = ?`)
    .get(input.clientId, input.metric.trim(), input.period.trim()) as
    | SnapshotMetric
    | undefined;
  if (existing) {
    db.prepare(
      `UPDATE snapshot_metrics SET value = ?, unit = ?, sort_order = ?, updated_at = ? WHERE id = ?`
    ).run(
      input.value,
      input.unit ?? existing.unit,
      input.sortOrder ?? existing.sort_order,
      ts,
      existing.id
    );
    return db.prepare(`SELECT * FROM snapshot_metrics WHERE id = ?`).get(existing.id) as SnapshotMetric;
  }
  const id = nanoid(12);
  db.prepare(
    `INSERT INTO snapshot_metrics
      (id, client_id, metric, period, value, unit, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.clientId,
    input.metric.trim(),
    input.period.trim(),
    input.value,
    (input.unit || "").trim(),
    input.sortOrder ?? 0,
    ts,
    ts
  );
  return db.prepare(`SELECT * FROM snapshot_metrics WHERE id = ?`).get(id) as SnapshotMetric;
}

export function deleteMetric(id: string): boolean {
  return getDb().prepare(`DELETE FROM snapshot_metrics WHERE id = ?`).run(id).changes > 0;
}

// Raw metric rows (with ids) for team-side management.
export function listMetricsRaw(clientId: string): SnapshotMetric[] {
  return getDb()
    .prepare(
      `SELECT * FROM snapshot_metrics WHERE client_id = ?
       ORDER BY metric ASC, period ASC`
    )
    .all(clientId) as SnapshotMetric[];
}

// weeks that have any logged activity, for the client-facing week picker.
export function weeksWithActivity(clientId: string): string[] {
  return (
    getDb()
      .prepare(
        `SELECT DISTINCT week_start FROM snapshot_entries WHERE client_id = ? ORDER BY week_start ASC`
      )
      .all(clientId) as Array<{ week_start: string }>
  ).map((r) => r.week_start);
}
