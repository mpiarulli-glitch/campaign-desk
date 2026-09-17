"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { defaultLoggedForDate } from "@/lib/snapshot-entry-date";
import {
  categoryTagTone,
  fillCanSeeAll,
  fillFocusTeam,
  fillIsAccountManager,
  fillPeriodHint,
  inferDeliverableOwnership,
  visibleFillRows,
  type FillViewer,
} from "@/lib/snapshot-fill";
import { snapshotAuthorLabel, teamLabelFor } from "@/lib/people";
import {
  SNAPSHOT_STATUSES,
  SNAPSHOT_STATUS_SHORT,
  isSnapshotContractMet,
  type SnapshotStatus,
} from "@/lib/snapshot-status";

type Status = SnapshotStatus;
type Kind = "recurring" | "one_time";
type CadenceUnit = "weekly" | "monthly" | "quarterly";

type Column = {
  week_start: string;
  label: string;
  short_label: string;
  is_current: boolean;
  month_key: string;
};

type Cell = {
  week_start: string;
  period_start: string;
  editable: boolean;
  status: Status;
  work_done: string;
  next_steps: string;
  notes: string;
  logged_by: string;
  updated_at: string;
};

type Row = {
  deliverable_id: string;
  category: string;
  team: string;
  name: string;
  cadence: string;
  kind: Kind;
  cadence_unit: CadenceUnit;
  cells: Cell[];
};

const STATUSES = SNAPSHOT_STATUSES;
const CADENCE_ORDER: Record<string, number> = { weekly: 0, monthly: 1, quarterly: 2 };

type SaveState = "saving" | "saved" | "failed";

function cellKey(delivId: string, weekStart: string): string {
  return `${delivId}:${weekStart}`;
}

function ownershipChip(row: { team: string; category: string; name: string }): string | null {
  const ownership = inferDeliverableOwnership(row);
  if (ownership === "unknown") return null;
  return teamLabelFor(ownership);
}

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  if (!y || !m) return monthKey;
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short" });
}

