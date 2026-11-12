"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SnapshotDeskClientView, SnapshotDeskWeeklyWin, SnapshotDeskWins, type DeskWeekWin } from "@/components/SnapshotDeskAccountViews";
import { SnapshotWeekDepartments } from "@/components/SnapshotWeekDepartments";
import { type SnapshotFillRowData } from "@/components/SnapshotFillRow";
import { addWeeks, currentWeek, isCurrentWeek, weekLabel } from "@/lib/week";
import { canSeeFridayAsk, personTeam } from "@/lib/people";
import { fillViewerSlug, winLoggedByMatches, type FillViewer } from "@/lib/snapshot-fill";
import {
  snapshotScopeFromPayload,
  type SnapshotDepartmentSlug,
} from "@/lib/snapshot-department-list";

type DeskRow = SnapshotFillRowData & {
  client_id: string;
  client_name: string;
  launch_date: string | null;
  outreach_paused?: boolean;
};

type DeskAccount = {
  id: string;
  name: string;
  launch_date: string | null;
  outreach_paused: boolean;
};

export default function SnapshotDeskPage() {
  const router = useRouter();
  const [rows, setRows] = useState<DeskRow[]>([]);
  const [accounts, setAccounts] = useState<DeskAccount[]>([]);
  const [week, setWeek] = useState(currentWeek());
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [clientId, setClientId] = useState("all");
  const [groupView, setGroupView] = useState<Record<string, "week" | "wins" | "client">>({});
  const [viewer, setViewer] = useState<FillViewer>({ role: null, person: null, owner: false });
  const [viewerReady, setViewerReady] = useState(false);
  const [visibleDepartments, setVisibleDepartments] = useState<SnapshotDepartmentSlug[] | null>(
    null
  );
  const [scopeLine, setScopeLine] = useState<string | null>(null);
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
        setAccounts(data.accounts || []);
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
        const scope = snapshotScopeFromPayload(data.snapshotDepartments);
        setViewer({
          role: data.role,
          person: data.person || null,
          owner: Boolean(data.owner),
        });
        setScopeLine(scope.line);
        setVisibleDepartments(scope.filtered ? scope.departments : null);
      })
      .catch(() => {})
      .finally(() => setViewerReady(true));
  }, []);

  // Department sections follow the viewer's assignment. The owner, Friday-send
  // account managers, and anyone with no department still see every section.
  const clients = useMemo(() => {
    return [...accounts].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
  }, [accounts]);

  const visibleAccounts = useMemo(() => {
    const picked = clientId === "all" ? clients : clients.filter((a) => a.id === clientId);
    const q = query.trim().toLowerCase();
    if (!q) return picked;
    return picked.filter((account) => {
      if (account.name.toLowerCase().includes(q)) return true;
      return rows.some(
        (row) =>
          row.client_id === account.id &&
          (row.name.toLowerCase().includes(q) ||
            row.category.toLowerCase().includes(q) ||
            row.client_name.toLowerCase().includes(q))
      );
    });
  }, [clients, clientId, query, rows]);

  const viewerSlug = fillViewerSlug(viewer);
  const accountsMissingWin = useMemo(() => {
    const ids = visibleAccounts.map((account) => account.id);
    if (!viewerSlug) return new Set(ids);
    const have = new Set(
      weekWins
        .filter((w) => winLoggedByMatches(w.logged_by, viewerSlug))
        .map((w) => w.client_id)
    );
    return new Set(ids.filter((id) => !have.has(id)));
  }, [visibleAccounts, weekWins, viewerSlug]);
  const winNeeded = accountsMissingWin.size;
  const winLine =
    winNeeded === 0
      ? "Your weekly win is in on every account in this list."
      : `${winNeeded} account${winNeeded === 1 ? "" : "s"} still need your win this week.`;
  const scopeLabel = !viewerReady
    ? "Loading your list"
    : scopeLine || "Every department, on every account";

  const canOpenServices =
    viewer.owner ||
    viewer.role === "admin" ||
    personTeam(viewer.person) === "client_services" ||
    canSeeFridayAsk(viewer);

  const groups = useMemo(
    () =>
      visibleAccounts.map((account) => ({
        id: account.id,
        name: account.name,
        launch: account.launch_date,
        paused: account.outreach_paused,
      })),
    [visibleAccounts]
  );

  return (
    <div className="ops-page snap-desk">
      {canOpenServices ? (
        <div className="page-actions">
          <Link className="btn btn-ghost btn-sm" href="/admin/client-services">
            Client Services
          </Link>
        </div>
      ) : null}

      <div className="ops-page-head">
        <div>
          <p className="ops-eyebrow">Weekly snapshots</p>
          <h1 className="ops-title">This week</h1>
          <p className="ops-sub">{scopeLabel}</p>
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

      {winNeeded > 0 || accounts.length > 0 ? (
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

      {accounts.length > 8 ? (
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
      ) : accounts.length === 0 ? (
        <div className="empty">
          <p>No accounts on the snapshot roster yet.</p>
          <Link className="btn btn-sm" href="/admin/client-services">
            Open deliverable setup
          </Link>
        </div>
      ) : groups.length === 0 ? (
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
                onEdited={(win) =>
                  setWeekWins((cur) =>
                    cur.flatMap((row) =>
                      row.id !== win.id
                        ? [row]
                        : win.week_start && win.week_start !== week
                          ? []
                          : [{ ...row, body: win.body, happened_on: win.happened_on, logged_by: win.logged_by }]
                    )
                  )
                }
                onRemoved={(winId) => setWeekWins((cur) => cur.filter((row) => row.id !== winId))}
              />
              {view === "wins" ? (
                <SnapshotDeskWins clientId={group.id} weekStart={week} />
              ) : view === "client" ? (
                <SnapshotDeskClientView clientId={group.id} />
              ) : (
                <SnapshotWeekDepartments
                  clientId={group.id}
                  weekStart={week}
                  visibleDepartments={visibleDepartments}
                />
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
