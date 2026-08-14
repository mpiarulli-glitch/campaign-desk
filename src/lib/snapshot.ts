import { nanoid } from "nanoid";
import { isTeam } from "./people";
import {
  getDb,
  nowIso,
  type CadenceUnit,
  type DeliverableKind,
  type LeadConverted,
  type LeadSource,
  type RevClient,
  type SnapshotDeliverable,
  type SnapshotLead,
  type SnapshotMetric,
  type SnapshotRevenueReport,
  type SnapshotStatus,
  type SnapshotWin,
} from "./db";
import { addWeeks, mondayOf } from "./week";
import { metricPeriodLabel, normalizeMetricPeriod } from "./metric-period";

export type {
  CadenceUnit,
  DeliverableKind,
  LeadConverted,
  LeadSource,
  SnapshotDeliverable,
  SnapshotLead,
  SnapshotRevenueReport,
  SnapshotStatus,
  SnapshotWin,
  SnapshotMetric,
};

// Re-exported so server code reaching for snapshot helpers finds these here too.
// They live in ./metric-period because they are pure, and a client component that
// needs to format a period must not pull better-sqlite3 in behind it.
export { metricPeriodLabel, normalizeMetricPeriod };

function normKind(v: unknown): DeliverableKind {
  return v === "one_time" ? "one_time" : "recurring";
}

const CADENCE_UNITS: CadenceUnit[] = ["weekly", "monthly", "quarterly"];
function normCadenceUnit(v: unknown): CadenceUnit {
  return CADENCE_UNITS.includes(v as CadenceUnit) ? (v as CadenceUnit) : "monthly";
}

export const CADENCE_UNIT_OPTIONS: { value: CadenceUnit; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
];

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The period key a given date rolls up to for a cadence unit: the Monday for
// weekly, the 1st of the month for monthly, the 1st month of the quarter for
// quarterly. Two dates in the same period always map to the same key, so a
// deliverable's status only changes when a NEW period actually starts.
export function periodStartFor(unit: CadenceUnit, ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  if (unit === "weekly") {
    const [yy, mm, dd] = ymd.split("-").map(Number);
    return mondayOf(new Date(yy, mm - 1, dd));
  }
  if (unit === "quarterly") {
    const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
    return `${y}-${String(qStartMonth).padStart(2, "0")}-01`;
  }
  return `${y}-${String(m).padStart(2, "0")}-01`; // monthly
}

