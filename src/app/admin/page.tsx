"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand } from "@/components/Brand";
import { StatusBadge } from "@/components/StatusBadge";
import { ActivitySidebar } from "@/components/ActivitySidebar";

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

export default function AdminHomePage() {
  const router = useRouter();
  const [s, setS] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/dashboard");
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) {
        setError("Could not load your dashboard.");
        setLoading(false);
        return;
      }
      setS(await res.json());
      setLoading(false);
    })();
  }, [router]);

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    router.push("/login");
  }

  // Count of things that genuinely need a person to act.
  const toDo = s
    ? s.campaigns.inReview +
      s.campaigns.needsChanges +
      s.production.dueCount +
      s.calendar.clientRequests
    : 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand href="/admin" />
        <div className="row">
          <Link className="btn btn-ghost btn-sm" href="/admin/campaigns">Campaigns</Link>
          <Link className="btn btn-ghost btn-sm" href="/admin/calendar">Calendar</Link>
          <Link className="btn btn-ghost btn-sm" href="/admin/production">Production</Link>
          <Link className="btn btn-ghost btn-sm" href="/admin/snapshot">Snapshots</Link>
          <Link className="btn btn-ghost btn-sm" href="/admin/revenue">Revenue</Link>
          <Link className="btn btn-ghost btn-sm" href="/admin/activity">Activity</Link>
          <Link className="btn" href="/admin/new">New campaign</Link>
          <button className="btn btn-ghost btn-sm" onClick={logout}>Sign out</button>
        </div>
      </header>

      <main className="container container-wide stack">
        <div className="page-hero">
          <p className="eyebrow">{DATE_FMT.format(new Date())}</p>
          <h1 className="h1">{greeting()}, welcome back.</h1>
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
            {loading
              ? "Pulling together what's going on…"
              : toDo > 0
                ? `You have ${toDo} thing${toDo === 1 ? "" : "s"} that need attention across the agency.`
                : "Everything looks handled. Nothing is waiting on you right now."}
          </p>
        </div>

        {error ? <p className="error">{error}</p> : null}

        {loading || !s ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            {/* At-a-glance stat row */}
            <div className="dash-stats">
              <Link className="dash-stat" href="/admin/campaigns?status=in_review">
                <span className="dash-stat-n">{s.campaigns.inReview}</span>
                <span className="dash-stat-l">In review</span>
              </Link>
              <Link className="dash-stat" href="/admin/campaigns?status=needs_changes">
                <span className="dash-stat-n">{s.campaigns.needsChanges}</span>
                <span className="dash-stat-l">Needs changes</span>
              </Link>
              <Link className="dash-stat" href="/admin/campaigns">
                <span className="dash-stat-n">{s.campaigns.openComments}</span>
                <span className="dash-stat-l">Open comments</span>
              </Link>
              <Link className="dash-stat" href="/admin/production">
                <span className="dash-stat-n">{s.production.dueCount}</span>
                <span className="dash-stat-l">Production due</span>
              </Link>
              <Link className="dash-stat" href="/admin/calendar">
                <span className="dash-stat-n">{s.calendar.upcomingCount}</span>
                <span className="dash-stat-l">Sends in 14 days</span>
              </Link>
              <Link className="dash-stat" href="/admin/revenue">
                <span className="dash-stat-n">
                  {s.revenue.blendedRoi != null ? `${s.revenue.blendedRoi.toFixed(1)}x` : "—"}
                </span>
                <span className="dash-stat-l">Blended ROI</span>
              </Link>
            </div>

            <div className="dashboard-grid">
              <div className="stack" style={{ gap: 18 }}>
                {/* Needs your attention */}
                <section className="card card-pad stack" style={{ gap: 12 }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <h2 className="h2">Needs your attention</h2>
                    <Link className="btn btn-ghost btn-sm" href="/admin/campaigns">All campaigns</Link>
                  </div>
                  {s.campaigns.attention.length === 0 ? (
                    <p className="muted" style={{ margin: 0 }}>No campaigns waiting on you.</p>
                  ) : (
                    <div className="dash-list">
                      {s.campaigns.attention.map((c) => (
                        <Link key={c.id} className="dash-row" href={`/admin/campaigns/${c.id}`}>
                          <div>
                            <div className="dash-row-title">{c.title}</div>
                            <div className="dash-row-sub">
                              {c.client_name ? `${c.client_name} · ` : ""}
                              {c.open_comments > 0
                                ? `${c.open_comments} open comment${c.open_comments === 1 ? "" : "s"}`
                                : "No open comments"}
                            </div>
                          </div>
                          <StatusBadge status={c.status} />
                        </Link>
                      ))}
                    </div>
                  )}
                </section>

                {/* Production due */}
                <section className="card card-pad stack" style={{ gap: 12 }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <h2 className="h2">Production to schedule</h2>
                    <Link className="btn btn-ghost btn-sm" href="/admin/production">Scheduler</Link>
                  </div>
                  {s.production.due.length === 0 ? (
                    <p className="muted" style={{ margin: 0 }}>
                      Nothing due right now.
                      {s.production.requestedCount > 0
                        ? ` ${s.production.requestedCount} awaiting a date from the client.`
                        : ""}
                    </p>
                  ) : (
                    <div className="dash-list">
                      {s.production.due.map((p) => (
                        <Link key={p.id} className="dash-row" href="/admin/production">
                          <div>
                            <div className="dash-row-title">{p.name}</div>
                            <div className="dash-row-sub">
                              Window {shortDate(p.window_start)} – {shortDate(p.window_end)}
                            </div>
                          </div>
                          <span className="snap-pill status-in_progress">Due</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </section>

                {/* Upcoming sends */}
                <section className="card card-pad stack" style={{ gap: 12 }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <h2 className="h2">Upcoming sends</h2>
                    <Link className="btn btn-ghost btn-sm" href="/admin/calendar">Calendar</Link>
                  </div>
                  {s.calendar.next.length === 0 ? (
                    <p className="muted" style={{ margin: 0 }}>No sends scheduled in the next two weeks.</p>
                  ) : (
                    <div className="dash-list">
                      {s.calendar.next.map((c) => (
                        <Link key={c.id} className="dash-row" href="/admin/calendar">
                          <div>
                            <div className="dash-row-title">{c.title}</div>
                            <div className="dash-row-sub">
                              {c.client_name ? `${c.client_name} · ` : ""}
                              {shortDate(c.send_date)}
                              {c.send_time ? ` at ${c.send_time}` : ""}
                              {c.requested_by_client ? " · client request" : ""}
                            </div>
                          </div>
                          <span className={`snap-pill status-${c.status === "sent" ? "completed" : c.status === "requested" ? "shared" : "in_progress"}`}>
                            {c.status}
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </section>

                {/* Portfolio */}
                <section className="card card-pad stack" style={{ gap: 12 }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <h2 className="h2">Portfolio</h2>
                    <Link className="btn btn-ghost btn-sm" href="/admin/revenue">Revenue</Link>
                  </div>
                  <div className="dash-mini">
                    <div>
                      <span className="dash-mini-n">{s.revenue.activeClients}</span>
                      <span className="dash-mini-l">Active clients</span>
                    </div>
                    <div>
                      <span className="dash-mini-n">{money(s.revenue.totalRevenue)}</span>
                      <span className="dash-mini-l">Revenue tracked</span>
                    </div>
                    <div>
                      <span className="dash-mini-n">{money(s.revenue.totalAgencyMargin)}</span>
                      <span className="dash-mini-l">Agency margin</span>
                    </div>
                    <div>
                      <span className="dash-mini-n">{s.snapshots.accounts}</span>
                      <span className="dash-mini-l">Snapshot accounts</span>
                    </div>
                  </div>
                </section>
              </div>

              <ActivitySidebar />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
