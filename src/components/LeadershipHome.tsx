"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { MoodAvatar, MOOD_LABEL, moodForPct } from "@/components/MoodAvatar";
import { AssignTodoPanel } from "@/components/AssignTodoPanel";
import { ADMIN_PEOPLE } from "@/lib/admin-people";
import { ADS_DASHBOARD_PEOPLE, PEOPLE, personLabel } from "@/lib/people";
import { currentWeek, weekLabel } from "@/lib/week";

type PersonSummary = {
  person: string;
  label: string;
  hours: number;
  capacity: number;
  allocationPct: number;
  donePct: number;
  taskCount: number;
  doneCount: number;
};

type ProdRow = {
  client: {
    id: string;
    name: string;
    active: boolean;
    production_enrolled: boolean;
  };
  window: { start: string; end: string } | null;
  status: string;
  existingSend: { sendDate: string; status: string } | null;
  currentReachoutCount: number;
  currentReminderCount: number;
  openExtraRequest: { id: string } | null;
};

type ProductionSend = {
  id: string;
  title: string;
  client_name?: string;
  send_date: string;
  send_time: string;
  status: string;
  cancelled_at: string | null;
};

type CsSummary = {
  clients: number;
  sent: number;
  opened: number;
  submitted: number;
  waiting: number;
};

type ProdBucket = "waiting" | "due" | "asked" | "ahead" | "unset";

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

function shortDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function displayName(slug: string): string {
  return (
    ADMIN_PEOPLE.find((p) => p.slug === slug)?.label ||
    PEOPLE.find((p) => p.slug === slug)?.label ||
    personLabel(slug)
  );
}

function allocationColor(pct: number): string {
  if (pct > 100) return "var(--danger)";
  if (pct >= 80) return "var(--success)";
  return "var(--warning)";
}

function outreachCount(r: ProdRow): number {
  return Math.max(r.currentReachoutCount || 0, r.currentReminderCount || 0);
}

function bucketOf(r: ProdRow): ProdBucket {
  if (!r.window) return "unset";
  if (r.status === "requested") return "waiting";
  if (r.status === "outreach_sent") return "asked";
  if (!r.existingSend && outreachCount(r) > 0) return "asked";
  if (r.status === "due") return "due";
  return "ahead";
}

