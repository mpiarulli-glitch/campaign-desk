"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Brand } from "@/components/Brand";
import { PerfCharts, type MetricSeries } from "@/components/PerfCharts";
import { addWeeks, currentWeek, isCurrentWeek, weekLabel } from "@/lib/week";

type Win = { id: string; body: string; happened_on: string };

type Status = "not_started" | "in_progress" | "completed" | "shared" | "approved";
const STATUS_LABEL: Record<Status, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
  shared: "Shared",
  approved: "Approved",
};

type Row = {
  deliverable_id: string;
  category: string;
  name: string;
  cadence: string;
  status: Status;
  work_done: string;
  next_steps: string;
  notes: string;
};

function groupByCategory(rows: Row[]): [string, Row[]][] {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.category.trim() || "Other";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return Array.from(map.entries());
}

function hasUpdate(r: Row): boolean {
  return (
    r.status !== "not_started" ||
    !!r.work_done.trim() ||
    !!r.next_steps.trim() ||
    !!r.notes.trim()
  );
}

export default function SnapshotClientPage() {
  const { token } = useParams<{ token: string }>();
  const [accountName, setAccountName] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [wins, setWins] = useState<Win[]>([]);
  const [metrics, setMetrics] = useState<MetricSeries[]>([]);
  const [week, setWeek] = useState(currentWeek());
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(
    async (w: string) => {
      setLoading(true);
      const res = await fetch(`/api/snapshot/shared/${token}?week=${w}`);
      if (res.status === 404) { setNotFound(true); setLoading(false); return; }
      if (res.ok) {
        const data = await res.json();
        setAccountName(data.account.name);
        setRows(data.rows || []);
        setWins(data.wins || []);
        setMetrics(data.metrics || []);
      }
      setLoading(false);
    },
    [token]
  );

  useEffect(() => { load(week); }, [week, load]);

  if (notFound) {
    return (
      <div className="login-wrap">
        <div className="card login-card">
          <h1>Link not found</h1>
          <p className="muted">This snapshot link is invalid or has been reset.</p>
        </div>
      </div>
    );
  }

  const grouped = groupByCategory(rows);
  const anyUpdates = rows.some(hasUpdate);

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand />
        {accountName ? <span className="snap-client-name">{accountName}</span> : null}
      </header>

      <main className="container container-wide stack">
        <div className="cal-header">
          <div>
            <p className="eyebrow">Weekly snapshot</p>
            <h1 className="h1">{accountName || "Account snapshot"}</h1>
          </div>
          <div className="cal-nav">
            <button className="cal-nav-btn" onClick={() => setWeek((w) => addWeeks(w, -1))}>‹</button>
            <span className="cal-month">
              {weekLabel(week)}{isCurrentWeek(week) ? " · This week" : ""}
            </span>
            <button className="cal-nav-btn" onClick={() => setWeek((w) => addWeeks(w, 1))}>›</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setWeek(currentWeek())}>This week</button>
          </div>
        </div>

        {loading ? (
          <p className="muted">Loading...</p>
        ) : (
          <>
            <div className="stack" style={{ gap: 18 }}>
              <h2 className="snap-section-title">This week&apos;s work</h2>
              {rows.length === 0 ? (
                <div className="empty"><p>No deliverables set up yet.</p></div>
              ) : !anyUpdates ? (
                <div className="empty"><p>No updates logged for this week yet.</p></div>
              ) : (
                grouped.map(([category, catRows]) => {
                  const updated = catRows.filter(hasUpdate);
                  if (updated.length === 0) return null;
                  return (
                    <div key={category} className="snap-group">
                      <div className="snap-cat">{category}</div>
                      <div className="stack" style={{ gap: 10 }}>
                        {updated.map((r) => (
                          <div key={r.deliverable_id} className="snap-card">
                            <div className="snap-card-head">
                              <div>
                                <div className="snap-name">{r.name}</div>
                                {r.cadence ? <div className="snap-cadence">{r.cadence}</div> : null}
                              </div>
                              <span className={`snap-pill status-${r.status}`}>
                                {STATUS_LABEL[r.status]}
                              </span>
                            </div>
                            {r.work_done.trim() ? (
                              <div className="snap-ro">
                                <span className="snap-ro-label">What we did</span>
                                <p>{r.work_done}</p>
                              </div>
                            ) : null}
                            {r.next_steps.trim() ? (
                              <div className="snap-ro">
                                <span className="snap-ro-label">Next steps</span>
                                <p>{r.next_steps}</p>
                              </div>
                            ) : null}
                            {r.notes.trim() ? (
                              <div className="snap-ro">
                                <span className="snap-ro-label">Notes</span>
                                <p>{r.notes}</p>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {wins.length > 0 ? (
              <div className="stack" style={{ gap: 10 }}>
                <h2 className="snap-section-title">Wins</h2>
                <div className="snap-wins">
                  {wins.map((w) => (
                    <div key={w.id} className="snap-win">
                      <span className="snap-win-mark" aria-hidden="true">🏆</span>
                      <div>
                        <p>{w.body}</p>
                        {w.happened_on ? <span className="snap-win-date">{w.happened_on}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {metrics.some((m) => m.points.length > 0) ? (
              <div className="stack" style={{ gap: 10 }}>
                <h2 className="snap-section-title">Performance</h2>
                <PerfCharts series={metrics} />
              </div>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
