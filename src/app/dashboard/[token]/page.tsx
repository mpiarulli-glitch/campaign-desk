"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Brand } from "@/components/Brand";
import { CalendarTypeFilter, CalendarViewToggle } from "@/components/CalendarTypeFilter";
import { ScheduleBooking } from "@/components/ScheduleBooking";
import { sendMatchesTypeFilter, type CalendarTypeKey } from "@/lib/calendar-type-filter";
import { type Workboard } from "@/components/WorkTower";

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
  asset_type: string;
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
  workboard: Workboard;
  highlights: {
    approvalsPending: number;
    completedThisWeek: number;
    wins: number;
    deliverablesDone: number;
    deliverablesTotal: number;
  };
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
  if (!y || !m || !d) return "—";
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtTime(hhmm: string): string {
  if (!hhmm) return "";
  const h = Number(hhmm.split(":")[0]);
  if (Number.isNaN(h)) return "";
  const period = h >= 12 ? "PM" : "AM";
  return `${h % 12 === 0 ? 12 : h % 12} ${period}`;
}

function fmtListDay(ymdStr: string): string {
  const [y, m, d] = ymdStr.split("-").map(Number);
  if (!y || !m || !d) return ymdStr;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

const ASSET_TYPE_LABEL: Record<string, string> = {
  social_post: "Social post",
  social_video_carousel: "Video",
  email_campaign: "Email",
  crm_automation: "SMS",
  blog_post: "Blog",
};

// Trimmed 2026-07-31 to four things and nothing else: the campaign calendar,
// approvals waiting on the client, the weekly snapshot, and a way to request a
// production. Overview carries the approvals and the snapshot.
//
// Retired here: the live workroom, account & goals, and messages. Their data
// still comes back from /api/dashboard/[token] and the components are in git
// history, so any of them can be restored without a rebuild.
type Tab = "overview" | "schedule" | "calendar";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "calendar", label: "Campaign calendar" },
  { key: "schedule", label: "Request a production" },
];

export default function ClientDashboardPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [typeFilter, setTypeFilter] = useState<CalendarTypeKey[]>([]);
  const [view, setView] = useState<"calendar" | "list">("calendar");

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

  const visibleSends = useMemo(
    () => (data?.calendar || []).filter((s) => sendMatchesTypeFilter(s.asset_type, typeFilter)),
    [data, typeFilter]
  );

  const byDay = useMemo(() => {
    const map = new Map<string, Send[]>();
    for (const s of visibleSends) {
      const arr = map.get(s.send_date) || [];
      arr.push(s);
      map.set(s.send_date, arr);
    }
    return map;
  }, [visibleSends]);

  const monthsPresent = useMemo(() => {
    const set = new Set<string>();
    for (const s of visibleSends) set.add(s.send_date.slice(0, 7));
    return Array.from(set).sort();
  }, [visibleSends]);

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

  const listGroups = useMemo(() => {
    if (!calMonth) return [];
    return [...byDay.entries()]
      .filter(([date]) => date.startsWith(calMonth))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [byDay, calMonth]);

  const today = new Date();
  const todayYmdStr = ymd(today.getFullYear(), today.getMonth(), today.getDate());

  const snapshotDone = data?.snapshot.overview.filter((d) =>
    ["completed", "approved"].includes(d.status)
  ).length ?? 0;
  const snapshotTotal = data?.snapshot.overview.length ?? 0;

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
            <div className="acct-hero-metrics">
              <div className={`acct-metric${data.highlights.approvalsPending > 0 ? " is-action" : ""}`}>
                <span className="n">{data.highlights.approvalsPending}</span>
                <span className="l">Approval{data.highlights.approvalsPending === 1 ? "" : "s"} pending</span>
              </div>
              <div className="acct-metric">
                <span className="n">{data.highlights.completedThisWeek}</span>
                <span className="l">Completed this week</span>
              </div>
              <div className="acct-metric">
                <span className="n">{data.highlights.wins}</span>
                <span className="l">Win{data.highlights.wins === 1 ? "" : "s"} logged</span>
              </div>
              <div className="acct-metric">
                <span className="n">
                  {data.highlights.deliverablesTotal
                    ? `${data.highlights.deliverablesDone}/${data.highlights.deliverablesTotal}`
                    : "—"}
                </span>
                <span className="l">Deliverables done</span>
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

                </div>
              ) : null}

              {tab === "schedule" ? (
                <div className="sched-main" style={{ width: "min(860px, 100%)", margin: 0, padding: 0 }}>
                  <ScheduleBooking apiPath={`/api/dashboard/${token}/schedule`} />
                </div>
              ) : null}

              {tab === "calendar" ? (
                <div className="stack" style={{ gap: 12 }}>
                  {(data?.calendar || []).length > 0 ? (
                    <div className="row" style={{ justifyContent: "center" }}>
                      <CalendarTypeFilter selected={typeFilter} onChange={setTypeFilter} />
                      <CalendarViewToggle view={view} onChange={setView} />
                    </div>
                  ) : null}
                  {monthsPresent.length === 0 ? (
                    <div className="empty">
                      <p>
                        {typeFilter.length
                          ? "Nothing of those types on the calendar. Try All, or pick a different combination."
                          : "Nothing on the calendar right now."}
                      </p>
                    </div>
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

                      {view === "list" ? (
                        <div className="cal-list is-plain">
                          <div className="cal-list-head" aria-hidden="true">
                            <span>Date</span>
                            <span>Time</span>
                            <span>Type</span>
                            <span>Title</span>
                          </div>
                          {listGroups.flatMap(([date, items]) =>
                            items.map((s) => (
                              <div key={s.id} className="cal-list-row is-static">
                                <span className="cal-list-date">{fmtListDay(date)}</span>
                                <span className="cal-list-time">
                                  {s.send_time ? fmtTime(s.send_time) : "—"}
                                </span>
                                <span className="cal-list-type">
                                  {s.asset_type
                                    ? ASSET_TYPE_LABEL[s.asset_type] || s.asset_type
                                    : "—"}
                                </span>
                                <span className="cal-list-title">{s.title}</span>
                              </div>
                            ))
                          )}
                        </div>
                      ) : (
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
                      )}
                    </>
                  )}
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
