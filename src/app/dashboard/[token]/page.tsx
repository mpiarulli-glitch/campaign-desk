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

const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
  achieved: "Achieved",
};

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

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

function fmtKpi(value: number | null, fmt: string): string {
  if (value === null || Number.isNaN(value)) return "—";
  if (fmt === "currency") {
    return value.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: value >= 1000 ? 0 : 2,
    });
  }
  if (fmt === "percent") return `${(value * 100).toFixed(1)}%`;
  if (fmt === "multiple") return `${value.toFixed(2)}x`;
  return value.toLocaleString("en-US");
}

function fmtAt(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type Tab = "snapshot" | "schedule" | "calendar" | "goals";

export default function ClientDashboardPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("snapshot");

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
    <div className="app-shell snap-client">
      <header className="topbar">
        <Brand />
        <span className="snap-topbar-tag">Account dashboard</span>
      </header>

      <section className="snap-hero">
        <div className="snap-hero-inner">
          <p className="snap-hero-eyebrow">Your account, in one place</p>
          <h1 className="snap-hero-title">{data?.client.name || "Dashboard"}</h1>
          <p className="snap-hero-sub">Prepared by Marketing Empire Group</p>
        </div>
      </section>

      <main className="container stack" style={{ gap: 20 }}>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : error ? (
          <p className="error">{error}</p>
        ) : data ? (
          <>
            <div className="view-toggle">
              <button className={`view-toggle-btn ${tab === "snapshot" ? "is-on" : ""}`} onClick={() => setTab("snapshot")}>
                Snapshot
              </button>
              <button className={`view-toggle-btn ${tab === "schedule" ? "is-on" : ""}`} onClick={() => setTab("schedule")}>
                Schedule production
              </button>
              <button className={`view-toggle-btn ${tab === "calendar" ? "is-on" : ""}`} onClick={() => setTab("calendar")}>
                Campaign calendar
              </button>
              <button className={`view-toggle-btn ${tab === "goals" ? "is-on" : ""}`} onClick={() => setTab("goals")}>
                Account & goals
              </button>
            </div>

            {tab === "snapshot" ? (
              <div className="stack" style={{ gap: 20 }}>
                <section className="card card-pad stack" style={{ gap: 10 }}>
                  <h2 className="snap-section-title" style={{ margin: 0 }}>Production status</h2>
                  <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
                    {STATUS_LABEL[data.production.status]}
                  </p>
                  {data.production.window ? (
                    <p className="muted" style={{ margin: 0 }}>
                      {data.production.existingSend
                        ? `Booked for ${fmtDate(data.production.existingSend.sendDate)}`
                        : `Next window: ${fmtDate(data.production.window.start)} – ${fmtDate(data.production.window.end)}`}
                    </p>
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>
                      No production schedule configured for this account yet.
                    </p>
                  )}
                </section>

                <section className="card card-pad stack" style={{ gap: 10 }}>
                  <h2 className="snap-section-title" style={{ margin: 0 }}>Weekly snapshot</h2>
                  <p className="muted" style={{ margin: 0 }}>
                    {data.snapshot.overview.length
                      ? `${data.snapshot.overview.length} deliverable${data.snapshot.overview.length === 1 ? "" : "s"} tracked.`
                      : "No deliverables tracked yet."}
                  </p>
                  {data.snapshot.token ? (
                    <a className="btn btn-secondary btn-sm" href={`/snapshot/${data.snapshot.token}`}>
                      View full snapshot
                    </a>
                  ) : null}
                </section>

                <section className="card card-pad stack" style={{ gap: 10 }}>
                  <h2 className="snap-section-title" style={{ margin: 0 }}>Account data</h2>
                  <div className="kpi-grid">
                    {data.accountData.kpis.map((k) => (
                      <div key={k.key} className="kpi-tile">
                        <span className="kpi-label">{k.label}</span>
                        <span className="kpi-value">{fmtKpi(k.value, k.fmt)}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="card card-pad stack" style={{ gap: 10 }}>
                  <h2 className="snap-section-title" style={{ margin: 0 }}>Recent activity</h2>
                  {data.activity.length ? (
                    <div className="stack" style={{ gap: 8 }}>
                      {data.activity.map((a, i) => (
                        <div key={i} className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div>
                            <div style={{ fontSize: 14 }}>{a.summary}</div>
                            {a.detail ? <div className="muted" style={{ fontSize: 13 }}>{a.detail}</div> : null}
                          </div>
                          <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                            {fmtAt(a.at)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>No activity yet.</p>
                  )}
                </section>
              </div>
            ) : null}

            {tab === "schedule" ? (
              <div className="sched-main" style={{ width: "min(860px, 100%)", margin: "0 auto" }}>
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
              <div className="stack" style={{ gap: 20 }}>
                <section className="card card-pad stack" style={{ gap: 8 }}>
                  <h2 className="snap-section-title" style={{ margin: 0 }}>Account manager</h2>
                  <p style={{ margin: 0, fontSize: 15 }}>
                    {data.client.accountManager || "Not assigned yet"}
                  </p>
                </section>

                <section className="card card-pad stack" style={{ gap: 12 }}>
                  <h2 className="snap-section-title" style={{ margin: 0 }}>Business goals</h2>
                  {data.goals.length === 0 ? (
                    <p className="muted" style={{ margin: 0 }}>No goals set for this account yet.</p>
                  ) : (
                    data.goals.map((g) => (
                      <div key={g.id} className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 15 }}>{g.objective}</div>
                          {g.targetDate ? (
                            <div className="muted" style={{ fontSize: 13 }}>Target: {fmtDate(g.targetDate)}</div>
                          ) : null}
                        </div>
                        <span className="badge">{GOAL_STATUS_LABEL[g.status]}</span>
                      </div>
                    ))
                  )}
                </section>
              </div>
            ) : null}

            <footer className="snap-footer">Prepared by Marketing Empire Group</footer>
          </>
        ) : null}
      </main>
    </div>
  );
}
