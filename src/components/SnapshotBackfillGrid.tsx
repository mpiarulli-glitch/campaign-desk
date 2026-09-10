"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { defaultLoggedForDate } from "@/lib/snapshot-entry-date";
import { backfillCellRuns } from "@/lib/snapshot-backfill";
import {
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

function markLabel(status: Status): string {
  if (status === "not_started") return "";
  if (isSnapshotContractMet(status)) return "✓";
  if (status === "canceled") return "–";
  return "·";
}

export function SnapshotBackfillGrid({ clientId }: { clientId: string }) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [accountName, setAccountName] = useState("");
  const [columns, setColumns] = useState<Column[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [seeAll, setSeeAll] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
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
        setError("Could not load backfill grid.");
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

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || loading) return;
    el.scrollLeft = el.scrollWidth;
  }, [loading, columns.length]);

  const focusTeam = fillFocusTeam(viewer);
  const canSeeAll = fillCanSeeAll(viewer);
  const isAm = fillIsAccountManager(viewer);
  const viewerTeam = seeAll || isAm ? null : focusTeam;

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

  const monthBands = useMemo(() => {
    const bands: Array<{ month_key: string; label: string; span: number }> = [];
    for (const col of columns) {
      const last = bands[bands.length - 1];
      if (last?.month_key === col.month_key) {
        last.span += 1;
      } else {
        const [y, m] = col.month_key.split("-").map(Number);
        const label =
          y && m
            ? new Date(y, m - 1, 1).toLocaleDateString("en-US", {
                month: "short",
              })
            : col.month_key;
        bands.push({ month_key: col.month_key, label, span: 1 });
      }
    }
    return bands;
  }, [columns]);

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

  function onCellActivate(row: Row, cell: Cell) {
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
          {scopeLabel}. Empty cell → click once to mark done. Click a check to add a note or
          undo. Monthly work is one cell, not four copies.
        </p>
        <div className="snap-backfill-legend" aria-hidden="true">
          <span>
            <i className="snap-backfill-swatch is-empty" /> Open
          </span>
          <span>
            <i className="snap-backfill-swatch is-wip" /> In progress
          </span>
          <span>
            <i className="snap-backfill-swatch is-met" /> Done
          </span>
        </div>
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
              {showSetup ? "Hide setup" : `Show ${setupCount} one-offs`}
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
              : "No recurring deliverables on this account yet."}
          </p>
        </div>
      ) : (
        <div className="snap-backfill-scroll" ref={scrollRef}>
          <table className="snap-backfill-table">
            <thead>
              <tr className="snap-backfill-month-row">
                <th className="snap-backfill-sticky snap-backfill-corner-top" scope="col" />
                {monthBands.map((band) => (
                  <th
                    key={band.month_key}
                    colSpan={band.span}
                    scope="colgroup"
                    className="snap-backfill-month"
                  >
                    {band.label}
                  </th>
                ))}
              </tr>
              <tr>
                <th className="snap-backfill-sticky snap-backfill-corner" scope="col">
                  Deliverable
                </th>
                {columns.map((col) => (
                  <th
                    key={col.week_start}
                    scope="col"
                    className={`snap-backfill-week ${col.is_current ? "is-current" : ""}`}
                    title={col.label}
                  >
                    {Number(col.week_start.slice(8, 10))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scopedRows.map((row) => {
                const chip = ownershipChip(row);
                const hint = fillPeriodHint({
                  kind: row.kind,
                  cadence_unit: row.cadence_unit,
                  cadence: row.cadence,
                  period_start: row.cells.find((c) => c.editable)?.period_start || "",
                });
                const runs = backfillCellRuns(row.cells);
                return (
                  <tr key={row.deliverable_id}>
                    <th className="snap-backfill-sticky snap-backfill-row-head" scope="row">
                      <span className="snap-backfill-name">{row.name}</span>
                      <span className="snap-backfill-meta">
                        {hint || row.category}
                        {chip ? ` · ${chip}` : ""}
                      </span>
                    </th>
                    {runs.map((run) => {
                      const cell = run.cell;
                      const key = cellKey(row.deliverable_id, cell.week_start);
                      const open = openCell === key;
                      const state = saveState[key];
                      const met = isSnapshotContractMet(cell.status);
                      const col = columns.find((c) => c.week_start === cell.week_start);
                      const hasNote = Boolean(
                        (cell.work_done || "").trim() || (cell.notes || "").trim()
                      );
                      return (
                        <td
                          key={cell.week_start}
                          colSpan={run.span}
                          className={[
                            "snap-backfill-cell",
                            `status-${cell.status}`,
                            cell.editable ? "is-editable" : "is-inert",
                            met ? "is-met" : "",
                            open ? "is-open" : "",
                            hasNote ? "has-note" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {cell.editable ? (
                            <button
                              type="button"
                              className="snap-backfill-cell-btn"
                              title={
                                cell.status === "not_started"
                                  ? `${col?.label || ""} — click to mark done`
                                  : col?.label
                              }
                              onClick={() => onCellActivate(row, cell)}
                            >
                              {markLabel(cell.status)}
                            </button>
                          ) : (
                            <span className="snap-backfill-mirror" />
                          )}
                          {open ? (
                            <div className="snap-backfill-popover">
                              <div className="snap-backfill-popover-head">
                                <strong>{row.name}</strong>
                                <span className="muted">{col?.label}</span>
                              </div>
                              <div className="snap-backfill-quick">
                                {met ? null : (
                                  <button
                                    type="button"
                                    className="snap-done-btn"
                                    onClick={() => {
                                      patchCell(row.deliverable_id, cell.week_start, {
                                        status: "completed",
                                      });
                                      void saveCell(row.deliverable_id, cell.week_start, {
                                        status: "completed",
                                      });
                                      setOpenCell(null);
                                    }}
                                  >
                                    Done
                                  </button>
                                )}
                                <select
                                  value={cell.status}
                                  className={`snap-status-select status-${cell.status}`}
                                  aria-label="Status"
                                  onChange={(e) => {
                                    const status = e.target.value as Status;
                                    patchCell(row.deliverable_id, cell.week_start, { status });
                                    void saveCell(row.deliverable_id, cell.week_start, { status });
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
                                  value={cell.work_done}
                                  onChange={(e) =>
                                    patchCell(row.deliverable_id, cell.week_start, {
                                      work_done: e.target.value,
                                    })
                                  }
                                  onBlur={(e) =>
                                    void saveCell(row.deliverable_id, cell.week_start, {
                                      work_done: e.target.value,
                                    })
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
                              ) : snapshotAuthorLabel(cell.logged_by) ? (
                                <span className="snap-logged-by muted">
                                  {snapshotAuthorLabel(cell.logged_by)}
                                </span>
                              ) : null}
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => setOpenCell(null)}
                              >
                                Close
                              </button>
                            </div>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
