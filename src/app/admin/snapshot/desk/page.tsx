"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SnapshotDeskClientView, SnapshotDeskWeeklyWin, SnapshotDeskWins, type DeskWeekWin } from "@/components/SnapshotDeskAccountViews";
import { SnapshotWeekDepartments } from "@/components/SnapshotWeekDepartments";
import { type SnapshotFillRowData } from "@/components/SnapshotFillRow";
import { SnapshotNavLinks } from "@/components/SnapshotNavLinks";
import { addWeeks, currentWeek, isCurrentWeek, weekLabel } from "@/lib/week";
import { teamLabelFor } from "@/lib/people";
import {
  fillCanSeeAll,
  fillFocusTeam,
  fillIsAccountManager,
  fillViewerSlug,
  visibleFillRows,
  winLoggedByMatches,
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
  const [week, setWeek] = useState(currentWeek());
  const [error, setError] = useState("");
  const [seeAll, setSeeAll] = useState(false);
  const [query, setQuery] = useState("");
  const [clientId, setClientId] = useState("all");
  const [groupView, setGroupView] = useState<Record<string, "week" | "wins" | "client">>({});
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
        setRows(data.rows || []);
        setWeekWins(data.wins || []);
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
    return [...map.values()];
  }, [searched]);

  return (
    <div className="ops-page snap-desk">
      <div className="page-actions">
        <SnapshotNavLinks />
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
          <p className="ops-sub">{scopeLabel}. Log your win on each account, then what each department did.</p>
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

      {winNeeded > 0 || scopedRows.length > 0 ? (
        <div className={`ads-pass-banner ${winNeeded === 0 ? "is-clear" : "is-work"}`}>
          <p className="ads-pass-banner-line">{winLine}</p>
        </div>
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
            {query.trim() ? "Nothing matches that search." : "Nothing in this list."}
          </p>
        </div>
      ) : (
        <div className="stack" style={{ gap: 18 }}>
          {groups.map((group) => {
            const view = groupView[group.id] || "week";
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
              ) : (
                <SnapshotWeekDepartments clientId={group.id} weekStart={week} />
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
