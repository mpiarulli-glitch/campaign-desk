"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SnapshotFillRow, type SnapshotFillRowData, type SnapshotFillSaveState } from "@/components/SnapshotFillRow";
import { addWeeks, currentWeek, isCurrentWeek, weekLabel } from "@/lib/week";
import { defaultLoggedForDate } from "@/lib/snapshot-entry-date";
import { teamLabelFor } from "@/lib/people";
import {
  fillCanSeeAll,
  fillCounts,
  fillFocusTeam,
  fillIsAccountManager,
  fillLane,
  fillPassSummary,
  filterFillRows,
  visibleFillRows,
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
  const [behindIds, setBehindIds] = useState<Set<string>>(new Set());
  const [week, setWeek] = useState(currentWeek());
  const [weekLoaded, setWeekLoaded] = useState("");
  const [error, setError] = useState("");
  const [fillFilter, setFillFilter] = useState<FillFilter>("todo");
  const [seeAll, setSeeAll] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [clientId, setClientId] = useState("all");
  const [saveState, setSaveState] = useState<Record<string, SnapshotFillSaveState>>({});
  const [failedPatch, setFailedPatch] = useState<Record<string, Partial<SnapshotFillRowData>>>({});
  const [loggedForByRow, setLoggedForByRow] = useState<Record<string, string>>({});
  const [viewer, setViewer] = useState<FillViewer>({ role: null, person: null, owner: false });
  const [viewerReady, setViewerReady] = useState(false);

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
        setRows(data.rows || []);
        setBehindIds(new Set(data.behindIds || []));
        setWeekLoaded(w);
        setSaveState({});
        setFailedPatch({});
        setLoggedForByRow({});
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

  const counts = fillCounts(clientScoped, behindIds);
  const filteredRows = filterFillRows(searched, fillFilter, behindIds);
  const passLine = fillPassSummary(counts, isCurrentWeek(week));
  const scopeLabel = !viewerReady
    ? "Loading your list"
    : isAm
      ? "All deliverables"
      : seeAll || !focusTeam
        ? "All teams"
        : `${teamLabelFor(focusTeam)} team`;

  const groups = useMemo(() => {
    const map = new Map<string, { id: string; name: string; launch: string | null; rows: DeskRow[] }>();
    for (const row of filteredRows) {
      let group = map.get(row.client_id);
      if (!group) {
        group = { id: row.client_id, name: row.client_name, launch: row.launch_date, rows: [] };
        map.set(row.client_id, group);
      }
      group.rows.push(row);
    }
    return [...map.values()];
  }, [filteredRows]);

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
    opts?: { loggedFor?: string }
  ) {
    setSaveState((s) => ({ ...s, [delivId]: "saving" }));
    const loggedFor = opts?.loggedFor ?? loggedForForRow(delivId);
    try {
      const res = await fetch("/api/snapshot/entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliverableId: delivId,
          weekStart: week,
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
        <Link className="btn btn-ghost btn-sm" href="/admin/client-services">
          Friday ask
        </Link>
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
          <p className="ops-sub">{scopeLabel}. Update every client from this list.</p>
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
        <div className={`ads-pass-banner ${counts.attention === 0 ? "is-clear" : "is-work"}`}>
          <p className="ads-pass-banner-line">{passLine}</p>
        </div>
      ) : null}

      {counts.total > 0 ? (
        <div className="snap-desk-filters" role="group" aria-label="Filter this week">
          <button type="button" className={fillFilter === "todo" ? "is-on" : undefined} onClick={() => setFillFilter("todo")}>
            Needs update <em>{counts.attention}</em>
          </button>
          <button type="button" className={fillFilter === "overdue" ? "is-on" : undefined} onClick={() => setFillFilter("overdue")}>
            Overdue <em>{counts.overdue}</em>
          </button>
          <button type="button" className={fillFilter === "done" ? "is-on" : undefined} onClick={() => setFillFilter("done")}>
            Logged <em>{counts.done}</em>
          </button>
          <button type="button" className={fillFilter === "all" ? "is-on" : undefined} onClick={() => setFillFilter("all")}>
            All <em>{counts.total}</em>
          </button>
        </div>
      ) : null}

      {clients.length > 1 ? (
        <div className="snap-desk-filters" role="group" aria-label="Filter by client">
          <button type="button" className={clientId === "all" ? "is-on" : undefined} onClick={() => setClientId("all")}>
            Every client
          </button>
          {clients.map((c) => (
            <button
              key={c.id}
              type="button"
              className={clientId === c.id ? "is-on" : undefined}
              onClick={() => setClientId(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
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
      ) : filteredRows.length === 0 ? (
        <div className="empty">
          <p>
            {query.trim()
              ? "Nothing matches that search."
              : fillFilter === "todo"
                ? "Clear — nothing left to update in this view."
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
          {groups.map((group) => (
            <div key={group.id} className="snap-n-db">
              <div className="snap-n-group">
                <Link href={`/admin/snapshot/${group.id}`}>{group.name}</Link>
                <span>{group.rows.length} {group.rows.length === 1 ? "item" : "items"}</span>
              </div>
              <div className="snap-n-cols snap-n-head" aria-hidden="true">
                <span>Deliverable</span>
                <span>Category</span>
                <span>Status</span>
                <span>Period</span>
                <span />
              </div>
              {group.rows.map((r) => (
                <SnapshotFillRow
                  key={r.deliverable_id}
                  row={r}
                  viewWeek={week}
                  loggedFor={loggedForForRow(r.deliverable_id)}
                  overdue={behindIds.has(r.deliverable_id)}
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
