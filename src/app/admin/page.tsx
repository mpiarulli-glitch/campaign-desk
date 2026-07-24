"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand } from "@/components/Brand";
import { NavMenu } from "@/components/NavMenu";
import { StatusBadge } from "@/components/StatusBadge";
import { ActivitySidebar } from "@/components/ActivitySidebar";
import { currentWeek } from "@/lib/week";

type Attention = {
  id: string;
  title: string;
  client_name: string;
  status: string;
  open_comments: number;
  updated_at: string;
};
type Send = {
  id: string;
  title: string;
  client_name: string;
  send_date: string;
  send_time: string;
  status: string;
  requested_by_client: number;
};
type ProdDue = { id: string; name: string; window_start: string; window_end: string };

type Summary = {
  today: string;
  campaigns: {
    total: number;
    inReview: number;
    needsChanges: number;
    draft: number;
    approvedThisWeek: number;
    openComments: number;
    attention: Attention[];
  };
  calendar: { upcomingCount: number; clientRequests: number; next: Send[] };
  production: { dueCount: number; requestedCount: number; due: ProdDue[] };
  revenue: {
    activeClients: number;
    totalRevenue: number;
    totalAgencyMargin: number;
    blendedRoi: number | null;
  };
  snapshots: { accounts: number };
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
});

