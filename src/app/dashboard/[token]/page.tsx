"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Brand } from "@/components/Brand";
import { ScheduleBooking } from "@/components/ScheduleBooking";

type CycleStatus =
  | "not_configured"
  | "inactive"
  | "not_due"
  | "due"
  | "requested"
  | "scheduled"
  | "sent";

type Kpi = { key: string; label: string; fmt: string; hint: string | null; value: number | null };

type DeliverableOverview = {
  deliverable_id: string;
  category: string;
  name: string;
  status: string;
};

type Send = {
  id: string;
  title: string;
  send_date: string;
  send_time: string;
  status: string;
};

type ActivityItem = {
  kind: string;
  at: string;
  summary: string;
  detail: string;
};

type GoalStatus = "on_track" | "at_risk" | "off_track" | "achieved";
type Goal = { id: string; objective: string; targetDate: string | null; status: GoalStatus };

type DashboardData = {
  client: { id: string; name: string; accountManager: string };
  production: {
    window: { start: string; end: string } | null;
    status: CycleStatus;
    existingSend: { sendDate: string; status: string } | null;
  };
  snapshot: { token: string | null; overview: DeliverableOverview[] };
  accountData: { kpis: Kpi[] };
  calendar: Send[];
  activity: ActivityItem[];
  goals: Goal[];
  pendingApprovals: { id: string; title: string; external_token: string; updated_at: string }[];
};

const STATUS_LABEL: Record<CycleStatus, string> = {
  not_configured: "Not configured yet",
  inactive: "Account inactive",
  not_due: "Not due yet",
  due: "Ready to book",
  requested: "Requested — awaiting confirmation",
  scheduled: "Scheduled",
  sent: "Sent",
};

// Short arc-label + illustrative fill for a status that isn't a measured
// percentage (production windows and goal progress aren't ratios — only the
// snapshot arc uses a real computed number). The fill is a stylized "how far
// along" impression, never presented as an exact figure.
const PRODUCTION_ARC: Record<CycleStatus, { fill: number; label: string }> = {
  not_configured: { fill: 0, label: "—" },
  inactive: { fill: 0, label: "—" },
  not_due: { fill: 0.25, label: "Soon" },
  due: { fill: 0.55, label: "Due" },
  requested: { fill: 0.75, label: "Req'd" },
  scheduled: { fill: 0.9, label: "Booked" },
  sent: { fill: 1, label: "Sent" },
};

const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
  achieved: "Achieved",
};
const GOAL_ARC: Record<GoalStatus, { fill: number; label: string }> = {
  on_track: { fill: 0.7, label: "Track" },
  at_risk: { fill: 0.4, label: "Risk" },
  off_track: { fill: 0.15, label: "Off" },
  achieved: { fill: 1, label: "Done" },
};
const GOAL_PILL: Record<GoalStatus, string> = {
  on_track: "is-ember",
  at_risk: "is-ember",
  off_track: "is-muted",
  achieved: "is-good",
};

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

const ARC_R = 24;
const ARC_C = 2 * Math.PI * ARC_R;
function arcOffset(fill: number): number {
  return ARC_C * (1 - Math.max(0, Math.min(1, fill)));
}

function fmtDate(ymdStr: string): string {
  if (!ymdStr) return "—";
  const [y, m, d] = ymdStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtAt(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type Tab = "overview" | "schedule" | "calendar" | "goals";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "schedule", label: "Schedule production" },
  { key: "calendar", label: "Campaign calendar" },
  { key: "goals", label: "Account & goals" },
];

function Arc({
  fill,
  label,
  color,
}: {
  fill: number;
  label: string;
  color: string;
}) {
  return (
    <div className="acct-arc">
      <svg viewBox="0 0 56 56">
        <circle className="acct-arc-track" cx="28" cy="28" r={ARC_R} />
        <circle
          className="acct-arc-val"
          cx="28"
          cy="28"
          r={ARC_R}
          stroke={color}
          strokeDasharray={ARC_C}
          strokeDashoffset={arcOffset(fill)}
        />
      </svg>
      <span className="acct-arc-label">{label}</span>
    </div>
  );
}

