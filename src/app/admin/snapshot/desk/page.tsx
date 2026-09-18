"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SnapshotDeskClientView, SnapshotDeskWeeklyWin, SnapshotDeskWins, type DeskWeekWin } from "@/components/SnapshotDeskAccountViews";
import { SnapshotFillRow, type SnapshotFillRowData, type SnapshotFillSaveState, type SnapshotOverdueDetail, type SnapshotBasecampTodoPatch } from "@/components/SnapshotFillRow";
import { addWeeks, currentWeek, isCurrentWeek, weekLabel } from "@/lib/week";
import { defaultLoggedForDate } from "@/lib/snapshot-entry-date";
import { canSeeFridayAsk, teamLabelFor } from "@/lib/people";
import {
  fillCanSeeAll,
  fillCounts,
  fillFocusTeam,
  fillIsAccountManager,
  fillLane,
  fillPassSummary,
  fillViewerSlug,
  filterFillRows,
  visibleFillRows,
  winLoggedByMatches,
  type FillFilter,
  type FillViewer,
} from "@/lib/snapshot-fill";

type DeskRow = SnapshotFillRowData & {
  client_id: string;
  client_name: string;
  launch_date: string | null;
};

export default function SnapshotDeskPage() {
  const router = useRouter();
  const [rows, setRows] = useState<DeskRow[]>([]);
  const [behindById, setBehindById] = useState<Record<string, SnapshotOverdueDetail>>({});
  const [week, setWeek] = useState(currentWeek());
  const [weekLoaded, setWeekLoaded] = useState("");
  const [error, setError] = useState("");
  const [fillFilter, setFillFilter] = useState<FillFilter>("all");
  const [seeAll, setSeeAll] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [clientId, setClientId] = useState("all");
  const [groupView, setGroupView] = useState<Record<string, "week" | "wins" | "client">>({});
  const [saveState, setSaveState] = useState<Record<string, SnapshotFillSaveState>>({});
  const [failedPatch, setFailedPatch] = useState<Record<string, Partial<SnapshotFillRowData>>>({});
  const [loggedForByRow, setLoggedForByRow] = useState<Record<string, string>>({});
  const [keptIds, setKeptIds] = useState<string[]>([]);
  const [viewer, setViewer] = useState<FillViewer>({ role: null, person: null, owner: false });
  const [viewerReady, setViewerReady] = useState(false);
  const [weekWins, setWeekWins] = useState<DeskWeekWin[]>([]);

  const fetchWeek = useCallback(
    async (w: string) => {
      try {
        const res = await fetch(`/api/snapshot/desk?week=${w}`);
        if (res.status === 401) return router.push("/login");
        if (!res.ok) {
          setError("Could not load this week's snapshots.");
          return;
        }
        const data = await res.json();
        const behindRows = (data.behind || []) as Array<SnapshotOverdueDetail & { deliverable_id: string }>;
        const next: Record<string, SnapshotOverdueDetail> = {};
        for (const item of behindRows) {
          next[item.deliverable_id] = {
            due_date: item.due_date,
            kind: item.kind,
            cadence_unit: item.cadence_unit,
            status: item.status,
          };
        }
        setRows(data.rows || []);
        setBehindById(next);
        setWeekWins(data.wins || []);
        setWeekLoaded(w);
        setSaveState({});
        setFailedPatch({});
        setLoggedForByRow({});
        setKeptIds([]);
      } catch {
        setError("Network error. Check your connection and try again.");
      }
    },
    [router]
  );

  useEffect(() => {
    void fetchWeek(week);
  }, [week, fetchWeek]);

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
    return visibleFillRows(rows, viewerTeam, { accountManager: isAm });
  }, [rows, viewerTeam, isAm, viewerReady]);

  const clients = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of scopedRows) {
      if (!seen.has(row.client_id)) seen.set(row.client_id, row.client_name);
    }
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [scopedRows]);

  const clientScoped = useMemo(
    () => (clientId === "all" ? scopedRows : scopedRows.filter((r) => r.client_id === clientId)),
    [scopedRows, clientId]
  );

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clientScoped;
    return clientScoped.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q) ||
        r.client_name.toLowerCase().includes(q)
    );
  }, [clientScoped, query]);

  const behindIds = useMemo(() => new Set(Object.keys(behindById)), [behindById]);
  const counts = fillCounts(clientScoped, behindIds);
  const viewerSlug = fillViewerSlug(viewer);
  const accountsMissingWin = useMemo(() => {
    const ids = [...new Set(clientScoped.map((r) => r.client_id))];
    if (!viewerSlug) return new Set(ids);
    const have = new Set(
      weekWins
        .filter((w) => winLoggedByMatches(w.logged_by, viewerSlug))
        .map((w) => w.client_id)
    );
    return new Set(ids.filter((id) => !have.has(id)));
  }, [clientScoped, weekWins, viewerSlug]);
  const winNeeded = accountsMissingWin.size;
  const stayOnList = useMemo(() => {
    const ids = new Set(keptIds);
    if (openId) ids.add(openId);
    return ids;
  }, [keptIds, openId]);
  const filteredRows = filterFillRows(searched, fillFilter, behindIds, stayOnList);
  const passLine = fillPassSummary(counts, isCurrentWeek(week));
  const winLine =
    winNeeded === 0
      ? "Your weekly win is in on every account in this list."
      : `${winNeeded} account${winNeeded === 1 ? "" : "s"} still need your win this week.`;
  const scopeLabel = !viewerReady
    ? "Loading your list"
    : isAm
      ? "All deliverables"
      : seeAll || !focusTeam
        ? "All teams"
        : `${teamLabelFor(focusTeam)} team`;

  const groups = useMemo(() => {
    const map = new Map<string, { id: string; name: string; launch: string | null; rows: DeskRow[] }>();
    for (const row of searched) {
      let group = map.get(row.client_id);
      if (!group) {
        group = { id: row.client_id, name: row.client_name, launch: row.launch_date, rows: [] };
        map.set(row.client_id, group);
      }
      group.rows.push(row);
    }
    return [...map.values()].filter(
      (group) => fillFilter !== "win" || accountsMissingWin.has(group.id)
    );
  }, [searched, fillFilter, accountsMissingWin]);

  useEffect(() => {
    if (weekLoaded !== week) return;
    const first = filteredRows.find((r) => fillLane(r, behindIds) !== "done");
    setOpenId(first?.deliverable_id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- weekLoaded is the gate
  }, [week, weekLoaded]);

  function patchRow(delivId: string, patch: Partial<SnapshotFillRowData>) {
    const defined = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined)
    ) as Partial<SnapshotFillRowData>;
    setRows((rs) => rs.map((r) => (r.deliverable_id === delivId ? { ...r, ...defined } : r)));
  }

  function loggedForForRow(delivId: string): string {
    if (loggedForByRow[delivId]) return loggedForByRow[delivId];
    return defaultLoggedForDate(week);
  }

  async function saveEntry(
    delivId: string,
    patch: Partial<SnapshotFillRowData>,
    opts?: { loggedFor?: string; basecampTodo?: SnapshotBasecampTodoPatch }
  ) {
    setSaveState((s) => ({ ...s, [delivId]: "saving" }));
    if (patch.status && fillLane({ deliverable_id: delivId, status: patch.status }, behindIds) === "done") {
      setKeptIds((ids) => (ids.includes(delivId) ? ids : [...ids, delivId]));
      setOpenId(delivId);
    }
    const loggedFor = opts?.loggedFor ?? loggedForForRow(delivId);
    let basecampTodo = opts?.basecampTodo;
    if (basecampTodo === undefined && Object.prototype.hasOwnProperty.call(patch, "basecamp_todo_id")) {
      const id = (patch.basecamp_todo_id || "").trim();
      basecampTodo = id
        ? {
            id,
            projectId: (patch.basecamp_project_id || "").trim(),
            title: (patch.basecamp_todo_title || "").trim(),
            url: (patch.basecamp_todo_url || "").trim(),
            completedAt: (patch.basecamp_todo_completed_at || "").trim(),
          }
        : null;
    }
    try {
      const body: Record<string, unknown> = {
        deliverableId: delivId,
        weekStart: week,
        loggedFor,
        status: patch.status,
        workDone: patch.work_done,
        nextSteps: patch.next_steps,
        notes: patch.notes,
      };
      if (basecampTodo !== undefined) body.basecampTodo = basecampTodo;
      const res = await fetch("/api/snapshot/entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) {
        setSaveState((s) => ({ ...s, [delivId]: "failed" }));
        setFailedPatch((f) => ({ ...f, [delivId]: { ...(f[delivId] || {}), ...patch } }));
        return;
      }
      const data = await res.json().catch(() => ({}));
      patchRow(delivId, {
        logged_by: typeof data.loggedBy === "string" ? data.loggedBy : undefined,
        updated_at: typeof data.updatedAt === "string" ? data.updatedAt : undefined,
      });
      setSaveState((s) => ({ ...s, [delivId]: "saved" }));
      setFailedPatch((f) => {
        if (!f[delivId]) return f;
        const next = { ...f };
        delete next[delivId];
        return next;
      });
    } catch {
      setSaveState((s) => ({ ...s, [delivId]: "failed" }));
      setFailedPatch((f) => ({ ...f, [delivId]: { ...(f[delivId] || {}), ...patch } }));
    }
  }

  async function retryEntry(delivId: string) {
    const pending = failedPatch[delivId];
    if (!pending) return;
    await saveEntry(delivId, pending);
  }

  return (
    <div className="ops-page snap-desk">
      <div className="page-actions">
        {canSeeFridayAsk(viewer) ? (
          <Link className="btn btn-ghost btn-sm" href="/admin/client-services">
            Friday ask
          </Link>
        ) : null}
        <Link className="btn btn-ghost btn-sm" href="/admin/snapshot/behind">
          Behind report
        </Link>
        <Link className="btn btn-ghost btn-sm" href="/admin/snapshot/instructions">
          How to fill
        </Link>
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

      <div className="ops-page-head">
        <div>
          <p className="ops-eyebrow">Weekly snapshots</p>
          <h1 className="ops-title">This week</h1>
          <p className="snap-n-view">All accounts</p>
          <p className="ops-sub">{scopeLabel}. Log your win on each account, then update the week.</p>
        </div>
        <div className="snap-desk-week">
          <button type="button" className="cal-nav-btn" aria-label="Previous week" onClick={() => setWeek((w) => addWeeks(w, -1))}>‹</button>
          <span className="snap-desk-week-label">
            {weekLabel(week)}{isCurrentWeek(week) ? " · This week" : ""}
          </span>
          <button type="button" className="cal-nav-btn" aria-label="Next week" onClick={() => setWeek((w) => addWeeks(w, 1))}>›</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setWeek(currentWeek())}>This week</button>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {counts.total > 0 ? (
        <div className={`ads-pass-banner ${counts.attention === 0 && winNeeded === 0 ? "is-clear" : "is-work"}`}>
          <p className="ads-pass-banner-line">{passLine}</p>
          <p className="ads-pass-banner-line">{winLine}</p>
        </div>
      ) : null}

      {counts.total > 0 ? (
        <label className="snap-desk-search snap-desk-client">
          <span>Show</span>
          <select
            value={fillFilter}
            aria-label="Filter this week"
            onChange={(e) => setFillFilter(e.target.value as FillFilter)}
          >
            <option value="all">All · {counts.total}</option>
            <option value="todo">Needs update · {counts.attention}</option>
            <option value="overdue">Overdue · {counts.overdue}</option>
            <option value="win">Needs your win · {winNeeded}</option>
            <option value="done">Logged · {counts.done}</option>
          </select>
        </label>
      ) : null}

      {clients.length > 1 ? (
        <label className="snap-desk-search snap-desk-client">
          <span>Client</span>
          <select
            value={clientId}
            aria-label="Filter by client"
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="all">Every client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {scopedRows.length > 8 ? (
        <label className="snap-desk-search">
          <span>Find</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Client, deliverable, or category"
          />
        </label>
      ) : null}

      {!viewerReady ? (
        <div className="empty">
          <p>Loading this week&apos;s pass…</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="empty">
          <p>No deliverables on the snapshot roster yet.</p>
          <Link className="btn btn-sm" href="/admin/client-services">
            Open deliverable setup
          </Link>
        </div>
      ) : searched.length === 0 ? (
        <div className="empty">
          <p>
            {query.trim()
              ? "Nothing matches that search."
              : fillFilter === "todo"
                ? "Clear — nothing left to update in this view."
                : fillFilter === "win"
                  ? "Your weekly win is in on every account here."
                  : "Nothing in this filter."}
          </p>
          {fillFilter !== "all" && !query.trim() ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFillFilter("all")}>
              View all
            </button>
          ) : null}
        </div>
      ) : (
        <div className="stack" style={{ gap: 18 }}>
          {groups.map((group) => {
            const view = groupView[group.id] || "week";
            const weekRows = filterFillRows(group.rows, fillFilter, behindIds, stayOnList);
            return (
            <div key={group.id} className="snap-n-db">
              <div className="snap-n-group">
                <Link href={`/admin/snapshot/${group.id}`}>{group.name}</Link>
                <label className="snap-n-group-view">
                  <select
                    value={view}
                    aria-label={`View for ${group.name}`}
                    onChange={(e) =>
                      setGroupView((cur) => ({
                        ...cur,
                        [group.id]: e.target.value as "week" | "wins" | "client",
                      }))
                    }
                  >
                    <option value="week">This week</option>
                    <option value="wins">Wins</option>
                    <option value="client">Client view</option>
                  </select>
                </label>
              </div>
              <SnapshotDeskWeeklyWin
                clientId={group.id}
                clientName={group.name}
                weekStart={week}
                viewerSlug={viewerSlug}
                wins={weekWins.filter((w) => w.client_id === group.id)}
                onAdded={(win) =>
                  setWeekWins((cur) => (cur.some((w) => w.id === win.id) ? cur : [...cur, win]))
                }
              />
              {view === "wins" ? (
                <SnapshotDeskWins clientId={group.id} weekStart={week} />
              ) : view === "client" ? (
                <SnapshotDeskClientView clientId={group.id} />
              ) : weekRows.length === 0 ? (
                <p className="snap-n-pane-muted">
                  {fillFilter === "todo"
                    ? "Nothing left to update for this client in this filter."
                    : fillFilter === "win"
                      ? "Add your win above — deliverables for this client are already logged."
                      : "Nothing in this filter."}
                </p>
              ) : (
                <>
              <div className="snap-n-cols snap-n-head" aria-hidden="true">
                <span>Deliverable</span>
                <span>Category</span>
                <span>Status</span>
                <span>Period</span>
                <span />
              </div>
              {weekRows.map((r) => (
                <SnapshotFillRow
                  key={r.deliverable_id}
                  row={r}
                  clientId={group.id}
                  viewWeek={week}
                  loggedFor={loggedForForRow(r.deliverable_id)}
                  overdue={behindIds.has(r.deliverable_id)}
                  overdueDetail={behindById[r.deliverable_id] || null}
                  open={openId === r.deliverable_id}
                  saveState={saveState[r.deliverable_id]}
                  launchDate={group.launch}
                  onToggle={() => setOpenId((cur) => (cur === r.deliverable_id ? null : r.deliverable_id))}
                  onPatch={(patch) => patchRow(r.deliverable_id, patch)}
                  onLoggedForChange={(loggedFor) =>
                    setLoggedForByRow((m) => ({ ...m, [r.deliverable_id]: loggedFor }))
                  }
                  onSave={(patch, opts) => void saveEntry(r.deliverable_id, patch, opts)}
                  onRetry={() => void retryEntry(r.deliverable_id)}
                  onCatchUpDone={() => void fetchWeek(week)}
                />
              ))}
                </>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