function money(n: number): string {
  return n >= 1000
    ? `$${Math.round(n).toLocaleString()}`
    : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function shortDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function AdminHomePage() {
  const router = useRouter();
  const [role, setRole] = useState<"admin" | "forecast" | null>(null);
  const [checkingRole, setCheckingRole] = useState(true);

  useEffect(() => {
    fetch("/api/auth")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.authenticated) {
          router.push("/login");
          return;
        }
        setRole(data.role);
        setCheckingRole(false);
      })
      .catch(() => setCheckingRole(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (checkingRole) {
    return (
      <div className="ops-scope">
        <div className="ops-page"><p className="muted">Loading…</p></div>
      </div>
    );
  }

  return role === "forecast" ? <TeamMemberHome /> : <AdminHome />;
}

function AdminHome() {
  const router = useRouter();
  const [s, setS] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/dashboard");
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        if (!res.ok) {
          setError("Could not load your dashboard.");
          return;
        }
        setS(await res.json());
      } catch {
        setError("Network error. Check your connection and try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  // Count of things that genuinely need a person to act.
  const toDo = s
    ? s.campaigns.inReview +
      s.campaigns.needsChanges +
      s.production.dueCount +
      s.calendar.clientRequests
    : 0;

  return (
    <div className="ops-scope">
      <header className="topbar">
        <Brand href="/admin" />
        <div className="row" style={{ gap: 10 }}>
          <Link className="btn" href="/admin/new">+ New campaign</Link>
          <NavMenu current="/admin" />
        </div>
      </header>

      <div className="ops-page">
        <div className="ops-page-head">
          <div>
            <p className="ops-eyebrow">{DATE_FMT.format(new Date())}</p>
            <h1 className="ops-title">{greeting()}.</h1>
            <p className="ops-sub">
              {loading
                ? "Pulling together what's going on…"
                : toDo > 0
                  ? `${toDo} thing${toDo === 1 ? "" : "s"} need${toDo === 1 ? "s" : ""} attention across the agency.`
                  : "Everything looks handled. Nothing is waiting on you right now."}
            </p>
          </div>
        </div>

        {error ? <p className="error">{error}</p> : null}

        {loading || !s ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <div className="ops-stats">
              <Link className="ops-stat" href="/admin/campaigns?status=in_review">
                <span className="n">{s.campaigns.inReview}</span>
                <span className="l">In review</span>
              </Link>
              <Link className="ops-stat" href="/admin/campaigns?status=needs_changes">
                <span className="n">{s.campaigns.needsChanges}</span>
                <span className="l">Needs changes</span>
              </Link>
              <Link className="ops-stat" href="/admin/campaigns">
                <span className="n">{s.campaigns.openComments}</span>
                <span className="l">Open comments</span>
              </Link>
              <Link className="ops-stat" href="/admin/production">
                <span className="n">{s.production.dueCount}</span>
                <span className="l">Production due</span>
              </Link>
              <Link className="ops-stat" href="/admin/calendar">
                <span className="n">{s.calendar.upcomingCount}</span>
                <span className="l">Sends in 14 days</span>
              </Link>
              <Link className="ops-stat" href="/admin/revenue">
                <span className="n">
                  {s.revenue.blendedRoi != null ? `${s.revenue.blendedRoi.toFixed(1)}x` : "—"}
                </span>
                <span className="l">Blended ROI</span>
              </Link>
            </div>

            <div className="ops-grid">
              <div>
                <div className="ops-panel">
                  <div className="ops-panel-head">
                    <h2>Needs your attention</h2>
                    <Link href="/admin/campaigns">All campaigns →</Link>
                  </div>
                  <div className="ops-panel-body">
                    {s.campaigns.attention.length === 0 ? (
                      <p className="ops-panel-empty">No campaigns waiting on you.</p>
                    ) : (
                      s.campaigns.attention.map((c) => (
                        <Link key={c.id} className="ops-item" href={`/admin/campaigns/${c.id}`}>
                          <div>
                            <p className="ops-item-title">{c.title}</p>
                            <p className="ops-item-sub">
                              {c.client_name ? `${c.client_name} · ` : ""}
                              {c.open_comments > 0
                                ? `${c.open_comments} open comment${c.open_comments === 1 ? "" : "s"}`
                                : "No open comments"}
                            </p>
                          </div>
                          <StatusBadge status={c.status} />
                        </Link>
                      ))
                    )}
                  </div>
                </div>

                <div className="ops-panel">
                  <div className="ops-panel-head">
                    <h2>Production to schedule</h2>
                    <Link href="/admin/production">Scheduler →</Link>
                  </div>
                  <div className="ops-panel-body">
                    {s.production.due.length === 0 ? (
                      <p className="ops-panel-empty">
                        Nothing due right now.
                        {s.production.requestedCount > 0
                          ? ` ${s.production.requestedCount} awaiting a date from the client.`
                          : ""}
                      </p>
                    ) : (
                      s.production.due.map((p) => (
                        <Link key={p.id} className="ops-item" href="/admin/production">
                          <div>
                            <p className="ops-item-title">{p.name}</p>
                            <p className="ops-item-sub">
                              Window {shortDate(p.window_start)} – {shortDate(p.window_end)}
                            </p>
                          </div>
                          <span className="ops-pill is-due">Due</span>
                        </Link>
                      ))
                    )}
                  </div>
                </div>

                <div className="ops-panel">
                  <div className="ops-panel-head">
                    <h2>Upcoming sends</h2>
                    <Link href="/admin/calendar">Calendar →</Link>
                  </div>
                  <div className="ops-panel-body">
                    {s.calendar.next.length === 0 ? (
                      <p className="ops-panel-empty">No sends scheduled in the next two weeks.</p>
                    ) : (
                      s.calendar.next.map((c) => (
                        <Link key={c.id} className="ops-item" href="/admin/calendar">
                          <div>
                            <p className="ops-item-title">{c.title}</p>
                            <p className="ops-item-sub">
                              {c.client_name ? `${c.client_name} · ` : ""}
                              {shortDate(c.send_date)}
                              {c.send_time ? ` at ${c.send_time}` : ""}
                              {c.requested_by_client ? " · client request" : ""}
                            </p>
                          </div>
                          <span className={`ops-pill ${c.status === "sent" ? "is-sent" : c.status === "requested" ? "is-review" : "is-due"}`}>
                            {c.status}
                          </span>
                        </Link>
                      ))
                    )}
                  </div>
                </div>

                <div className="ops-panel">
                  <div className="ops-panel-head">
                    <h2>Portfolio</h2>
                    <Link href="/admin/revenue">Revenue →</Link>
                  </div>
                  <div className="ops-mini-grid">
                    <div className="ops-mini"><span className="n">{s.revenue.activeClients}</span><span className="l">Active clients</span></div>
                    <div className="ops-mini"><span className="n">{money(s.revenue.totalRevenue)}</span><span className="l">Revenue tracked</span></div>
                    <div className="ops-mini"><span className="n">{money(s.revenue.totalAgencyMargin)}</span><span className="l">Agency margin</span></div>
                    <div className="ops-mini"><span className="n">{s.snapshots.accounts}</span><span className="l">Snapshot accts</span></div>
                  </div>
                </div>
              </div>

              <ActivitySidebar />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------- team member home */

type ForecastTask = { id: string; client: string; notes: string; hours: number; completed: number };
type ForecastData = {
  label: string;
  tasks: ForecastTask[];
  hours: number;
  capacity: number;
  allocationPct: number;
};
type CalendarSend = { id: string; title: string; client_name: string; send_date: string; status: string };
type BehindItem = { deliverable_id: string; name: string; due_date: string };
type ClientBehind = { client_id: string; client_name: string; items: BehindItem[] };

function allocationColor(pct: number): string {
  if (pct > 100) return "var(--danger)";
  if (pct >= 80) return "var(--success)";
  return "var(--warning)";
}

function TeamMemberHome() {
  const router = useRouter();
  const [person, setPerson] = useState<string | null>(null);
  const [canProduction, setCanProduction] = useState(false);
  const [forecast, setForecast] = useState<ForecastData | null>(null);
  const [sends, setSends] = useState<CalendarSend[]>([]);
  const [behind, setBehind] = useState<ClientBehind[]>([]);
  const [prodDue, setProdDue] = useState<ProdDue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const authRes = await fetch("/api/auth");
        const auth = authRes.ok ? await authRes.json() : null;
        if (!auth?.person) {
          router.push("/login");
          return;
        }
        setPerson(auth.person);

        const today = todayYmd();
        const week = currentWeek();
        const [fRes, cRes, bRes] = await Promise.all([
          fetch(`/api/forecast/${auth.person}?week=${week}`),
          fetch(`/api/calendar?start=${today}&end=${addDaysYmd(today, 14)}`),
          fetch("/api/snapshot/behind-report"),
        ]);
        if (fRes.ok) setForecast(await fRes.json());
        if (cRes.ok) setSends((await cRes.json()).sends || []);
        if (bRes.ok) setBehind((await bRes.json()).clients || []);

        const prodRes = await fetch("/api/production");
        if (prodRes.ok) {
          setCanProduction(true);
          const data = await prodRes.json();
          const due = (data.clients || [])
            .filter((row: { status: string; client: { id: string; name: string }; window: { start: string; end: string } | null }) => row.status === "due")
            .map((row: { client: { id: string; name: string }; window: { start: string; end: string } }) => ({
              id: row.client.id,
              name: row.client.name,
              window_start: row.window.start,
              window_end: row.window.end,
            }));
          setProdDue(due);
        }
      } catch {
        setError("Network error. Check your connection and try again.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const behindCount = behind.reduce((sum, c) => sum + c.items.length, 0);

  return (
    <div className="ops-scope">
      <header className="topbar">
        <Brand href="/admin" />
        <NavMenu current="/admin" />
      </header>

      <div className="ops-page">
        <div className="ops-page-head">
          <div>
            <p className="ops-eyebrow">{DATE_FMT.format(new Date())}</p>
            <h1 className="ops-title">{greeting()}{person ? `, ${person[0].toUpperCase()}${person.slice(1)}` : ""}.</h1>
            <p className="ops-sub">Your week at a glance.</p>
          </div>
        </div>

        {error ? <p className="error">{error}</p> : null}

        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <div className="ops-stats" style={{ gridTemplateColumns: canProduction ? "repeat(4, 1fr)" : "repeat(3, 1fr)" }}>
              <Link className="ops-stat" href={person ? `/admin/forecast/${person}` : "/admin/forecast"}>
                <span className="n" style={{ color: forecast ? allocationColor(forecast.allocationPct) : undefined }}>
                  {forecast ? `${forecast.allocationPct}%` : "—"}
                </span>
                <span className="l">Your allocation</span>
              </Link>
              <Link className="ops-stat" href="/admin/calendar">
                <span className="n">{sends.length}</span>
                <span className="l">Sends in 14 days</span>
              </Link>
              <Link className="ops-stat" href="/admin/snapshot">
                <span className="n">{behindCount}</span>
                <span className="l">Accounts behind</span>
              </Link>
              {canProduction ? (
                <Link className="ops-stat" href="/admin/production">
                  <span className="n">{prodDue.length}</span>
                  <span className="l">Production due</span>
                </Link>
              ) : null}
            </div>

            <div className="ops-grid">
              <div>
                <div className="ops-panel">
                  <div className="ops-panel-head">
                    <h2>Your week</h2>
                    <Link href={person ? `/admin/forecast/${person}` : "/admin/forecast"}>Full forecast →</Link>
                  </div>
                  <div className="ops-panel-body">
                    {!forecast || forecast.tasks.length === 0 ? (
                      <p className="ops-panel-empty">Nothing forecasted yet this week.</p>
                    ) : (
                      forecast.tasks.slice(0, 6).map((t) => (
                        <div key={t.id} className="ops-item" style={{ cursor: "default" }}>
                          <div>
                            <p className="ops-item-title" style={{ textDecoration: t.completed ? "line-through" : "none", opacity: t.completed ? 0.6 : 1 }}>
                              {t.client}
                            </p>
                            <p className="ops-item-sub">{t.notes || "—"}</p>
                          </div>
                          <span className="muted" style={{ fontSize: 13 }}>{t.hours}h</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {canProduction ? (
                  <div className="ops-panel">
                    <div className="ops-panel-head">
                      <h2>Production due</h2>
                      <Link href="/admin/production">Scheduler →</Link>
                    </div>
                    <div className="ops-panel-body">
                      {prodDue.length === 0 ? (
                        <p className="ops-panel-empty">Nothing due right now.</p>
                      ) : (
                        prodDue.map((p) => (
                          <Link key={p.id} className="ops-item" href="/admin/production">
                            <div>
                              <p className="ops-item-title">{p.name}</p>
                              <p className="ops-item-sub">
                                Window {shortDate(p.window_start)} – {shortDate(p.window_end)}
                              </p>
                            </div>
                            <span className="ops-pill is-due">Due</span>
                          </Link>
                        ))
                      )}
                    </div>
                  </div>
                ) : null}

                <div className="ops-panel">
                  <div className="ops-panel-head">
                    <h2>Upcoming sends</h2>
                    <Link href="/admin/calendar">Calendar →</Link>
                  </div>
                  <div className="ops-panel-body">
                    {sends.length === 0 ? (
                      <p className="ops-panel-empty">No sends scheduled in the next two weeks.</p>
                    ) : (
                      sends.slice(0, 8).map((c) => (
                        <Link key={c.id} className="ops-item" href="/admin/calendar">
                          <div>
                            <p className="ops-item-title">{c.title}</p>
                            <p className="ops-item-sub">
                              {c.client_name ? `${c.client_name} · ` : ""}
                              {shortDate(c.send_date)}
                            </p>
                          </div>
                          <span className={`ops-pill ${c.status === "sent" ? "is-sent" : c.status === "requested" ? "is-review" : "is-due"}`}>
                            {c.status}
                          </span>
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="ops-panel">
                <div className="ops-panel-head">
                  <h2>Accounts behind</h2>
                  <Link href="/admin/snapshot">Snapshots →</Link>
                </div>
                <div className="ops-panel-body">
                  {behind.length === 0 ? (
                    <p className="ops-panel-empty">Nothing behind right now.</p>
                  ) : (
                    behind.slice(0, 10).map((c) => (
                      <div key={c.client_id} className="ops-item" style={{ cursor: "default" }}>
                        <div>
                          <p className="ops-item-title">{c.client_name}</p>
                          <p className="ops-item-sub">
                            {c.items.length} deliverable{c.items.length === 1 ? "" : "s"} overdue
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