// Exclusive end of the period containing ymd (first key of the NEXT period).
function periodEndExclusiveFor(unit: CadenceUnit, ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  if (unit === "weekly") return addWeeks(periodStartFor("weekly", ymd), 1);
  if (unit === "quarterly") {
    const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
    const nextQStartMonth = qStartMonth + 3;
    return nextQStartMonth > 12
      ? `${y + 1}-01-01`
      : `${y}-${String(nextQStartMonth).padStart(2, "0")}-01`;
  }
  return m + 1 > 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`; // monthly
}

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

// Accounts are created via the same flow as revenue clients
// (createRevClient in ./revenue) — there is only one "add client" form.

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

/**
 * A client's active deliverables.
 *
 * `team` narrows the list to what that team owns, which is how the weekly
 * snapshot shows someone their own portion. Untagged deliverables (team = '')
 * are always included: an unassigned row should be visible to everyone rather
 * than to nobody. Pass no team to see all of them, which is what admins and the
 * owner get.
 */
export function listDeliverables(
  clientId: string,
  opts?: { team?: string | null }
): SnapshotDeliverable[] {
  const team = opts?.team;
  const filter = team ? "AND (team = ? OR team = '')" : "";
  const params = team ? [clientId, team] : [clientId];
  return getDb()
    .prepare(
      `SELECT * FROM snapshot_deliverables
       WHERE client_id = ? AND active = 1 ${filter}
       ORDER BY sort_order ASC, created_at ASC`
    )
    .all(...params) as SnapshotDeliverable[];
}

export function createDeliverable(input: {
  clientId: string;
  category: string;
  name: string;
  cadence: string;
  kind?: DeliverableKind;
  cadenceUnit?: CadenceUnit;
  dueDate?: string | null;
  team?: string;
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
      (id, client_id, category, team, name, cadence, kind, cadence_unit, due_date, sort_order, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(
    id,
    input.clientId,
    input.category.trim(),
    isTeam(input.team) ? input.team : "",
    input.name.trim(),
    input.cadence.trim(),
    normKind(input.kind),
    normCadenceUnit(input.cadenceUnit),
    input.dueDate || null,
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
  updates: Partial<{
    category: string;
    name: string;
    cadence: string;
    kind: DeliverableKind;
    cadenceUnit: CadenceUnit;
    dueDate: string | null;
    sortOrder: number;
    team: string;
  }>
): SnapshotDeliverable | null {
  const existing = getDeliverable(id);
  if (!existing) return null;
  getDb()
    .prepare(
      `UPDATE snapshot_deliverables
       SET category = ?, team = ?, name = ?, cadence = ?, kind = ?, cadence_unit = ?, due_date = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      updates.category?.trim() ?? existing.category,
      // An explicit "" clears the tag, so undefined is the only "leave alone".
      updates.team === undefined
        ? existing.team
        : isTeam(updates.team)
          ? updates.team
          : "",
      updates.name?.trim() ?? existing.name,
      updates.cadence?.trim() ?? existing.cadence,
      updates.kind ? normKind(updates.kind) : existing.kind,
      updates.cadenceUnit ? normCadenceUnit(updates.cadenceUnit) : existing.cadence_unit,
      updates.dueDate !== undefined ? updates.dueDate || null : existing.due_date,
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

// A deliverable joined with its entry for the period the given week falls
// in (defaults when the team hasn't logged anything for that period yet).
// For a monthly/quarterly deliverable, every week inside the same period
// resolves to the same underlying entry — flipping weeks doesn't reset it,
// and it only goes back to "not started" once a new period actually starts.
// One-time deliverables aren't period-keyed at all: whatever was last logged
// for them (any week) carries forward forever, same as the overview.
export interface WeekRow {
  deliverable_id: string;
  category: string;
  name: string;
  cadence: string;
  kind: DeliverableKind;
  cadence_unit: CadenceUnit;
  period_start: string;
  status: SnapshotStatus;
  work_done: string;
  next_steps: string;
  notes: string;
  // Who last logged this and when. Both empty for a period nobody has touched.
  // Team-side only: the client-facing page never shows internal names.
  logged_by: string;
  updated_at: string;
}

// Existing entries predate cadence_unit and are keyed by whichever literal
// Monday the team happened to be viewing — not necessarily a period-aligned
// date. Rather than rewrite that history, reads are range-based: "the latest
// entry logged anywhere inside this period" stands in for an exact-key match,
// so nothing pre-existing gets silently dropped or needs migrating.
//
// `team` scopes the rows the same way listDeliverables does, so the grid a person
// fills in matches the deliverable list they are allowed to manage. Without it
// the two disagreed: the editor showed every team's work while "Edit
// deliverables" showed only their own.
export function weekData(
  clientId: string,
  weekStart: string,
  opts?: { team?: string | null }
): WeekRow[] {
  const team = opts?.team;
  const teamFilter = team ? "AND (team = ? OR team = '')" : "";
  const teamParams = team ? [clientId, team] : [clientId];
  const deliverables = getDb()
    .prepare(
      `SELECT id, category, name, cadence, kind, cadence_unit
       FROM snapshot_deliverables
       WHERE client_id = ? AND active = 1 ${teamFilter}
       ORDER BY sort_order ASC, created_at ASC`
    )
    .all(...teamParams) as Array<{
    id: string;
    category: string;
    name: string;
    cadence: string;
    kind: string;
    cadence_unit: string;
  }>;
  if (!deliverables.length) return [];

  const FIELDS = `status, work_done, next_steps, notes, logged_by, updated_at`;
  const exactStmt = getDb().prepare(
    `SELECT ${FIELDS} FROM snapshot_entries
     WHERE deliverable_id = ? AND week_start = ?`
  );
  // Ordered by when it was last written, not by which week it is filed under.
  // For a monthly item every week in the month shows the same entry, and the one
  // to show is the team's most recent edit — ordering by week_start meant an
  // update made while viewing an earlier week in the period was invisible.
  const rangeStmt = getDb().prepare(
    `SELECT ${FIELDS} FROM snapshot_entries
     WHERE deliverable_id = ? AND week_start >= ? AND week_start < ?
     ORDER BY updated_at DESC, week_start DESC LIMIT 1`
  );
  const latestEverStmt = getDb().prepare(
    `SELECT ${FIELDS} FROM snapshot_entries
     WHERE deliverable_id = ? ORDER BY week_start DESC LIMIT 1`
  );

  type EntryFields = {
    status: SnapshotStatus;
    work_done: string;
    next_steps: string;
    notes: string;
    logged_by: string;
    updated_at: string;
  };

  return deliverables.map((d) => {
    const kind = normKind(d.kind);
    const cadence_unit = normCadenceUnit(d.cadence_unit);
    let e: EntryFields | undefined;
    let period_start = "";

    if (kind === "one_time") {
      e = latestEverStmt.get(d.id) as EntryFields | undefined;
    } else if (cadence_unit === "weekly") {
      period_start = weekStart;
      e = exactStmt.get(d.id, weekStart) as EntryFields | undefined;
    } else {
      period_start = periodStartFor(cadence_unit, weekStart);
      const end = periodEndExclusiveFor(cadence_unit, weekStart);
      e = rangeStmt.get(d.id, period_start, end) as EntryFields | undefined;
    }

    return {
      deliverable_id: d.id,
      category: d.category,
      name: d.name,
      cadence: d.cadence,
      kind,
      cadence_unit,
      period_start,
      status: e?.status ?? "not_started",
      work_done: e?.work_done ?? "",
      next_steps: e?.next_steps ?? "",
      notes: e?.notes ?? "",
      logged_by: e?.logged_by ?? "",
      updated_at: e?.updated_at ?? "",
    };
  });
}

export function upsertEntry(input: {
  deliverableId: string;
  weekStart: string;
  status?: SnapshotStatus;
  workDone?: string;
  nextSteps?: string;
  notes?: string;
  /**
   * Actor tag from sessionActor. Undefined leaves whoever is already on the row,
   * which matters because the admin page saves one field at a time: a blur that
   * only changes "Next steps" must not blank out the author of the rest.
   */
  loggedBy?: string;
}): SnapshotEntryResult {
  const deliverable = getDeliverable(input.deliverableId);
  if (!deliverable) return { ok: false };
  const db = getDb();
  const ts = nowIso();

  // A write lands on the same key the read resolves to, which is what makes
  // editing idempotent:
  //
  //   - One-time items have a single lifetime entry, so whichever entry exists
  //     (any week) is the one updated.
  //   - Monthly and quarterly items have one entry per PERIOD. The existing entry
  //     is looked up across the whole period and a new one is filed under the
  //     period's start. Writing to the literal week being viewed instead meant a
  //     month could accumulate four rows, and an edit made from week 1 lost to
  //     the row already sitting at week 3.
  //   - Weekly items are one entry per week, which is already the same thing.
  const kind = normKind(deliverable.kind);
  const unit = normCadenceUnit(deliverable.cadence_unit);
  const isOneTime = kind === "one_time";
  const periodKeyed = !isOneTime && unit !== "weekly";
  const writeKey = periodKeyed ? periodStartFor(unit, input.weekStart) : input.weekStart;

  const existing = (
    isOneTime
      ? db
          .prepare(
            `SELECT * FROM snapshot_entries WHERE deliverable_id = ? ORDER BY week_start DESC LIMIT 1`
          )
          .get(input.deliverableId)
      : periodKeyed
        ? db
            .prepare(
              `SELECT * FROM snapshot_entries
               WHERE deliverable_id = ? AND week_start >= ? AND week_start < ?
               ORDER BY updated_at DESC, week_start DESC LIMIT 1`
            )
            .get(
              input.deliverableId,
              periodStartFor(unit, input.weekStart),
              periodEndExclusiveFor(unit, input.weekStart)
            )
        : db
            .prepare(
              `SELECT * FROM snapshot_entries WHERE deliverable_id = ? AND week_start = ?`
            )
            .get(input.deliverableId, writeKey)
  ) as
    | {
        id: string;
        status: SnapshotStatus;
        work_done: string;
        next_steps: string;
        notes: string;
        logged_by: string;
      }
    | undefined;

  const merged = {
    status: normStatus(input.status ?? existing?.status ?? "not_started"),
    work_done: input.workDone ?? existing?.work_done ?? "",
    next_steps: input.nextSteps ?? existing?.next_steps ?? "",
    notes: input.notes ?? existing?.notes ?? "",
    // The last person to touch the row owns it. An undefined loggedBy is a caller
    // with no session (a seed script), which must not erase a real name.
    logged_by: input.loggedBy ?? existing?.logged_by ?? "",
  };

  if (existing) {
    db.prepare(
      `UPDATE snapshot_entries
       SET status = ?, work_done = ?, next_steps = ?, notes = ?, logged_by = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      merged.status,
      merged.work_done,
      merged.next_steps,
      merged.notes,
      merged.logged_by,
      ts,
      existing.id
    );
  } else {
    db.prepare(
      `INSERT INTO snapshot_entries
        (id, deliverable_id, client_id, week_start, status, work_done, next_steps, notes, logged_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      nanoid(12),
      input.deliverableId,
      deliverable.client_id,
      writeKey,
      merged.status,
      merged.work_done,
      merged.next_steps,
      merged.notes,
      merged.logged_by,
      ts,
      ts
    );
  }
  return {
    ok: true,
    clientId: deliverable.client_id,
    loggedBy: merged.logged_by,
    updatedAt: ts,
  };
}

interface SnapshotEntryResult {
  ok: boolean;
  clientId?: string;
  /** Actor tag now on the row, so a caller can reflect it without re-reading. */
  loggedBy?: string;
  updatedAt?: string;
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

/* --------------------------------------------------------------- leads */

const LEAD_SOURCES: LeadSource[] = ["form", "call", "other"];
function normSource(v: unknown): LeadSource {
  return LEAD_SOURCES.includes(v as LeadSource) ? (v as LeadSource) : "form";
}

const LEAD_CONVERTED: LeadConverted[] = ["unknown", "yes", "no"];
function normConverted(v: unknown): LeadConverted {
  return LEAD_CONVERTED.includes(v as LeadConverted) ? (v as LeadConverted) : "unknown";
}

export const LEAD_SOURCE_OPTIONS: { value: LeadSource; label: string }[] = [
  { value: "form", label: "Filled a form" },
  { value: "call", label: "Called in" },
  { value: "other", label: "Other" },
];

function weekOfYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return mondayOf(new Date(y, (m || 1) - 1, d || 1));
}

/**
 * Leads for an account, newest first.
 *
 * Passing a week narrows to leads that came in during that week — the default
 * view on both sides. Omitting it returns every lead ever, which is what the
 * "show all" toggle asks for.
 */
export function listLeads(clientId: string, opts?: { week?: string }): SnapshotLead[] {
  const week = opts?.week;
  return getDb()
    .prepare(
      `SELECT * FROM snapshot_leads
       WHERE client_id = ? ${week ? "AND week_start = ?" : ""}
       ORDER BY received_on DESC, created_at DESC`
    )
    .all(...(week ? [clientId, week] : [clientId])) as SnapshotLead[];
}

// Weeks that have at least one lead, so the client-facing picker can jump
// straight to a week that actually has something in it.
export function weeksWithLeads(clientId: string): string[] {
  return (
    getDb()
      .prepare(
        `SELECT DISTINCT week_start FROM snapshot_leads WHERE client_id = ?
         ORDER BY week_start DESC`
      )
      .all(clientId) as Array<{ week_start: string }>
  ).map((r) => r.week_start);
}

export function getLead(id: string): SnapshotLead | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM snapshot_leads WHERE id = ?`)
      .get(id) as SnapshotLead | undefined) || null
  );
}

export function addLead(input: {
  clientId: string;
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  source?: LeadSource;
  receivedOn?: string;
  notes?: string;
}): SnapshotLead {
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  const receivedOn = (input.receivedOn || "").trim() || todayYmd();
  db.prepare(
    `INSERT INTO snapshot_leads
      (id, client_id, first_name, last_name, email, phone, source, received_on,
       week_start, notes, converted, client_note, answered_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', '', '', ?, ?)`
  ).run(
    id,
    input.clientId,
    input.firstName.trim(),
    (input.lastName || "").trim(),
    (input.email || "").trim(),
    (input.phone || "").trim(),
    normSource(input.source),
    receivedOn,
    weekOfYmd(receivedOn),
    (input.notes || "").trim(),
    ts,
    ts
  );
  return getLead(id)!;
}

export function updateLead(
  id: string,
  updates: Partial<{
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    source: LeadSource;
    receivedOn: string;
    notes: string;
  }>
): SnapshotLead | null {
  const existing = getLead(id);
  if (!existing) return null;
  // Moving the date moves the lead to that date's week, so the two can never
  // disagree about which week a lead belongs to.
  const receivedOn = updates.receivedOn?.trim() || existing.received_on;
  getDb()
    .prepare(
      `UPDATE snapshot_leads
       SET first_name = ?, last_name = ?, email = ?, phone = ?, source = ?,
           received_on = ?, week_start = ?, notes = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      updates.firstName?.trim() ?? existing.first_name,
      updates.lastName?.trim() ?? existing.last_name,
      updates.email?.trim() ?? existing.email,
      updates.phone?.trim() ?? existing.phone,
      updates.source ? normSource(updates.source) : existing.source,
      receivedOn,
      weekOfYmd(receivedOn),
      updates.notes?.trim() ?? existing.notes,
      nowIso(),
      id
    );
  return getLead(id);
}

/**
 * Record the client's answer on a lead.
 *
 * Scoped to a client id because the caller is the public snapshot link: the
 * token proves which account the visitor may touch, and a lead from another
 * account must not be writable by passing its id.
 */
export function answerLead(
  clientId: string,
  leadId: string,
  converted: LeadConverted,
  clientNote?: string
): SnapshotLead | null {
  const lead = getLead(leadId);
  if (!lead || lead.client_id !== clientId) return null;
  const status = normConverted(converted);
  const ts = nowIso();
  getDb()
    .prepare(
      `UPDATE snapshot_leads
       SET converted = ?, client_note = ?, answered_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      status,
      clientNote !== undefined ? clientNote.trim() : lead.client_note,
      // Clearing the answer back to "unknown" clears the timestamp too, so an
      // un-answered lead never looks like it was answered.
      status === "unknown" ? "" : ts,
      ts,
      leadId
    );
  return getLead(leadId);
}

export function deleteLead(id: string): boolean {
  return getDb().prepare(`DELETE FROM snapshot_leads WHERE id = ?`).run(id).changes > 0;
}

export interface LeadTally {
  total: number;
  converted: number;
  notConverted: number;
  unanswered: number;
}

export function leadTally(leads: SnapshotLead[]): LeadTally {
  return {
    total: leads.length,
    converted: leads.filter((l) => l.converted === "yes").length,
    notConverted: leads.filter((l) => l.converted === "no").length,
    unanswered: leads.filter((l) => l.converted === "unknown").length,
  };
}

/* ----------------------------------------------- client revenue reports */

/** The calendar month before the one containing `ymd`, as YYYY-MM. */
export function previousMonthOf(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  return m <= 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function getRevenueReport(
  clientId: string,
  month: string
): SnapshotRevenueReport | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM snapshot_revenue_reports WHERE client_id = ? AND month = ?`)
      .get(clientId, month) as SnapshotRevenueReport | undefined) || null
  );
}

export function listRevenueReports(clientId: string): SnapshotRevenueReport[] {
  return getDb()
    .prepare(
      `SELECT * FROM snapshot_revenue_reports WHERE client_id = ?
       ORDER BY month DESC`
    )
    .all(clientId) as SnapshotRevenueReport[];
}

// A client revising their own number is normal — they close the books a week
// late, or they gave us a rough figure first. A revision reopens the report for
// review rather than keeping the old acceptance.
export function upsertRevenueReport(input: {
  clientId: string;
  month: string;
  amount: number;
  note?: string;
}): SnapshotRevenueReport {
  const db = getDb();
  const ts = nowIso();
  const existing = getRevenueReport(input.clientId, input.month);
  if (existing) {
    db.prepare(
      `UPDATE snapshot_revenue_reports
       SET amount = ?, note = ?, reported_at = ?, accepted_at = '', updated_at = ?
       WHERE id = ?`
    ).run(input.amount, (input.note ?? existing.note).trim(), ts, ts, existing.id);
    return getRevenueReport(input.clientId, input.month)!;
  }
  db.prepare(
    `INSERT INTO snapshot_revenue_reports
      (id, client_id, month, amount, note, reported_at, accepted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '', ?, ?)`
  ).run(
    nanoid(12),
    input.clientId,
    input.month,
    input.amount,
    (input.note || "").trim(),
    ts,
    ts,
    ts
  );
  return getRevenueReport(input.clientId, input.month)!;
}

export function markRevenueReportAccepted(id: string): SnapshotRevenueReport | null {
  const ts = nowIso();
  const changed = getDb()
    .prepare(`UPDATE snapshot_revenue_reports SET accepted_at = ?, updated_at = ? WHERE id = ?`)
    .run(ts, ts, id).changes;
  if (!changed) return null;
  return (
    (getDb()
      .prepare(`SELECT * FROM snapshot_revenue_reports WHERE id = ?`)
      .get(id) as SnapshotRevenueReport | undefined) || null
  );
}

export function deleteRevenueReport(id: string): boolean {
  return (
    getDb().prepare(`DELETE FROM snapshot_revenue_reports WHERE id = ?`).run(id).changes > 0
  );
}

export interface RevenueAsk {
  month: string; // YYYY-MM being asked about
  label: string; // "Jul 2026"
  amount: number | null; // what they already told us, or null
  reportedAt: string;
}

/**
 * Whether to ask this client for last month's revenue, and what they've said.
 *
 * The ask opens on the 1st and stays up until they answer, rather than living
 * only in the first week: a client who opens the link on the 14th is exactly
 * the client we never hear a number from. It closes as soon as they answer, and
 * never opens at all if we already have revenue for that month from our own
 * side — no point asking for something we can already see.
 *
 * `today` is injectable so this is testable without waiting for a month to turn.
 */
export function revenueAsk(clientId: string, today?: string): RevenueAsk | null {
  const month = previousMonthOf(today || todayYmd());
  const reported = getRevenueReport(clientId, month);
  if (reported) {
    // Still returned once answered so the page can confirm what we received.
    return {
      month,
      label: metricPeriodLabel(month),
      amount: reported.amount,
      reportedAt: reported.reported_at,
    };
  }
  const known = getDb()
    .prepare(`SELECT revenue FROM rev_metrics WHERE client_id = ? AND month = ?`)
    .get(clientId, month) as { revenue: number } | undefined;
  if (known && known.revenue > 0) return null;
  return { month, label: metricPeriodLabel(month), amount: null, reportedAt: "" };
}

/* ------------------------------------------------------- performance */

export interface MetricSeries {
  metric: string;
  unit: string;
  points: { period: string; value: number }[];
}

// All metric data points for an account, grouped into ordered series.
//
// Series are keyed case-insensitively so "Leads" and "leads" are one line on the
// chart rather than two, which is what a shift-key slip used to produce. The
// first spelling seen keeps its casing for the label.
export function metricsSeries(clientId: string): MetricSeries[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM snapshot_metrics WHERE client_id = ?
       ORDER BY sort_order ASC, metric ASC, period ASC`
    )
    .all(clientId) as SnapshotMetric[];
  const map = new Map<string, MetricSeries>();
  for (const r of rows) {
    const key = r.metric.trim().toLowerCase();
    let s = map.get(key);
    if (!s) {
      s = { metric: r.metric.trim(), unit: r.unit, points: [] };
      map.set(key, s);
    }
    if (r.unit && !s.unit) s.unit = r.unit;
    s.points.push({ period: r.period, value: r.value });
  }
  // Periods are canonical YYYY-MM, so sorting them as text is chronological.
  for (const s of map.values()) s.points.sort((a, b) => a.period.localeCompare(b.period));
  return Array.from(map.values());
}