export default function ClientDashboardPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/dashboard/${token}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (res.ok) setData(await res.json());
      else setError("Could not load your dashboard.");
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const byDay = useMemo(() => {
    const map = new Map<string, Send[]>();
    for (const s of data?.calendar || []) {
      const arr = map.get(s.send_date) || [];
      arr.push(s);
      map.set(s.send_date, arr);
    }
    return map;
  }, [data]);

  const monthsPresent = useMemo(() => {
    const set = new Set<string>();
    for (const s of data?.calendar || []) set.add(s.send_date.slice(0, 7));
    return Array.from(set).sort();
  }, [data]);

  const [calMonth, setCalMonth] = useState<string>("");
  useEffect(() => {
    if (monthsPresent.length && !monthsPresent.includes(calMonth)) {
      setCalMonth(monthsPresent[0]);
    }
  }, [monthsPresent, calMonth]);

  const calMonthIdx = monthsPresent.indexOf(calMonth);
  const [calYear, calMonthNum] = calMonth
    ? calMonth.split("-").map(Number)
    : [new Date().getFullYear(), new Date().getMonth() + 1];

  const cells = useMemo(() => {
    if (!calMonth) return [];
    const daysInMonth = new Date(calYear, calMonthNum, 0).getDate();
    const startWeekday = new Date(calYear, calMonthNum - 1, 1).getDay();
    const arr: (number | null)[] = [];
    for (let i = 0; i < startWeekday; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(d);
    return arr;
  }, [calMonth, calYear, calMonthNum]);

  const today = new Date();
  const todayYmdStr = ymd(today.getFullYear(), today.getMonth(), today.getDate());

  const snapshotDone = data?.snapshot.overview.filter((d) =>
    ["completed", "approved"].includes(d.status)
  ).length ?? 0;
  const snapshotTotal = data?.snapshot.overview.length ?? 0;
  const snapshotFraction = snapshotTotal ? snapshotDone / snapshotTotal : 0;

  const primaryGoal = data?.goals[0] ?? null;

  const visibleTabs = useMemo(
    () => TABS.filter((t) => t.key !== "schedule" || data?.production.status === "due"),
    [data]
  );
  useEffect(() => {
    if (tab === "schedule" && data && data.production.status !== "due") {
      setTab("overview");
    }
  }, [tab, data]);

  if (notFound) {
    return (
      <div className="login-wrap">
        <div className="card login-card">
          <h1>Link not found</h1>
          <p className="muted">This dashboard link is invalid or has been reset.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="acct-scope app-shell snap-client">
      <header className="topbar">
        <Brand />
        <span className="snap-topbar-tag">Account dashboard</span>
      </header>

      <section className="snap-hero">
        <div className="snap-hero-inner">
          <p className="snap-hero-eyebrow">Account standing</p>
          <h1 className="snap-hero-title">{data?.client.name || "Dashboard"}</h1>
          <p className="snap-hero-sub">Prepared by Marketing Empire Group</p>

          {data ? (
            <div className="acct-hero-standing">
              <div className="acct-standing-item">
                <Arc
                  fill={PRODUCTION_ARC[data.production.status].fill}
                  label={PRODUCTION_ARC[data.production.status].label}
                  color="#00d4e8"
                />
                <div className="acct-standing-copy">
                  <p className="k">Production</p>
                  <p className="v">
                    {STATUS_LABEL[data.production.status]}
                    {data.production.window ? (
                      <span> · {fmtDate(data.production.window.start)}</span>
                    ) : null}
                  </p>
                </div>
              </div>
              <div className="acct-standing-item">
                <Arc
                  fill={snapshotFraction}
                  label={snapshotTotal ? `${Math.round(snapshotFraction * 100)}%` : "—"}
                  color="#00d4e8"
                />
                <div className="acct-standing-copy">
                  <p className="k">Snapshot</p>
                  <p className="v">
                    {snapshotTotal ? "On track" : "Not tracked yet"}
                    {snapshotTotal ? <span> · {snapshotDone} of {snapshotTotal} done</span> : null}
                  </p>
                </div>
              </div>
              <div className="acct-standing-item">
                <Arc
                  fill={primaryGoal ? GOAL_ARC[primaryGoal.status].fill : 0}
                  label={primaryGoal ? GOAL_ARC[primaryGoal.status].label : "—"}
                  color="#d98b2b"
                />
                <div className="acct-standing-copy">
                  <p className="k">Goal</p>
                  <p className="v">
                    {primaryGoal ? primaryGoal.objective : "No goal set yet"}
                    {primaryGoal?.targetDate ? (
                      <span> · by {fmtDate(primaryGoal.targetDate)}</span>
                    ) : null}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <main>
        {loading ? (
          <p className="muted" style={{ textAlign: "center", padding: "40px 0" }}>
            Loading…
          </p>
        ) : error ? (
          <p className="error" style={{ textAlign: "center", padding: "40px 0" }}>
            {error}
          </p>
        ) : data ? (
          <div className="acct-report">
            <nav className="acct-rail">
              {visibleTabs.map((t) => (
                <button
                  key={t.key}
                  className={tab === t.key ? "is-current" : ""}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </nav>

            <main>
              {tab === "overview" ? (
                <div className="stack" style={{ gap: 40 }}>
                  {data.pendingApprovals.length ? (
                    <div className="acct-section">
                      <div className="acct-section-head">
                        <h2 className="acct-section-title">Needs your approval</h2>
                      </div>
                      <div className="stack" style={{ gap: 10 }}>
                        {data.pendingApprovals.map((c) => (
                          <div key={c.id} className="card card-pad row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                            <div>
                              <p style={{ margin: "0 0 2px", fontWeight: 600, fontSize: 15 }}>{c.title}</p>
                              <p className="muted" style={{ margin: 0, fontSize: 13 }}>Waiting on your review</p>
                            </div>
                            <a className="btn" href={`/review/${c.external_token}`}>
                              Review &amp; approve
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {data.production.status === "due" ? (
                    <div className="acct-section">
                      <div className="card card-pad row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <p style={{ margin: "0 0 4px", fontWeight: 600, fontSize: 15 }}>
                            Your next production window is open
                          </p>
                          {data.production.window ? (
                            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                              Pick any day from {fmtDate(data.production.window.start)} to {fmtDate(data.production.window.end)}.
                            </p>
                          ) : null}
                        </div>
                        <button className="btn" onClick={() => setTab("schedule")}>
                          Schedule my production
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className="acct-section">
                    <div className="acct-section-head">
                      <h2 className="acct-section-title">Weekly snapshot</h2>
                      {data.snapshot.token ? (
                        <a className="acct-section-link" href={`/snapshot/${data.snapshot.token}`}>
                          View full snapshot →
                        </a>
                      ) : null}
                    </div>
                    <div className="card card-pad">
                      <p style={{ margin: 0, fontSize: 14 }}>
                        {snapshotTotal
                          ? `${snapshotDone} of ${snapshotTotal} deliverables completed this period.`
                          : "No deliverables tracked yet."}
                      </p>
                    </div>
                  </div>

                  <div className="acct-section">
                    <div className="acct-section-head">
                      <h2 className="acct-section-title">Recent activity</h2>
                    </div>
                    <div className="card card-pad">
                      {data.activity.length ? (
                        data.activity.map((a, i) => (
                          <div
                            key={i}
                            className="row"
                            style={i > 0 ? { marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" } : undefined}
                          >
                            <div>
                              <div style={{ fontSize: 14 }}>{a.summary}</div>
                              {a.detail ? (
                                <div className="muted" style={{ fontSize: 13 }}>{a.detail}</div>
                              ) : null}
                            </div>
                            <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                              {fmtAt(a.at)}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="muted" style={{ margin: 0 }}>No activity yet.</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}

              {tab === "schedule" ? (
                <div className="sched-main" style={{ width: "min(860px, 100%)", margin: 0, padding: 0 }}>
                  <ScheduleBooking apiPath={`/api/dashboard/${token}/schedule`} />
                </div>
              ) : null}

              {tab === "calendar" ? (
                <div className="stack" style={{ gap: 12 }}>
                  {monthsPresent.length === 0 ? (
                    <div className="empty"><p>Nothing on the calendar right now.</p></div>
                  ) : (
                    <>
                      <div className="row" style={{ justifyContent: "center" }}>
                        <div className="cal-nav">
                          <button
                            className="cal-nav-btn"
                            disabled={calMonthIdx <= 0}
                            onClick={() => setCalMonth(monthsPresent[calMonthIdx - 1])}
                            aria-label="Previous month"
                          >
                            ‹
                          </button>
                          <span className="cal-month">
                            {calMonth ? `${MONTHS[calMonthNum - 1]} ${calYear}` : ""}
                          </span>
                          <button
                            className="cal-nav-btn"
                            disabled={calMonthIdx < 0 || calMonthIdx >= monthsPresent.length - 1}
                            onClick={() => setCalMonth(monthsPresent[calMonthIdx + 1])}
                            aria-label="Next month"
                          >
                            ›
                          </button>
                        </div>
                      </div>

                      <div className="cal-grid-wrap">
                        <div className="cal-grid">
                          {DOW.map((d) => (
                            <div key={d} className="cal-dow">{d}</div>
                          ))}
                          {cells.map((d, i) => {
                            if (d === null) return <div key={`b${i}`} className="cal-cell cal-empty" />;
                            const date = ymd(calYear, calMonthNum - 1, d);
                            const items = byDay.get(date) || [];
                            return (
                              <div
                                key={date}
                                className={`cal-cell ${date === todayYmdStr ? "cal-today" : ""}`}
                              >
                                <div className="cal-daynum">{d}</div>
                                <div className="cal-events">
                                  {items.map((s) => (
                                    <div key={s.id} className={`cal-chip chip-${s.status}`}>
                                      <span className="cal-chip-dot" />
                                      <span className="cal-chip-name">{s.title}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : null}

              {tab === "goals" ? (
                <div className="stack" style={{ gap: 40 }}>
                  <div className="acct-section">
                    <div className="acct-section-head">
                      <h2 className="acct-section-title">Account manager</h2>
                    </div>
                    <div className="card card-pad">
                      <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
                        {data.client.accountManager || "Not assigned yet"}
                      </p>
                    </div>
                  </div>

                  <div className="acct-section">
                    <div className="acct-section-head">
                      <h2 className="acct-section-title">Business goals</h2>
                    </div>
                    {data.goals.length === 0 ? (
                      <div className="empty"><p>No goals set for this account yet.</p></div>
                    ) : (
                      <div className="stack" style={{ gap: 12 }}>
                        {data.goals.map((g) => (
                          <div key={g.id} className="card card-pad acct-goal-card">
                            <div className="row" style={{ alignItems: "flex-start", marginBottom: 14 }}>
                              <div>
                                <p className="objective">{g.objective}</p>
                                {g.targetDate ? (
                                  <p className="target">Target: {fmtDate(g.targetDate)}</p>
                                ) : null}
                              </div>
                              <span className={`acct-pill ${GOAL_PILL[g.status]}`}>
                                {GOAL_STATUS_LABEL[g.status]}
                              </span>
                            </div>
                            <div className="acct-goal-track">
                              <div className="acct-goal-fill" style={{ width: `${GOAL_ARC[g.status].fill * 100}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </main>
          </div>
        ) : null}
      </main>

      <footer className="snap-footer">Prepared by Marketing Empire Group</footer>
    </div>
  );
}
