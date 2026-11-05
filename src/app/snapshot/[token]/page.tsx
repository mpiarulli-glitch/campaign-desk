"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Brand } from "@/components/Brand";
import { PerfCharts, type MetricSeries } from "@/components/PerfCharts";
import { SNAPSHOT_DEPARTMENTS, isSnapshotDepartment } from "@/lib/snapshot-department-list";
import { addWeeks, currentWeek, isCurrentWeek, weekLabel } from "@/lib/week";

type Win = { id: string; body: string; happened_on: string; week_start?: string };

function formatClientWinDate(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
type DepartmentItem = { body: string; completed: boolean };
type DepartmentNote = { slug: string; label: string; items: DepartmentItem[] };

const DEPT_ACCENT: Record<string, string> = {
  lifecycle: "#04808d",
  social: "#1a6f9a",
  video: "#6b4c8a",
  web: "#1f7a4d",
  seo: "#8a6200",
  strategy: "#3d4a5c",
};

function departmentSlug(note: { slug?: string; label: string }): string {
  if (note.slug && isSnapshotDepartment(note.slug)) return note.slug;
  return SNAPSHOT_DEPARTMENTS.find((dept) => dept.label === note.label)?.slug || "strategy";
}

function updateCount(n: number): string {
  return n === 1 ? "1 update" : `${n} updates`;
}

function DeptMark({ slug }: { slug: string }) {
  const props = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  if (slug === "lifecycle") {
    return (
      <svg {...props}>
        <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
        <path d="m4 7 8 6 8-6" />
      </svg>
    );
  }
  if (slug === "social") {
    return (
      <svg {...props}>
        <circle cx="6.5" cy="12" r="2.2" />
        <circle cx="17" cy="7" r="2.2" />
        <circle cx="17" cy="17" r="2.2" />
        <path d="m8.6 11.2 6.2-3.1M8.6 12.8l6.2 3.1" />
      </svg>
    );
  }
  if (slug === "video") {
    return (
      <svg {...props}>
        <rect x="3" y="6.5" width="12" height="11" rx="2" />
        <path d="m15 10.5 5.5-2.8v8.6L15 13.5" />
      </svg>
    );
  }
  if (slug === "web") {
    return (
      <svg {...props}>
        <circle cx="12" cy="12" r="8" />
        <path d="M4 12h16" />
        <path d="M12 4c2.2 2.3 3.4 5 3.4 8s-1.2 5.7-3.4 8c-2.2-2.3-3.4-5-3.4-8s1.2-5.7 3.4-8" />
      </svg>
    );
  }
  if (slug === "seo") {
    return (
      <svg {...props}>
        <circle cx="11" cy="11" r="6" />
        <path d="m15.8 15.8 4 4" />
      </svg>
    );
  }
  return (
    <svg {...props}>
      <path d="M5 4.5h9.5L12 8.5 14.5 12.5H5z" />
      <path d="M5 4.5v15" />
    </svg>
  );
}

// "Aug 6, 2026" from a YYYY-MM-DD, without timezone drift.
function ymdLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type RevenueAsk = {
  month: string;
  label: string;
  amount: number | null;
  reportedAt: string;
};

// Strip everything but digits and one decimal point, so "$48,200" and "48200"
// and "48,200.50" all submit the same number.
function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!cleaned || (cleaned.match(/\./g) || []).length > 1) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function SnapshotClientPage() {
  const { token } = useParams<{ token: string }>();
  const [accountName, setAccountName] = useState("");
  const [launchDate, setLaunchDate] = useState<string | null>(null);
  const [departments, setDepartments] = useState<DepartmentNote[]>([]);
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
  const [revAsk, setRevAsk] = useState<RevenueAsk | null>(null);
  const [revInput, setRevInput] = useState("");
  const [revNote, setRevNote] = useState("");
  const [revSaving, setRevSaving] = useState(false);
  const [revError, setRevError] = useState("");
  // Set after they submit, so the panel can thank them without a reload, and so
  // an already-answered month can still be reopened to correct the figure.
  const [revEditing, setRevEditing] = useState(false);

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
          setLaunchDate(typeof data.account.launchDate === "string" ? data.account.launchDate : null);
          setDepartments(
            ((data.departments || []) as Array<{
              slug?: string;
              label: string;
              items: Array<string | DepartmentItem>;
            }>)
              .map((note) => ({
                slug: departmentSlug(note),
                label: note.label,
                items: (note.items || [])
                  .map((item) =>
                    typeof item === "string"
                      ? { body: item.trim(), completed: false }
                      : { body: (item.body || "").trim(), completed: Boolean(item.completed) }
                  )
                  .filter((item) => item.body),
              }))
              .filter((note) => note.items.length > 0)
          );
          setWins(data.wins || []);
          setMetrics(data.metrics || []);
          if (data.bounds) setBounds(data.bounds);
          setRevAsk(data.revenueAsk || null);
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

  async function submitRevenue(e: React.FormEvent) {
    e.preventDefault();
    if (!revAsk) return;
    const amount = parseMoney(revInput);
    if (amount === null) {
      setRevError("Enter the total as a number, like 48200.");
      return;
    }
    setRevSaving(true);
    setRevError("");
    try {
      const res = await fetch(`/api/snapshot/shared/${token}/revenue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: revAsk.month, amount, note: revNote }),
      });
      if (!res.ok) throw new Error("save failed");
      const data = await res.json();
      setRevAsk(data.ask || { ...revAsk, amount, reportedAt: new Date().toISOString() });
      setRevEditing(false);
      setRevNote("");
    } catch {
      setRevError("Could not send that. Try again.");
    } finally {
      setRevSaving(false);
    }
  }

  const glance = useMemo(() => {
    const headline = metrics.find((m) => m.points.length >= 2) || metrics.find((m) => m.points.length > 0);
    let headlineText: string | null = null;
    if (headline) {
      const pts = headline.points;
      const latest = pts[pts.length - 1].value;
      const firstV = pts[0].value;
      const pct = firstV !== 0 ? Math.round(((latest - firstV) / Math.abs(firstV)) * 100) : null;
      headlineText = pct !== null ? `${headline.metric} ${pct >= 0 ? "+" : ""}${pct}%` : headline.metric;
    }
    return { wins: wins.length, headlineText };
  }, [metrics, wins]);

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

  // Bounds are only enforced once the server has stated them, so the arrows are
  // never dead on the first paint. An account with no entries at all reports no
  // earliest week, which leaves back disabled because there is nothing behind.
  const canGoBack = !bounds.earliest || week > bounds.earliest;
  const canGoForward = !bounds.latest || week < bounds.latest;

  const hasMetrics = metrics.some((m) => m.points.length > 0);
  const weekWins = wins.filter((w) => w.week_start === week);
  const showWeekCallout = departments.length > 0 && weekWins.length > 0;
  const listedWins = showWeekCallout ? wins.filter((w) => w.week_start !== week) : wins;

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
            <header className="snap-hero">
              <div className="snap-hero-copy">
                <p className="snap-kicker">
                  Week of {weekLabel(week)}
                  {isCurrentWeek(week) ? " · Current" : ""}
                  {launchDate ? ` · Launched ${ymdLabel(launchDate)}` : ""}
                </p>
                <h1>{accountName || "Weekly snapshot"}</h1>
                <p className="snap-lede">
                  {glance.wins > 0 ? (
                    <>
                      <b>{glance.wins}</b> win{glance.wins === 1 ? "" : "s"}
                    </>
                  ) : (
                    <span>Your week with Marketing Empire Group</span>
                  )}
                  {glance.headlineText ? (
                    <>
                      <span className="snap-dot" aria-hidden="true">
                        ·
                      </span>
                      {glance.headlineText}
                    </>
                  ) : null}
                </p>
              </div>
              <div className="snap-week-nav" role="group" aria-label="Week">
                <button
                  type="button"
                  onClick={() => setWeek((w) => addWeeks(w, -1))}
                  disabled={!canGoBack}
                  title={canGoBack ? "Previous week" : "This is the first week we logged"}
                  aria-label="Previous week"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => setWeek(currentWeek())}
                  className="snap-week-today"
                >
                  This week
                </button>
                <button
                  type="button"
                  onClick={() => setWeek((w) => addWeeks(w, 1))}
                  disabled={!canGoForward}
                  title={canGoForward ? "Next week" : "This is the latest week"}
                  aria-label="Next week"
                >
                  ›
                </button>
              </div>
            </header>

            {/* WINS — up top */}
            {listedWins.length > 0 ? (
              <section className="snap-panel t-wins">
                <header className="snap-sec-head">
                  <h2>Wins</h2>
                </header>
                <div className="snap-wins2">
                  {listedWins.map((w) => (
                    <div key={w.id} className="snap-win2">
                      <div className="snap-win2-mark" aria-hidden="true">★</div>
                      <div>
                        <p>{w.body}</p>
                        {w.happened_on ? (
                          <span className="snap-win2-date">{formatClientWinDate(w.happened_on)}</span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {/* REVENUE ASK — first thing, while we have their attention */}
            {revAsk ? (
              <section className="snap-panel t-revenue">
                <header className="snap-sec-head">
                  <h2>Revenue · {revAsk.label}</h2>
                </header>
                {revAsk.amount !== null && !revEditing ? (
                  <div className="snap-rev-done">
                    <p>
                      Thanks. You told us <b>{money(revAsk.amount)}</b> for {revAsk.label}.
                    </p>
                    <button
                      className="snap-toggle"
                      onClick={() => {
                        setRevInput(String(revAsk.amount ?? ""));
                        setRevEditing(true);
                      }}
                    >
                      Change it
                    </button>
                  </div>
                ) : (
                  <form className="snap-rev-form" onSubmit={submitRevenue}>
                    <label className="snap-rev-field">
                      <span>Total revenue for {revAsk.label}</span>
                      <input
                        inputMode="decimal"
                        value={revInput}
                        onChange={(e) => setRevInput(e.target.value)}
                        placeholder="48,200"
                        aria-label={`Total revenue for ${revAsk.label}`}
                      />
                    </label>
                    <label className="snap-rev-field">
                      <span>Anything we should know? (optional)</span>
                      <input
                        value={revNote}
                        onChange={(e) => setRevNote(e.target.value)}
                        placeholder="Two big jobs closed late"
                      />
                    </label>
                    <button className="snap-rev-send" type="submit" disabled={revSaving}>
                      {revSaving ? "Sending..." : "Send"}
                    </button>
                  </form>
                )}
                {revError ? <p className="error" style={{ marginBottom: 0 }}>{revError}</p> : null}
              </section>
            ) : null}

            {departments.length > 0 ? (
              <section className="snap-panel t-work" id="this-week">
                <header className="snap-sec-head">
                  <h2>This week</h2>
                  <span className="snap-week-range">{weekLabel(week)}</span>
                </header>
                {showWeekCallout ? (
                  <div className="snap-week-callout">
                    {weekWins.map((w) => (
                      <div key={w.id} className="snap-week-win">
                        <div className="snap-week-win-mark" aria-hidden="true">
                          ★
                        </div>
                        <div>
                          <p className="snap-week-kicker">Win</p>
                          <p>{w.body}</p>
                          {w.happened_on ? (
                            <span className="snap-week-win-date">{formatClientWinDate(w.happened_on)}</span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="snap-week-grid">
                  {departments.map((note) => (
                    <article
                      key={note.slug}
                      className="snap-week-card"
                      style={{ ["--dept" as string]: DEPT_ACCENT[note.slug] || DEPT_ACCENT.strategy }}
                    >
                      <header className="snap-week-card-head">
                        <span className="snap-week-icon">
                          <DeptMark slug={note.slug} />
                        </span>
                        <div>
                          <h3>{note.label}</h3>
                          <p className="snap-week-count">{updateCount(note.items.length)}</p>
                        </div>
                      </header>
                      <ul className="snap-week-items">
                        {note.items.map((item, index) => (
                          <li key={`${note.slug}-${index}`}>
                            <span className="snap-week-mark">
                              {item.completed ? (
                                <span className="snap-check is-on" aria-label="Completed">
                                  ✓
                                </span>
                              ) : (
                                <span className="snap-week-dot" aria-hidden="true" />
                              )}
                            </span>
                            <span>{item.body}</span>
                          </li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {/* Performance */}
            {hasMetrics ? (
              <section className="snap-panel t-perf">
                <header className="snap-sec-head">
                  <h2>Performance</h2>
                </header>
                <PerfCharts series={metrics} />
              </section>
            ) : null}

            <footer className="snap-footer">
              Marketing Empire Group · Week of {weekLabel(week)}
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