export interface UpsertMetricResult {
  ok: boolean;
  error?: string;
  metric?: SnapshotMetric;
}

/**
 * Add or update one data point.
 *
 * An unreadable period is refused rather than stored as typed: a point the chart
 * cannot place is worse than a point that was never saved, because the first one
 * looks like it worked.
 *
 * Matching an existing point is case-insensitive on the metric name, so correcting
 * "leads" to "Leads" updates the series instead of forking it.
 */
export function upsertMetric(input: {
  clientId: string;
  metric: string;
  period: string;
  value: number;
  unit?: string;
  sortOrder?: number;
}): UpsertMetricResult {
  const db = getDb();
  const ts = nowIso();
  const metric = input.metric.trim();
  const period = normalizeMetricPeriod(input.period);

  if (!metric) return { ok: false, error: "A metric name is required." };
  if (!period) {
    return {
      ok: false,
      error: `Could not read "${input.period.trim()}" as a month. Use a month like 2026-04 or April 2026.`,
    };
  }
  if (!Number.isFinite(input.value)) {
    return { ok: false, error: "A numeric value is required." };
  }

  const existing = db
    .prepare(
      `SELECT * FROM snapshot_metrics
       WHERE client_id = ? AND lower(trim(metric)) = ? AND period = ?`
    )
    .get(input.clientId, metric.toLowerCase(), period) as SnapshotMetric | undefined;

  if (existing) {
    db.prepare(
      `UPDATE snapshot_metrics
       SET metric = ?, value = ?, unit = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      metric,
      input.value,
      input.unit ?? existing.unit,
      input.sortOrder ?? existing.sort_order,
      ts,
      existing.id
    );
    return {
      ok: true,
      metric: db
        .prepare(`SELECT * FROM snapshot_metrics WHERE id = ?`)
        .get(existing.id) as SnapshotMetric,
    };
  }

  const id = nanoid(12);
  db.prepare(
    `INSERT INTO snapshot_metrics
      (id, client_id, metric, period, value, unit, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.clientId,
    metric,
    period,
    input.value,
    (input.unit || "").trim(),
    input.sortOrder ?? 0,
    ts,
    ts
  );
  return {
    ok: true,
    metric: db.prepare(`SELECT * FROM snapshot_metrics WHERE id = ?`).get(id) as SnapshotMetric,
  };
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

/* ------------------------------------------------ deliverable overview */

// The standing state of one contracted deliverable, rolled up across every
// period (not scoped to a single week like WeekRow).
export interface DeliverableOverview {
  deliverable_id: string;
  category: string;
  name: string;
  cadence: string;
  kind: DeliverableKind;
  cadence_unit: CadenceUnit;
  // For recurring items: the CURRENT period's status only — resets to
  // "not_started" once a new week/month/quarter starts with nothing logged
  // yet, even if the prior period was completed. For one-time items: sticky
  // forever once done (see completed_on below).
  status: SnapshotStatus;
  worked_ever: boolean; // has any work been logged in any period, ever
  last_work_done: string; // most recent non-empty "what we did", any period
  last_activity_week: string; // period key of the most recent entry, or ""
  completed_on: string; // for one-time items: the period it was completed, or ""
}

const DONE_STATUSES: SnapshotStatus[] = ["completed", "approved"];

// All active deliverables for an account with their rolled-up status. Recurring
// items keep their configured order; one-time setup items that are done are
// sorted to the end so the client sees ongoing work first.
export function deliverableOverview(clientId: string): DeliverableOverview[] {
  const rows = getDb()
    .prepare(
      `SELECT d.id AS deliverable_id, d.category, d.name, d.cadence, d.kind, d.cadence_unit,
              d.sort_order, d.created_at AS d_created,
              e.week_start, e.status, e.work_done
       FROM snapshot_deliverables d
       LEFT JOIN snapshot_entries e ON e.deliverable_id = d.id
       WHERE d.client_id = ? AND d.active = 1
       ORDER BY d.sort_order ASC, d.created_at ASC, e.week_start ASC`
    )
    .all(clientId) as Array<{
    deliverable_id: string;
    category: string;
    name: string;
    cadence: string;
    kind: string;
    cadence_unit: string;
    sort_order: number;
    d_created: string;
    week_start: string | null;
    status: SnapshotStatus | null;
    work_done: string | null;
  }>;

  const today = todayYmd();
  // Precompute today's [start, end) range once per unit rather than per row.
  const currentRange: Record<CadenceUnit, [string, string]> = {
    weekly: [periodStartFor("weekly", today), periodEndExclusiveFor("weekly", today)],
    monthly: [periodStartFor("monthly", today), periodEndExclusiveFor("monthly", today)],
    quarterly: [periodStartFor("quarterly", today), periodEndExclusiveFor("quarterly", today)],
  };

  const order: string[] = [];
  const map = new Map<string, DeliverableOverview>();

  for (const r of rows) {
    let o = map.get(r.deliverable_id);
    if (!o) {
      o = {
        deliverable_id: r.deliverable_id,
        category: r.category,
        name: r.name,
        cadence: r.cadence,
        kind: normKind(r.kind),
        cadence_unit: normCadenceUnit(r.cadence_unit),
        status: "not_started",
        worked_ever: false,
        last_work_done: "",
        last_activity_week: "",
        completed_on: "",
      };
      map.set(r.deliverable_id, o);
      order.push(r.deliverable_id);
    }
    if (!r.week_start) continue; // deliverable with no entries yet

    const status = normStatus(r.status);
    const workDone = (r.work_done ?? "").trim();
    if (workDone || status !== "not_started") o.worked_ever = true;

    // rows arrive week_start ascending, so the last write wins for "latest".
    o.last_activity_week = r.week_start;
    if (workDone) o.last_work_done = workDone;
    if (DONE_STATUSES.includes(status)) o.completed_on = r.week_start;

    // Recurring: any entry falling inside the CURRENT period counts as this
    // period's status (last one within range wins, thanks to ascending
    // order) — no entry in range at all leaves the default "not_started".
    // One-time: handled separately below via completed_on (sticky forever).
    if (o.kind === "recurring") {
      const [start, end] = currentRange[o.cadence_unit];
      if (r.week_start >= start && r.week_start < end) o.status = status;
    }
  }

  const list = order.map((id) => map.get(id)!);
  for (const o of list) {
    // One-time items that are done render as "Completed" regardless of
    // period, and get pushed below the ongoing work.
    if (o.kind === "one_time" && o.completed_on) o.status = "completed";
  }
  return list.sort((a, b) => rank(a) - rank(b));
}

// Ongoing work first; finished one-time setup last.
function rank(o: DeliverableOverview): number {
  return o.kind === "one_time" && o.completed_on ? 1 : 0;
}

export interface WeekBounds {
  /** Monday of the earliest week there is anything to show, or "" if none. */
  earliest: string;
  /** Monday of the latest week worth showing: this week, never a future one. */
  latest: string;
}

/**
 * The range the client-facing week picker is allowed to move through.
 *
 * The picker used to be two unbounded arrows, so a client could page forward into
 * 2031 a week at a time and read "No updates logged for this week yet" the whole
 * way — which looks like an account going quiet rather than the end of the record.
 *
 * The floor is the first week anything was logged. The ceiling is the current
 * week, even when an entry sits beyond it: a monthly deliverable's entry is filed
 * under the start of its period, and work planned ahead is not a week the client
 * should be reading yet.
 */
export function weekBounds(clientId: string): WeekBounds {
  const row = getDb()
    .prepare(
      `SELECT MIN(week_start) AS earliest FROM snapshot_entries WHERE client_id = ?`
    )
    .get(clientId) as { earliest: string | null };
  const thisWeek = mondayOf(new Date());
  const earliest = row.earliest || "";
  return {
    earliest,
    // An account whose only entries are period-keyed ahead of today still gets a
    // sane range rather than one that ends before it begins.
    latest: earliest && earliest > thisWeek ? earliest : thisWeek,
  };
}

/* -------------------------------------------------------- contract status */

export interface ContractStatus {
  pct: number; // 0-100
  doneCount: number;
  totalCount: number;
  /** Recurring items whose current period is still open. Not counted as misses. */
  inFlightCount: number;
  onTrack: boolean;
  label: string;
}

/**
 * How much of the recurring contract is being delivered.
 *
 * Scored against the last CLOSED period, not the one in progress. Scoring the
 * open period made the number tell an untruth on a schedule: every monthly
 * deliverable resets to "not started" on the 1st, so on the 2nd of the month a
 * fully-delivered account read 0% and "Significantly behind" — and it disagreed
 * with the overdue banner sitting next to it, which correctly waits for a period
 * to end before calling anything late.
 *
 * So a deliverable counts one of three ways:
 *
 *   - **A miss**, if the period that just ended closed without it being done.
 *     This is exactly what the behind report flags, and reusing that set is what
 *     keeps the percentage and the "N overdue" banner from contradicting.
 *   - **A hit**, if it has a closed period it did not miss, or it is already done
 *     in the current one.
 *   - **In flight**, if it is too new to have a closed period. There is no fact
 *     yet about whether it will be delivered, so it is counted separately rather
 *     than scored as a failure. An account where everything is in flight has
 *     nothing to score, which is more honest than 0%.
 *
 * One-time setup items never count. They are not a recurring promise.
 */
export function contractStatus(clientId: string): ContractStatus {
  const overview = deliverableOverview(clientId).filter((d) => d.kind === "recurring");
  if (!overview.length) {
    return {
      pct: 0,
      doneCount: 0,
      totalCount: 0,
      inFlightCount: 0,
      onTrack: true,
      label: "No recurring deliverables",
    };
  }

  const behind = new Set(
    behindDeliverablesForClient(clientId)
      .filter((b) => b.kind === "recurring")
      .map((b) => b.deliverable_id)
  );

  // A deliverable can only be judged once it has lived through a whole period.
  const today = todayYmd();
  const createdAt = new Map(
    (
      getDb()
        .prepare(
          `SELECT id, cadence_unit, created_at FROM snapshot_deliverables
           WHERE client_id = ? AND active = 1`
        )
        .all(clientId) as Array<{ id: string; cadence_unit: string; created_at: string }>
    ).map((d) => [d.id, d])
  );
  const hasClosedPeriod = (id: string, unit: CadenceUnit): boolean => {
    const row = createdAt.get(id);
    if (!row) return false;
    return row.created_at.slice(0, 10) < periodStartFor(unit, today);
  };

  let doneCount = 0;
  let totalCount = 0;
  let inFlightCount = 0;

  for (const d of overview) {
    if (behind.has(d.deliverable_id)) {
      totalCount++;
      continue;
    }
    if (hasClosedPeriod(d.deliverable_id, d.cadence_unit) || DONE_STATUSES.includes(d.status)) {
      doneCount++;
      totalCount++;
      continue;
    }
    inFlightCount++;
  }

  if (!totalCount) {
    return {
      pct: 100,
      doneCount: 0,
      totalCount: 0,
      inFlightCount,
      onTrack: true,
      label: "Nothing due yet",
    };
  }

  const pct = Math.round((doneCount / totalCount) * 100);
  const onTrack = pct >= 90;
  const label = pct >= 90 ? "On track" : pct >= 60 ? "Behind" : "Significantly behind";
  return { pct, doneCount, totalCount, inFlightCount, onTrack, label };
}

/* ------------------------------------------------------------- behind */

export interface BehindItem {
  deliverable_id: string;
  client_id: string;
  category: string;
  name: string;
  kind: DeliverableKind;
  cadence_unit: CadenceUnit | null; // null for one-time
  due_date: string; // YYYY-MM-DD — the deadline that was missed
  status: SnapshotStatus;
}

function subDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d - n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

// Deliverables that are actually overdue, not just "not done yet with time
// left": a recurring item is only flagged once the period it was due in has
// fully ended (a monthly item isn't behind on day 2 of the month — it's
// behind once that month is over and it was never completed). A one-time
// item is only flagged if it has a manually-set due date that has passed.
export function behindDeliverablesForClient(clientId: string): BehindItem[] {
  const today = todayYmd();
  const deliverables = getDb()
    .prepare(`SELECT * FROM snapshot_deliverables WHERE client_id = ? AND active = 1`)
    .all(clientId) as SnapshotDeliverable[];
  if (!deliverables.length) return [];

  // Every entry for the account in one read, then grouped in memory. This used to
  // be a query per deliverable, which the cross-account behind report multiplied
  // by the client count — roughly a thousand round trips to render one page.
  const entries = getDb()
    .prepare(
      `SELECT deliverable_id, week_start, status, updated_at FROM snapshot_entries
       WHERE client_id = ?
       ORDER BY updated_at ASC, week_start ASC`
    )
    .all(clientId) as Array<{
    deliverable_id: string;
    week_start: string;
    status: string;
    updated_at: string;
  }>;

  const byDeliverable = new Map<string, Array<{ week_start: string; status: SnapshotStatus }>>();
  for (const e of entries) {
    const list = byDeliverable.get(e.deliverable_id) || [];
    list.push({ week_start: e.week_start, status: normStatus(e.status) });
    byDeliverable.set(e.deliverable_id, list);
  }

  const out: BehindItem[] = [];
  for (const d of deliverables) {
    const own = byDeliverable.get(d.id) || [];

    if (normKind(d.kind) === "one_time") {
      if (!d.due_date || d.due_date >= today) continue; // no deadline set, or not due yet
      if (own.some((e) => DONE_STATUSES.includes(e.status))) continue;
      out.push({
        deliverable_id: d.id,
        client_id: clientId,
        category: d.category,
        name: d.name,
        kind: "one_time",
        cadence_unit: null,
        due_date: d.due_date,
        status: "not_started",
      });
      continue;
    }

    const unit = normCadenceUnit(d.cadence_unit);
    const currentStart = periodStartFor(unit, today);
    // Didn't exist yet during the previous period — nothing was missed.
    if (d.created_at.slice(0, 10) >= currentStart) continue;
    const dueDate = subDaysYmd(currentStart, 1); // last day of the period that just ended
    const priorPeriodStart = periodStartFor(unit, dueDate);
    // Entries arrive in write order, so the last one inside the closed period is
    // the team's final word on it.
    const inPeriod = own.filter(
      (e) => e.week_start >= priorPeriodStart && e.week_start < currentStart
    );
    const status = inPeriod.length ? inPeriod[inPeriod.length - 1].status : "not_started";
    if (DONE_STATUSES.includes(status)) continue;
    out.push({
      deliverable_id: d.id,
      client_id: clientId,
      category: d.category,
      name: d.name,
      kind: "recurring",
      cadence_unit: unit,
      due_date: dueDate,
      status,
    });
  }
  return out;
}

export interface ClientBehindReport {
  client_id: string;
  client_name: string;
  items: BehindItem[];
}

// Every active client with at least one overdue deliverable, for the
// cross-account behind report.
export function behindReportAllClients(): ClientBehindReport[] {
  const clients = getDb()
    .prepare(`SELECT id, name FROM rev_clients WHERE active = 1 ORDER BY name COLLATE NOCASE`)
    .all() as Array<{ id: string; name: string }>;
  const out: ClientBehindReport[] = [];
  for (const c of clients) {
    const items = behindDeliverablesForClient(c.id);
    if (items.length) out.push({ client_id: c.id, client_name: c.name, items });
  }
  return out;
}