export function SnapshotBackfillGrid({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [accountName, setAccountName] = useState("");
  const [columns, setColumns] = useState<Column[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [seeAll, setSeeAll] = useState(false);
  const [showSetup, setShowSetup] = useState(true);
  const [viewer, setViewer] = useState<FillViewer>({ role: null, person: null, owner: false });
  const [viewerReady, setViewerReady] = useState(false);
  const [openCell, setOpenCell] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/snapshot/accounts/${clientId}/backfill`);
      if (res.status === 401) return router.push("/login");
      if (!res.ok) {
        setError("Could not load history.");
        return;
      }
      const data = await res.json();
      setAccountName(data.account?.name || "");
      setColumns(data.columns || []);
      setRows(data.rows || []);
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [clientId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    fetch("/api/auth")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.authenticated) return;
        setViewer({
          role: data.role,
          person: data.person || null,
          owner: Boolean(data.owner),
        });
      })
      .catch(() => {})
      .finally(() => setViewerReady(true));
  }, []);

  const focusTeam = fillFocusTeam(viewer);
  const canSeeAll = fillCanSeeAll(viewer);
  const isAm = fillIsAccountManager(viewer);
  const viewerTeam = seeAll || isAm ? null : focusTeam;

  const months = useMemo(() => {
    const keys: string[] = [];
    for (const col of columns) {
      if (keys[keys.length - 1] !== col.month_key) keys.push(col.month_key);
    }
    return keys;
  }, [columns]);

  const scopedRows = useMemo(() => {
    if (!viewerReady) return [];
    const visible = visibleFillRows(rows, viewerTeam, { accountManager: isAm }).filter(
      (r) => showSetup || r.kind !== "one_time"
    );
    const q = query.trim().toLowerCase();
    const filtered = q
      ? visible.filter(
          (r) => r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q)
        )
      : visible;
    return [...filtered].sort((a, b) => {
      const byKind = (a.kind === "one_time" ? 1 : 0) - (b.kind === "one_time" ? 1 : 0);
      if (byKind) return byKind;
      const byCadence =
        (CADENCE_ORDER[a.cadence_unit] ?? 9) - (CADENCE_ORDER[b.cadence_unit] ?? 9);
      if (byCadence) return byCadence;
      return a.name.localeCompare(b.name);
    });
  }, [rows, viewerTeam, isAm, query, viewerReady, showSetup]);

  function patchCell(delivId: string, weekStart: string, patch: Partial<Cell>) {
    setRows((rs) =>
      rs.map((row) => {
        if (row.deliverable_id !== delivId) return row;
        const cells = row.cells.map((c) => {
          if (c.week_start !== weekStart) return c;
          return { ...c, ...patch };
        });
        if (row.kind === "recurring" && row.cadence_unit !== "weekly") {
          const edited = cells.find((c) => c.week_start === weekStart);
          if (!edited?.period_start) return { ...row, cells };
          return {
            ...row,
            cells: cells.map((c) =>
              c.period_start === edited.period_start ? { ...c, ...patch, editable: c.editable } : c
            ),
          };
        }
        return { ...row, cells };
      })
    );
  }

  async function saveCell(delivId: string, weekStart: string, patch: Partial<Cell>) {
    const key = cellKey(delivId, weekStart);
    setSaveState((s) => ({ ...s, [key]: "saving" }));
    const loggedFor = defaultLoggedForDate(weekStart);
    try {
      const res = await fetch("/api/snapshot/entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliverableId: delivId,
          weekStart,
          loggedFor,
          status: patch.status,
          workDone: patch.work_done,
          nextSteps: patch.next_steps,
          notes: patch.notes,
        }),
      });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) {
        setSaveState((s) => ({ ...s, [key]: "failed" }));
        return;
      }
      const data = await res.json().catch(() => ({}));
      patchCell(delivId, weekStart, {
        logged_by: typeof data.loggedBy === "string" ? data.loggedBy : undefined,
        updated_at: typeof data.updatedAt === "string" ? data.updatedAt : undefined,
      });
      setSaveState((s) => ({ ...s, [key]: "saved" }));
    } catch {
      setSaveState((s) => ({ ...s, [key]: "failed" }));
    }
  }

  function onChipClick(row: Row, cell: Cell) {
    if (!cell.editable) return;
    const key = cellKey(row.deliverable_id, cell.week_start);
    if (cell.status === "not_started") {
      patchCell(row.deliverable_id, cell.week_start, { status: "completed" });
      void saveCell(row.deliverable_id, cell.week_start, { status: "completed" });
      return;
    }
    setOpenCell((cur) => (cur === key ? null : key));
  }

  const setupCount = rows.filter((r) => r.kind === "one_time").length;
  const scopeLabel = !viewerReady
    ? "Loading your list"
    : isAm
      ? "All deliverables"
      : seeAll || !focusTeam
        ? "All teams"
        : `${teamLabelFor(focusTeam)} team`;

  if (loading) {
    return (
      <div className="empty">
        <p>Loading {accountName || "account"}…</p>
      </div>
    );
  }

  return (
    <div className="snap-backfill">
      {error ? <p className="error">{error}</p> : null}

      <div className="snap-backfill-toolbar">
        <p className="snap-backfill-hint">
          {scopeLabel}. Each column is a month. Click an empty week or month to mark it done.
          Click a filled one to change the status or add a note.
        </p>
        <div className="snap-backfill-tools">
          {scopedRows.length > 6 || query ? (
            <label className="snap-desk-search">
              <span>Find</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name or category"
              />
            </label>
          ) : null}
          {setupCount > 0 ? (
            <button
              type="button"
              className={`btn btn-sm ${showSetup ? "btn-secondary" : "btn-ghost"}`}
              onClick={() => setShowSetup((v) => !v)}
            >
              {showSetup ? "Hide one-offs" : `Show ${setupCount} one-offs`}
            </button>
          ) : null}
          {canSeeAll ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setSeeAll((v) => !v)}
            >
              {seeAll ? `Show ${teamLabelFor(focusTeam || "email")} team` : "See all"}
            </button>
          ) : null}
        </div>
      </div>

      {!viewerReady ? (
        <div className="empty">
          <p>Loading your scoped list…</p>
        </div>
      ) : scopedRows.length === 0 ? (
        <div className="empty">
          <p>
            {query.trim()
              ? "Nothing matches that search."
              : "No deliverables on this account yet."}
          </p>
        </div>
      ) : (
        <div className="snap-n-db snap-bf-db">
          <div
            className="snap-bf-cols snap-n-head"
            style={{ gridTemplateColumns: `minmax(180px, 1.4fr) repeat(${months.length}, minmax(92px, 1fr))` }}
          >
            <span>Deliverable</span>
            {months.map((key) => (
              <span key={key}>{monthLabel(key)}</span>
            ))}
          </div>
          {scopedRows.map((row) => {
            const chip = ownershipChip(row);
            const hint = fillPeriodHint({
              kind: row.kind,
              cadence_unit: row.cadence_unit,
              cadence: row.cadence,
              period_start: row.cells.find((c) => c.editable)?.period_start || "",
            });
            return (
              <BackfillRow
                key={row.deliverable_id}
                row={row}
                months={months}
                columns={columns}
                openCell={openCell}
                saveState={saveState}
                chip={chip}
                hint={hint}
                onChipClick={onChipClick}
                onPatch={patchCell}
                onSave={saveCell}
                onClose={() => setOpenCell(null)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function BackfillRow({
  row,
  months,
  columns,
  openCell,
  saveState,
  chip,
  hint,
  onChipClick,
  onPatch,
  onSave,
  onClose,
}: {
  row: Row;
  months: string[];
  columns: Column[];
  openCell: string | null;
  saveState: Record<string, SaveState>;
  chip: string | null;
  hint: string;
  onChipClick: (row: Row, cell: Cell) => void;
  onPatch: (delivId: string, weekStart: string, patch: Partial<Cell>) => void;
  onSave: (delivId: string, weekStart: string, patch: Partial<Cell>) => void;
  onClose: () => void;
}) {
  const open = row.cells.find(
    (c) => cellKey(row.deliverable_id, c.week_start) === openCell && c.editable
  );
  const openCol = open ? columns.find((c) => c.week_start === open.week_start) : null;
  const openKey = open ? cellKey(row.deliverable_id, open.week_start) : "";
  const state = openKey ? saveState[openKey] : undefined;
  const metOpen = open ? isSnapshotContractMet(open.status) : false;

  return (
    <div className={`snap-n-row ${open ? "is-open" : ""}`}>
      <div
        className="snap-bf-cols"
        style={{ gridTemplateColumns: `minmax(180px, 1.4fr) repeat(${months.length}, minmax(92px, 1fr))` }}
      >
        <div className="snap-n-title">
          <span className="snap-n-ico" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M4.5 2.5h5.2L12.5 5.3V13.5h-8v-11z" />
              <path d="M9.5 2.5V5.5h3" />
            </svg>
          </span>
          <span className="snap-n-name">{row.name}</span>
        </div>
        {months.map((monthKey) => {
          const monthCells = row.cells.filter((c) => c.week_start.startsWith(monthKey));
          if (row.kind === "one_time") {
            const cell = monthCells.find((c) => c.editable);
            if (!cell) {
              return <span key={monthKey} className="snap-bf-empty" />;
            }
            return (
              <MonthPeriodCell
                key={monthKey}
                row={row}
                cell={cell}
                columns={columns}
                open={openCell === cellKey(row.deliverable_id, cell.week_start)}
                onChipClick={onChipClick}
              />
            );
          }
          if (row.cadence_unit === "weekly") {
            return (
              <div key={monthKey} className="snap-bf-weeks">
                {monthCells.map((cell) => {
                  const col = columns.find((c) => c.week_start === cell.week_start);
                  const met = isSnapshotContractMet(cell.status);
                  const openThis = openCell === cellKey(row.deliverable_id, cell.week_start);
                  return (
                    <button
                      key={cell.week_start}
                      type="button"
                      className={[
                        "snap-bf-chip",
                        `status-${cell.status}`,
                        met ? "is-met" : "",
                        openThis ? "is-open" : "",
                        cell.editable ? "" : "is-inert",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      disabled={!cell.editable}
                      title={`${col?.label || cell.week_start} · ${SNAPSHOT_STATUSES.find((s) => s.value === cell.status)?.label}`}
                      onClick={() => onChipClick(row, cell)}
                    >
                      {cell.status === "not_started"
                        ? col?.short_label.replace(/^[A-Za-z]+ /, "") || "·"
                        : SNAPSHOT_STATUS_SHORT[cell.status]}
                    </button>
                  );
                })}
              </div>
            );
          }
          const cell = monthCells.find((c) => c.editable);
          if (!cell) {
            const mirrored = monthCells.find((c) => c.period_start && isSnapshotContractMet(c.status));
            return (
              <span key={monthKey} className={`snap-bf-empty ${mirrored ? "is-echo" : ""}`}>
                {mirrored ? "same" : ""}
              </span>
            );
          }
          return (
            <MonthPeriodCell
              key={monthKey}
              row={row}
              cell={cell}
              columns={columns}
              open={openCell === cellKey(row.deliverable_id, cell.week_start)}
              onChipClick={onChipClick}
            />
          );
        })}
      </div>
      <p className="snap-n-meta">
        <span className={`snap-n-tag snap-n-tag-${categoryTagTone(row.category || "Other")}`}>
          {row.category.trim() || "Other"}
        </span>
        {hint || row.cadence}
        {chip ? ` · ${chip}` : ""}
        {row.kind === "one_time" ? " · One-off" : ""}
      </p>
      {open ? (
        <div className="snap-fields">
          <div className="snap-backfill-quick">
            <strong>{openCol?.label}</strong>
            {metOpen ? null : (
              <button
                type="button"
                className="snap-done-btn"
                onClick={() => {
                  onPatch(row.deliverable_id, open.week_start, { status: "completed" });
                  void onSave(row.deliverable_id, open.week_start, { status: "completed" });
                  onClose();
                }}
              >
                Mark done
              </button>
            )}
            <select
              value={open.status}
              className={`snap-n-status status-${open.status}`}
              aria-label="Status"
              onChange={(e) => {
                const status = e.target.value as Status;
                onPatch(row.deliverable_id, open.week_start, { status });
                void onSave(row.deliverable_id, open.week_start, { status });
              }}
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <label>
            <span>What we did</span>
            <textarea
              value={open.work_done}
              onChange={(e) =>
                onPatch(row.deliverable_id, open.week_start, { work_done: e.target.value })
              }
              onBlur={(e) =>
                void onSave(row.deliverable_id, open.week_start, { work_done: e.target.value })
              }
              rows={3}
            />
          </label>
          {state === "saving" ? (
            <span className="snap-save snap-save-busy">Saving…</span>
          ) : state === "saved" ? (
            <span className="snap-save snap-save-ok">Saved</span>
          ) : state === "failed" ? (
            <span className="snap-save snap-save-bad">Not saved</span>
          ) : snapshotAuthorLabel(open.logged_by) ? (
            <span className="snap-logged-by muted">{snapshotAuthorLabel(open.logged_by)}</span>
          ) : null}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MonthPeriodCell({
  row,
  cell,
  columns,
  open,
  onChipClick,
}: {
  row: Row;
  cell: Cell;
  columns: Column[];
  open: boolean;
  onChipClick: (row: Row, cell: Cell) => void;
}) {
  const col = columns.find((c) => c.week_start === cell.week_start);
  const met = isSnapshotContractMet(cell.status);
  return (
    <button
      type="button"
      className={[
        "snap-bf-month",
        `status-${cell.status}`,
        met ? "is-met" : "",
        open ? "is-open" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      title={`${col?.label || cell.week_start} · ${SNAPSHOT_STATUSES.find((s) => s.value === cell.status)?.label}`}
      onClick={() => onChipClick(row, cell)}
    >
      {cell.status === "not_started" ? "Empty" : SNAPSHOT_STATUS_SHORT[cell.status]}
    </button>
  );
}
