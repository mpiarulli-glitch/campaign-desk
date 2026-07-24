"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand } from "@/components/Brand";
import { NavMenu } from "@/components/NavMenu";
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
      try {
        const auth = await fetch("/api/auth");
        if (auth.ok) {
          const session = await auth.json();
          if (session.role === "forecast" && session.person) {
            router.push(`/admin/forecast/${session.person}`);
            return;
          }
        }
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