export function LeadershipHome({ person }: { person: string }) {
  const router = useRouter();
  const week = currentWeek();
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [prodRows, setProdRows] = useState<ProdRow[]>([]);
  const [productions, setProductions] = useState<ProductionSend[]>([]);
  const [cs, setCs] = useState<CsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const [fRes, pRes, csRes] = await Promise.all([
          fetch(`/api/forecast?week=${week}`),
          fetch("/api/production"),
          fetch("/api/client-services"),
        ]);
        if (fRes.status === 401 || pRes.status === 401) {
          router.push("/login");
          return;
        }
        if (fRes.ok) {
          const data = await fRes.json();
          if (on) setPeople(data.people || []);
        }
        if (pRes.ok) {
          const data = await pRes.json();
          if (on) {
            setProdRows(data.clients || []);
            setProductions(data.productions || []);
          }
        }
        if (csRes.ok) {
          const data = await csRes.json();
          if (on) setCs(data.summary || null);
        }
      } catch {
        if (on) setError("Network error. Check your connection and try again.");
      } finally {
        if (on) setLoading(false);
      }
    })();
    return () => {
      on = false;
    };
  }, [router, week]);

  const enrolled = useMemo(
    () => prodRows.filter((r) => r.client.production_enrolled && r.client.active),
    [prodRows]
  );

  const counts = useMemo(() => {
    const base = { waiting: 0, due: 0, asked: 0, ahead: 0, unset: 0 };
    for (const r of enrolled) base[bucketOf(r)] += 1;
    return base;
  }, [enrolled]);

  const dueNow = useMemo(
    () => enrolled.filter((r) => bucketOf(r) === "due").slice(0, 6),
    [enrolled]
  );
  const waitingOnUs = useMemo(
    () => enrolled.filter((r) => bucketOf(r) === "waiting").slice(0, 6),
    [enrolled]
  );
  const extras = useMemo(
    () => enrolled.filter((r) => r.openExtraRequest).slice(0, 4),
    [enrolled]
  );
  const upcomingShoots = useMemo(
    () =>
      productions
        .filter((p) => !p.cancelled_at && p.status !== "requested" && p.send_date >= week)
        .slice(0, 5),
    [productions, week]
  );

  const totalHours = people.reduce((sum, p) => sum + p.hours, 0);
  const totalCapacity = people.reduce((sum, p) => sum + p.capacity, 0);
  const teamPct = totalCapacity ? Math.round((totalHours / totalCapacity) * 100) : 0;
  const over = people.filter((p) => p.allocationPct > 100).length;

  return (
    <div className="ops-scope">
      <div className="ops-page">
        <div className="ops-page-head">
          <div>
            <p className="ops-eyebrow">{DATE_FMT.format(new Date())}</p>
            <h1 className="ops-title">
              {greeting()}, {displayName(person)}.
            </h1>
            <p className="ops-sub">
              Team capacity this week, what production needs, and a door into
              Client Services.
            </p>
          </div>
        </div>

        {error ? <p className="error">{error}</p> : null}

        <AssignTodoPanel />

        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <div className="ops-stats" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
              <Link className="ops-stat" href="/admin/forecast">
                <span className="n" style={{ color: allocationColor(teamPct) }}>
                  {teamPct}%
                </span>
                <span className="l">Team forecasted</span>
              </Link>
              <Link className="ops-stat" href="/admin/production">
                <span className="n">{counts.due}</span>
                <span className="l">Production due</span>
              </Link>
              <Link className="ops-stat" href="/admin/production">
                <span className="n">{counts.waiting + counts.asked}</span>
                <span className="l">Waiting or asked</span>
              </Link>
              <Link className="ops-stat" href="/admin/client-services">
                <span className="n">{cs ? cs.waiting : "—"}</span>
                <span className="l">CS asks waiting</span>
              </Link>
            </div>

            <div className="ops-panel">
              <div className="ops-panel-head">
                <h2>Team forecast · {weekLabel(week)}</h2>
                <Link href="/admin/forecast">All forecasts →</Link>
              </div>
              <div className="ops-panel-body" style={{ padding: 16 }}>
                {people.length === 0 ? (
                  <p className="ops-panel-empty">No forecasted hours this week yet.</p>
                ) : (
                  <>
                    <p className="muted" style={{ margin: "0 0 14px", fontSize: 13 }}>
                      {totalHours}h of {totalCapacity}h planned
                      {over > 0 ? ` · ${over} over-allocated` : ""}.
                    </p>
                    <div className="mood-grid lead-mood-grid">
                      {people.map((p) => {
                        const mood = moodForPct(p.allocationPct);
                        return (
                          <Link
                            key={p.person}
                            href={`/admin/forecast/${p.person}?week=${week}`}
                            className={`mood-card mood-card--${mood}`}
                          >
                            <MoodAvatar pct={p.allocationPct} size={52} />
                            <div className="mood-card-body">
                              <div className="mood-card-name">{p.label}</div>
                              <div className="mood-card-mood">{MOOD_LABEL[mood]}</div>
                              <div className="mood-card-foot">
                                <span
                                  style={{
                                    color: allocationColor(p.allocationPct),
                                    fontWeight: 700,
                                  }}
                                >
                                  {p.allocationPct}%
                                </span>
                                <span className="muted">
                                  {p.hours}h
                                  {p.taskCount
                                    ? ` · ${p.doneCount}/${p.taskCount} done`
                                    : ""}
                                </span>
                              </div>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="ops-grid" style={{ marginTop: 24 }}>
              <div>
                <div className="ops-panel">
                  <div className="ops-panel-head">
                    <h2>Production scheduling</h2>
                    <Link href="/admin/production">Scheduler →</Link>
                  </div>
                  <div className="ops-panel-body">
                    <div className="lead-prod-chips">
                      <span>
                        <b>{counts.due}</b> due now
                      </span>
                      <span>
                        <b>{counts.waiting}</b> waiting on us
                      </span>
                      <span>
                        <b>{counts.asked}</b> asked, no booking
                      </span>
                      <span>
                        <b>{counts.ahead}</b> ahead
                      </span>
                      {extras.length > 0 ? (
                        <span>
                          <b>{extras.length}</b> extra request
                          {extras.length === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </div>
                    {dueNow.length === 0 && waitingOnUs.length === 0 ? (
                      <p className="ops-panel-empty">
                        Nothing due or waiting. {counts.ahead} booked ahead.
                      </p>
                    ) : (
                      <>
                        {dueNow.map((r) => (
                          <Link
                            key={r.client.id}
                            className="ops-item"
                            href="/admin/production"
                          >
                            <div>
                              <p className="ops-item-title">{r.client.name}</p>
                              <p className="ops-item-sub">
                                {r.window
                                  ? `Window ${shortDate(r.window.start)} – ${shortDate(r.window.end)}`
                                  : "Due now"}
                              </p>
                            </div>
                            <span className="ops-pill is-due">Due</span>
                          </Link>
                        ))}
                        {waitingOnUs.map((r) => (
                          <Link
                            key={r.client.id}
                            className="ops-item"
                            href="/admin/production"
                          >
                            <div>
                              <p className="ops-item-title">{r.client.name}</p>
                              <p className="ops-item-sub">Requested, not confirmed</p>
                            </div>
                            <span className="ops-pill is-review">Waiting</span>
                          </Link>
                        ))}
                      </>
                    )}
                    {upcomingShoots.length > 0 ? (
                      <div className="lead-prod-upcoming">
                        <p className="muted" style={{ margin: "10px 0 6px", fontSize: 12, fontWeight: 700 }}>
                          Upcoming shoots
                        </p>
                        {upcomingShoots.map((p) => (
                          <Link key={p.id} className="ops-item" href="/admin/production">
                            <div>
                              <p className="ops-item-title">
                                {p.client_name || p.title}
                              </p>
                              <p className="ops-item-sub">
                                {shortDate(p.send_date)}
                                {p.send_time ? ` · ${p.send_time}` : ""}
                              </p>
                            </div>
                            <span className="ops-pill is-sent">{p.status}</span>
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div>
                {(ADS_DASHBOARD_PEOPLE as readonly string[]).includes(person) ? (
                  <Link className="hub-tile" href="/admin/ads" style={{ marginBottom: 18 }}>
                    <span className="hub-tile-ico" aria-hidden>
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 11v2a1 1 0 0 0 1 1h2l6 6V4L6 10H4a1 1 0 0 0-1 1z" />
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                        <path d="M18.07 5.93a9 9 0 0 1 0 12.14" />
                      </svg>
                    </span>
                    <span className="hub-tile-body">
                      <span className="hub-tile-title">Ads</span>
                      <span className="hub-tile-desc">
                        Weekly pass: gaps, spend caps & tracking
                      </span>
                    </span>
                    <span className="hub-tile-go" aria-hidden>
                      →
                    </span>
                  </Link>
                ) : null}
                <Link className="hub-tile lead-cs-tile" href="/admin/client-services">
                  <span className="hub-tile-ico" aria-hidden>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="9" />
                      <circle cx="12" cy="12" r="3.5" />
                      <path d="m5.6 5.6 3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9" />
                    </svg>
                  </span>
                  <span className="hub-tile-body">
                    <span className="hub-tile-title">Client Services Hub</span>
                    <span className="hub-tile-desc">
                      {cs
                        ? `${cs.waiting} waiting this week · ${cs.submitted} submitted · ${cs.opened} opened`
                        : "Weekly asks, leads, and account snapshots."}
                    </span>
                  </span>
                  <span className="hub-tile-go" aria-hidden>
                    →
                  </span>
                </Link>

                {cs ? (
                  <div className="ops-panel" style={{ marginTop: 18 }}>
                    <div className="ops-panel-head">
                      <h2>This week’s asks</h2>
                      <Link href="/admin/client-services">Open hub →</Link>
                    </div>
                    <div className="ops-mini-grid">
                      <div className="ops-mini">
                        <span className="n">{cs.waiting}</span>
                        <span className="l">Waiting</span>
                      </div>
                      <div className="ops-mini">
                        <span className="n">{cs.submitted}</span>
                        <span className="l">Submitted</span>
                      </div>
                      <div className="ops-mini">
                        <span className="n">{cs.sent}</span>
                        <span className="l">Sent</span>
                      </div>
                      <div className="ops-mini">
                        <span className="n">{cs.opened}</span>
                        <span className="l">Opened</span>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
