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

const ICONS: Record<string, React.ReactNode> = {
  wins: (
    <>
      <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0z" />
      <path d="M5 4H3v1.5a3 3 0 0 0 3 3M19 4h2v1.5a3 3 0 0 1-3 3" />
    </>
  ),
  work: (
    <>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </>
  ),
  deliv: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M9 13h6M9 17h6" />
    </>
  ),
  perf: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-4 3 3 5-6" />
    </>
  ),
};
function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}

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
  // How far the week picker may move. Empty until the first load answers.
  const [bounds, setBounds] = useState<{ earliest: string; latest: string }>({
    earliest: "",
    latest: "",
  });
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
          if (data.bounds) setBounds(data.bounds);
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

  // Bounds are only enforced once the server has stated them, so the arrows are
  // never dead on the first paint. An account with no entries at all reports no
  // earliest week, which leaves back disabled because there is nothing behind.
  const canGoBack = !bounds.earliest || week > bounds.earliest;
  const canGoForward = !bounds.latest || week < bounds.latest;

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

      <main className="snap-wrap">
        {loading && !accountName ? (
          <p className="muted">Loading...</p>
        ) : error && !accountName ? (
          <p className="error">{error}</p>
        ) : (
          <>
            {/* Hero */}
            <div className="snap-head-row">
              <div className="hq-hero" style={{ marginBottom: 0 }}>
                <p className="ops-eyebrow">Weekly snapshot · Week of {weekLabel(week)}{isCurrentWeek(week) ? " · current" : ""}</p>
                <h1>{accountName || "Account snapshot"}</h1>
                <p>
                  <b>{glance.delivered}</b> delivered this week, <b>{glance.active}</b> in progress
                  {glance.wins > 0 ? <>, and <b>{glance.wins} win{glance.wins === 1 ? "" : "s"}</b> to celebrate.</> : "."}
                  {" "}Prepared by Marketing Empire Group.
                </p>
              </div>
              <div className="snap-week-nav">
                <button
                  onClick={() => setWeek((w) => addWeeks(w, -1))}
                  disabled={!canGoBack}
                  title={canGoBack ? "Previous week" : "This is the first week we logged"}
                  aria-label="Previous week"
                >
                  ‹
                </button>
                <button onClick={() => setWeek(currentWeek())} className="snap-week-today">This week</button>
                <button
                  onClick={() => setWeek((w) => addWeeks(w, 1))}
                  disabled={!canGoForward}
                  title={canGoForward ? "Next week" : "This is the latest week"}
                  aria-label="Next week"
                >
                  ›
                </button>
              </div>
            </div>

            {/* Pulse bar */}
            <div className="hq-pulse">
              <div className="hq-pulse-item"><span className="hq-pulse-dot" style={{ background: "#1f9d63" }} /><span className="n">{glance.delivered}</span><span className="l">delivered</span></div>
              <div className="hq-pulse-item"><span className="hq-pulse-dot" style={{ background: "#04808d" }} /><span className="n">{glance.active}</span><span className="l">in progress</span></div>
              <div className="hq-pulse-item"><span className="hq-pulse-dot" style={{ background: "#b8820b" }} /><span className="n">{glance.wins}</span><span className="l">wins</span></div>
              {glance.headlineText ? (
                <div className="hq-pulse-item"><span className="hq-pulse-dot" style={{ background: "#3f5bd6" }} /><span className="n" style={{ fontSize: 14 }}>{glance.headlineText}</span></div>
              ) : null}
            </div>

            {/* WINS — up top */}
            {wins.length > 0 ? (
              <section className="snap-panel t-wins">
                <div className="snap-panel-head">
                  <span className="hq-icon"><Icon name="wins" /></span>
                  <div><h3 className="hq-card-title">Wins</h3><p className="hq-card-desc">Highlights worth celebrating</p></div>
                </div>
                <div className="hq-divider" />
                <div className="snap-wins2">
                  {wins.map((w) => (
                    <div key={w.id} className="snap-win2">
                      <span className="snap-win2-mark" aria-hidden="true">★</span>
                      <div>
                        <p>{w.body}</p>
                        {w.happened_on ? <span className="snap-win2-date">{w.happened_on}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {/* This week's work */}
            <section className="snap-panel t-work">
              <div className="snap-panel-head">
                <span className="hq-icon"><Icon name="work" /></span>
                <div><h3 className="hq-card-title">This week&apos;s work</h3><p className="hq-card-desc">What we moved on this week</p></div>
              </div>
              <div className="hq-divider" />
              {rows.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>No deliverables set up yet.</p>
              ) : !anyUpdates ? (
                <p className="muted" style={{ margin: 0 }}>No updates logged for this week yet. Check back soon.</p>
              ) : (
                <div className="stack" style={{ gap: 18 }}>
                  {grouped.map(([category, catRows]) => {
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
                  })}
                </div>
              )}
            </section>

            {/* Contracted deliverables */}
            {overview.length > 0 ? (
              <section className="snap-panel t-deliv">
                <div className="snap-panel-head">
                  <span className="hq-icon"><Icon name="deliv" /></span>
                  <div><h3 className="hq-card-title">Contracted deliverables</h3><p className="hq-card-desc">Everything in your agreement and where it stands</p></div>
                </div>
                <div className="hq-divider" />
                <div className="stack" style={{ gap: 18 }}>
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
                </div>
              </section>
            ) : null}

            {/* Performance */}
            {hasMetrics ? (
              <section className="snap-panel t-perf">
                <div className="snap-panel-head">
                  <span className="hq-icon"><Icon name="perf" /></span>
                  <div><h3 className="hq-card-title">Performance</h3><p className="hq-card-desc">The numbers behind the work</p></div>
                </div>
                <div className="hq-divider" />
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
