"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
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

type Overview = {
  deliverable_id: string;
  category: string;
  name: string;
  cadence: string;
  kind: "recurring" | "one_time";
  status: Status;
  worked_ever: boolean;
  last_work_done: string;
  last_activity_week: string;
  completed_on: string;
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
  const [overview, setOverview] = useState<Overview[]>([]);
  const [wins, setWins] = useState<Win[]>([]);
  const [metrics, setMetrics] = useState<MetricSeries[]>([]);
  const [week, setWeek] = useState(currentWeek());
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (w: string) => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/snapshot/shared/${token}?week=${w}`);
        if (res.status === 404) { setNotFound(true); return; }
        if (res.ok) {
          const data = await res.json();
          setAccountName(data.account.name);
          setRows(data.rows || []);
          setOverview(data.overview || []);
          setWins(data.wins || []);
          setMetrics(data.metrics || []);
        }
      } catch {
        setError("Network error. Check your connection and try again.");
      } finally {
        setLoading(false);
      }
    },
    [token]
  );

  useEffect(() => { load(week); }, [week, load]);

  const updatedRows = useMemo(() => rows.filter(hasUpdate), [rows]);

  // At-a-glance figures for the report header.
  const glance = useMemo(() => {
    const delivered = updatedRows.filter((r) => r.status === "completed" || r.status === "approved").length;
    const active = updatedRows.filter((r) => r.status === "in_progress" || r.status === "shared").length;
    const headline = metrics.find((m) => m.points.length >= 2) || metrics.find((m) => m.points.length > 0);
    let headlineText: string | null = null;
    if (headline) {
      const pts = headline.points;
      const latest = pts[pts.length - 1].value;
      const firstV = pts[0].value;
      const pct = firstV !== 0 ? Math.round(((latest - firstV) / Math.abs(firstV)) * 100) : null;
      headlineText = pct !== null ? `${headline.metric} ${pct >= 0 ? "+" : ""}${pct}%` : headline.metric;
    }
    return { delivered, active, wins: wins.length, headlineText };
  }, [updatedRows, metrics, wins]);

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
  const anyUpdates = updatedRows.length > 0;

  // Ongoing contracted work, grouped by category; completed one-time setup
  // items are pulled out and shown at the very bottom.
  const setupDone = overview.filter((o) => o.kind === "one_time" && !!o.completed_on);
  const ongoing = overview.filter((o) => !(o.kind === "one_time" && o.completed_on));
  const ongoingGroups = (() => {
    const map = new Map<string, Overview[]>();
    for (const o of ongoing) {
      const key = o.category.trim() || "Other";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(o);
    }
    return Array.from(map.entries());
  })();
  const hasMetrics = metrics.some((m) => m.points.length > 0);

  return (
    <div className="app-shell snap-client">
      <header className="topbar">
        <Brand />
        <span className="snap-topbar-tag">Client snapshot</span>
      </header>

      {/* Report cover */}
      <section className="snap-hero">
        <div className="snap-hero-inner">
          <div className="snap-hero-top">
            <div>
              <p className="snap-hero-eyebrow">Weekly snapshot</p>
              <h1 className="snap-hero-title">{accountName || "Account snapshot"}</h1>
              <p className="snap-hero-sub">
                Week of {weekLabel(week)}
                {isCurrentWeek(week) ? " · current week" : ""} · prepared by Marketing Empire Group
              </p>
            </div>
            <div className="snap-hero-nav">
              <button onClick={() => setWeek((w) => addWeeks(w, -1))} aria-label="Previous week">‹</button>
              <button onClick={() => setWeek(currentWeek())} className="snap-hero-today">This week</button>
              <button onClick={() => setWeek((w) => addWeeks(w, 1))} aria-label="Next week">›</button>
            </div>
          </div>

          {!loading || accountName ? (
            <div className="snap-glance">
              <div className="snap-chip"><span className="snap-chip-n">{glance.delivered}</span> delivered this week</div>
              <div className="snap-chip"><span className="snap-chip-n">{glance.active}</span> in progress</div>
              <div className="snap-chip"><span className="snap-chip-n">{glance.wins}</span> wins</div>
              {glance.headlineText ? (
                <div className="snap-chip snap-chip-accent">{glance.headlineText}</div>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <main className="container stack" style={{ gap: 30 }}>
        {loading && !accountName ? (
          <p className="muted">Loading...</p>
        ) : error && !accountName ? (
          <p className="error">{error}</p>
        ) : (
          <>
            <section className="stack" style={{ gap: 14 }}>
              <h2 className="snap-section-title">This week&apos;s work</h2>
              {rows.length === 0 ? (
                <div className="empty"><p>No deliverables set up yet.</p></div>
              ) : !anyUpdates ? (
                <div className="empty"><p>No updates logged for this week yet. Check back soon.</p></div>
              ) : (
                grouped.map(([category, catRows]) => {
                  const updated = catRows.filter(hasUpdate);
                  if (updated.length === 0) return null;
                  return (
                    <div key={category} className="snap-group">
                      <div className="snap-cat">
                        <span>{category}</span>
                        <span className="snap-cat-count">{updated.length}</span>
                      </div>
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
                            <div className="snap-ro-grid">
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
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </section>

            {overview.length > 0 ? (
              <section className="stack" style={{ gap: 14 }}>
                <h2 className="snap-section-title">Contracted deliverables</h2>
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  Everything in your agreement and where each item stands.
                </p>
                {ongoingGroups.map(([category, items]) => (
                  <div key={category} className="snap-group">
                    <div className="snap-cat">
                      <span>{category}</span>
                      <span className="snap-cat-count">{items.length}</span>
                    </div>
                    <div className="stack" style={{ gap: 10 }}>
                      {items.map((o) => (
                        <div key={o.deliverable_id} className="snap-card">
                          <div className="snap-card-head">
                            <div>
                              <div className="snap-name">{o.name}</div>
                              {o.cadence ? <div className="snap-cadence">{o.cadence}</div> : null}
                            </div>
                            <span className={`snap-pill status-${o.status}`}>
                              {STATUS_LABEL[o.status]}
                            </span>
                          </div>
                          <div className="snap-deliv-meta">
                            {o.worked_ever ? "Work in progress" : "Not started yet"}
                            {o.worked_ever && o.last_work_done ? ` · ${o.last_work_done}` : ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {setupDone.length > 0 ? (
                  <div className="snap-group">
                    <div className="snap-cat">
                      <span>Setup &amp; one-time work</span>
                      <span className="snap-cat-count">{setupDone.length}</span>
                    </div>
                    <div className="stack" style={{ gap: 10 }}>
                      {setupDone.map((o) => (
                        <div key={o.deliverable_id} className="snap-card snap-card-done">
                          <div className="snap-card-head">
                            <div>
                              <div className="snap-name">{o.name}</div>
                              {o.cadence ? <div className="snap-cadence">{o.cadence}</div> : null}
                            </div>
                            <span className="snap-pill status-completed">Completed</span>
                          </div>
                          <div className="snap-deliv-meta">
                            Completed · week of {weekLabel(o.completed_on)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            {wins.length > 0 ? (
              <section className="stack" style={{ gap: 14 }}>
                <h2 className="snap-section-title">Wins</h2>
                <div className="snap-wins">
                  {wins.map((w) => (
                    <div key={w.id} className="snap-win">
                      <span className="snap-win-mark" aria-hidden="true">★</span>
                      <div>
                        <p>{w.body}</p>
                        {w.happened_on ? <span className="snap-win-date">{w.happened_on}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {hasMetrics ? (
              <section className="stack" style={{ gap: 14 }}>
                <h2 className="snap-section-title">Performance</h2>
                <PerfCharts series={metrics} />
              </section>
            ) : null}

            <footer className="snap-footer">
              Prepared by Marketing Empire Group · Week of {weekLabel(week)}
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
