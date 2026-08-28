"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { defaultLoggedForDate } from "@/lib/snapshot-entry-date";
import {
  fillCanSeeAll,
  fillFocusTeam,
  fillIsAccountManager,
  fillPeriodHint,
  inferDeliverableOwnership,
  visibleFillRows,
  type FillViewer,
} from "@/lib/snapshot-fill";
import { actorLabel, teamLabelFor } from "@/lib/people";

type Status = "not_started" | "in_progress" | "completed" | "shared" | "approved";
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

const STATUSES: { value: Status; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "shared", label: "Shared" },
  { value: "approved", label: "Approved" },
];

const STATUS_SHORT: Record<Status, string> = {
  not_started: "—",
  in_progress: "WIP",
  completed: "Done",
  shared: "Shared",
  approved: "OK",
};

type SaveState = "saving" | "saved" | "failed";

function cellKey(delivId: string, weekStart: string): string {
  return `${delivId}:${weekStart}`;
}

function ownershipChip(row: { team: string; category: string; name: string }): string | null {
  const ownership = inferDeliverableOwnership(row);
  if (ownership === "unknown") return null;
  if (ownership === "strategy") return "Strategy";
  return teamLabelFor(ownership);
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
  const [viewer, setViewer] = useState<FillViewer>({ role: null, person: null, owner: false });
  const [viewerReady, setViewerReady] = useState(false);
  const [openCell, setOpenCell] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  const [loggedForByCell, setLoggedForByCell] = useState<Record<string, string>>({});

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

  const focusTeam = fillFocusTeam(viewer);
  const canSeeAll = fillCanSeeAll(viewer);
  const isAm = fillIsAccountManager(viewer);
  const viewerTeam = seeAll || isAm ? null : focusTeam;

  const scopedRows = useMemo(() => {
    if (!viewerReady) return [];
    const visible = visibleFillRows(rows, viewerTeam, { accountManager: isAm });
    const q = query.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter(
      (r) => r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q)
    );
  }, [rows, viewerTeam, isAm, query, viewerReady]);

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
                year: "numeric",
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
        // Monthly/quarterly mirrors: keep non-anchor cells in sync visually.
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

  async function saveCell(
    delivId: string,
    weekStart: string,
    patch: Partial<Cell>,
    opts?: { loggedFor?: string }
  ) {
    const key = cellKey(delivId, weekStart);
    setSaveState((s) => ({ ...s, [key]: "saving" }));
    const loggedFor = opts?.loggedFor ?? loggedForByCell[key] ?? defaultLoggedForDate(weekStart);
    try {
      const res = await fetch("/api/snapshot/entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliverableId: delivId,
          weekStart,
          loggedFor: loggedFor !== defaultLoggedForDate(weekStart) ? loggedFor : undefined,
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
        <p>Loading {accountName || "account"} backfill grid…</p>
      </div>
    );
  }

  return (
    <div className="snap-backfill">
      {error ? <p className="error">{error}</p> : null}

      <div className="snap-backfill-toolbar">
        <p className="muted snap-backfill-hint">
          {scopeLabel}. Scroll horizontally for {columns.length} weeks (~6 months). Weekly
          deliverables have a cell every week; monthly and quarterly only at period starts
          (same month/quarter shows the same status).
        </p>
        {scopedRows.length > 6 ? (
          <label className="snap-desk-search">
            <span>Find a deliverable</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or category"
            />
          </label>
        ) : null}
      </div>

      {!viewerReady ? (
        <div className="empty">
          <p>Loading your scoped list…</p>
        </div>
      ) : scopedRows.length === 0 ? (
        <div className="empty">
          <p>{query.trim() ? "Nothing matches that search." : "No deliverables on this account yet."}</p>
        </div>
      ) : (
        <div className="snap-backfill-scroll">
          <table className="snap-backfill-table">
            <thead>
              <tr className="snap-backfill-month-row">
                <th className="snap-backfill-sticky" scope="col" aria-label="Deliverables" />
                {monthBands.map((band) => (
                  <th key={band.month_key} colSpan={band.span} scope="colgroup" className="snap-backfill-month">
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
                    {col.short_label}
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
                return (
                  <tr key={row.deliverable_id}>
                    <th className="snap-backfill-sticky snap-backfill-row-head" scope="row">
                      <span className="snap-backfill-name">{row.name}</span>
                      <span className="snap-backfill-meta">
                        {row.category}
                        {hint ? ` · ${hint}` : ""}
                        {chip ? ` · ${chip}` : ""}
                      </span>
                    </th>
                    {row.cells.map((cell) => {
                      const key = cellKey(row.deliverable_id, cell.week_start);
                      const open = openCell === key;
                      const state = saveState[key];
                      return (
                        <td
                          key={cell.week_start}
                          className={[
                            "snap-backfill-cell",
                            `status-${cell.status}`,
                            cell.editable ? "is-editable" : "is-mirror",
                            open ? "is-open" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          {cell.editable ? (
                            <button
                              type="button"
                              className="snap-backfill-cell-btn"
                              title={columns.find((c) => c.week_start === cell.week_start)?.label}
                              onClick={() => setOpenCell(open ? null : key)}
                            >
                              {STATUS_SHORT[cell.status]}
                            </button>
                          ) : (
                            <span className="snap-backfill-mirror" aria-hidden="true">
                              {cell.status === "not_started" ? "" : STATUS_SHORT[cell.status]}
                            </span>
                          )}
                          {open ? (
                            <div className="snap-backfill-popover">
                              <div className="snap-backfill-popover-head">
                                <strong>{row.name}</strong>
                                <span className="muted">
                                  {columns.find((c) => c.week_start === cell.week_start)?.label}
                                </span>
                              </div>
                              <label>
                                <span>Status</span>
                                <select
                                  value={cell.status}
                                  className={`snap-status-select status-${cell.status}`}
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
                              </label>
                              <label>
                                <span>Logged for</span>
                                <input
                                  type="date"
                                  value={loggedForByCell[key] ?? defaultLoggedForDate(cell.week_start)}
                                  onChange={(e) =>
                                    setLoggedForByCell((m) => ({ ...m, [key]: e.target.value }))
                                  }
                                  onBlur={() =>
                                    void saveCell(
                                      row.deliverable_id,
                                      cell.week_start,
                                      {
                                        status: cell.status,
                                        work_done: cell.work_done,
                                        next_steps: cell.next_steps,
                                        notes: cell.notes,
                                      },
                                      { loggedFor: loggedForByCell[key] }
                                    )
                                  }
                                />
                              </label>
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
                                  rows={2}
                                />
                              </label>
                              <label>
                                <span>Next steps</span>
                                <textarea
                                  value={cell.next_steps}
                                  onChange={(e) =>
                                    patchCell(row.deliverable_id, cell.week_start, {
                                      next_steps: e.target.value,
                                    })
                                  }
                                  onBlur={(e) =>
                                    void saveCell(row.deliverable_id, cell.week_start, {
                                      next_steps: e.target.value,
                                    })
                                  }
                                  rows={2}
                                />
                              </label>
                              <label>
                                <span>Notes</span>
                                <textarea
                                  value={cell.notes}
                                  onChange={(e) =>
                                    patchCell(row.deliverable_id, cell.week_start, {
                                      notes: e.target.value,
                                    })
                                  }
                                  onBlur={(e) =>
                                    void saveCell(row.deliverable_id, cell.week_start, {
                                      notes: e.target.value,
                                    })
                                  }
                                  rows={2}
                                />
                              </label>
                              {state === "saving" ? (
                                <span className="snap-save snap-save-busy">Saving…</span>
                              ) : state === "saved" ? (
                                <span className="snap-save snap-save-ok">Saved</span>
                              ) : state === "failed" ? (
                                <span className="snap-save snap-save-bad">Not saved</span>
                              ) : null}
                              {cell.logged_by ? (
                                <span className="snap-logged-by muted">
                                  {actorLabel(cell.logged_by)}
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

      {canSeeAll ? (
        <div className="snap-backfill-scope">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setSeeAll((v) => !v)}
          >
            {seeAll ? `Show ${teamLabelFor(focusTeam || "email")} team` : "See all"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
