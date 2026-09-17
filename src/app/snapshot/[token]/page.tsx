"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Brand } from "@/components/Brand";
import { PerfCharts, type MetricSeries } from "@/components/PerfCharts";
import { isSnapshotContractMet, isThisWeeksWork, snapshotStatusLabel, type SnapshotStatus } from "@/lib/snapshot-status";
import { categoryTagTone } from "@/lib/snapshot-fill";
import { addWeeks, currentWeek, isCurrentWeek, weekLabel } from "@/lib/week";

type Win = { id: string; body: string; happened_on: string };
type Converted = "unknown" | "yes" | "no";
type Lead = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  source: "form" | "call" | "other";
  received_on: string;
  week_start: string;
  converted: Converted;
  client_note: string;
  answered_at: string;
};
const SOURCE_LABEL: Record<Lead["source"], string> = {
  form: "Filled a form",
  call: "Called in",
  other: "Other",
};

function formatClientWinDate(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
type Status = SnapshotStatus;
const STATUS_LABEL = (status: Status) => snapshotStatusLabel(status);

type Row = {
  deliverable_id: string;
  category: string;
  name: string;
  cadence: string;
  kind?: "recurring" | "one_time";
  week_start: string;
  created_at?: string;
  updated_at?: string;
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

function leadName(l: Lead): string {
  return [l.first_name, l.last_name].filter(Boolean).join(" ") || "Unnamed lead";
}

function hasUpdate(r: Row, viewWeek: string): boolean {
  return isThisWeeksWork(r, viewWeek);
}

export default function SnapshotClientPage() {
  const { token } = useParams<{ token: string }>();
  const [accountName, setAccountName] = useState("");
  const [launchDate, setLaunchDate] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [overview, setOverview] = useState<Overview[]>([]);
  const [wins, setWins] = useState<Win[]>([]);
  const [metrics, setMetrics] = useState<MetricSeries[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadWeeks, setLeadWeeks] = useState<string[]>([]);
  const [leadScope, setLeadScope] = useState<"week" | "all">("week");
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
  // Contracted deliverables is the longest section and the least urgent, so it
  // starts folded away and opens on request.
  const [showDeliverables, setShowDeliverables] = useState(false);

  const load = useCallback(
    async (w: string, scope: "week" | "all") => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(
          `/api/snapshot/shared/${token}?week=${w}${scope === "all" ? "&leads=all" : ""}`
        );
        if (res.status === 404) { setNotFound(true); return; }
        if (res.ok) {
          const data = await res.json();
          setAccountName(data.account.name);
          setLaunchDate(typeof data.account.launchDate === "string" ? data.account.launchDate : null);
          setRows(data.rows || []);
          setOverview(data.overview || []);
          setWins(data.wins || []);
          setMetrics(data.metrics || []);
          if (data.bounds) setBounds(data.bounds);
          setLeads(data.leads || []);
          setLeadWeeks(data.leadWeeks || []);
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

  useEffect(() => { load(week, leadScope); }, [week, leadScope, load]);

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

  // Answer optimistically so the buttons feel instant, then reconcile with
  // whatever the server actually stored.
  async function answerLead(leadId: string, converted: Converted) {
    const prev = leads;
    setLeads((ls) => ls.map((l) => (l.id === leadId ? { ...l, converted } : l)));
    try {
      const res = await fetch(`/api/snapshot/shared/${token}/lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, converted }),
      });
      if (!res.ok) throw new Error("save failed");
      const data = await res.json();
      setLeads((ls) => ls.map((l) => (l.id === leadId ? { ...l, ...data.lead } : l)));
    } catch {
      setLeads(prev);
      setError("Could not save that answer. Try again.");
    }
  }

  const updatedRows = useMemo(() => rows.filter((r) => hasUpdate(r, week)), [rows, week]);

  // At-a-glance figures for the report header.
  const glance = useMemo(() => {
    const delivered = updatedRows.filter((r) => isSnapshotContractMet(r.status)).length;
    const active = updatedRows.filter((r) => r.status === "in_progress").length;
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

  const leadAnswered = useMemo(
    () => ({
      total: leads.length,
      yes: leads.filter((l) => l.converted === "yes").length,
      no: leads.filter((l) => l.converted === "no").length,
      pending: leads.filter((l) => l.converted === "unknown").length,
    }),
    [leads]
  );

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

  const anyUpdates = updatedRows.length > 0;

  // Bounds are only enforced once the server has stated them, so the arrows are
  // never dead on the first paint. An account with no entries at all reports no
  // earliest week, which leaves back disabled because there is nothing behind.
  const canGoBack = !bounds.earliest || week > bounds.earliest;
  const canGoForward = !bounds.latest || week < bounds.latest;

  // Contract list: one-time setup that is finished sits after the rest.
  const setupDone = overview.filter((o) => o.kind === "one_time" && !!o.completed_on);
  const ongoing = overview.filter((o) => !(o.kind === "one_time" && o.completed_on));
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
            <header className="snap-hero">
              <div className="snap-hero-copy">
                <p className="snap-kicker">
                  Week of {weekLabel(week)}
                  {isCurrentWeek(week) ? " · Current" : ""}
                  {launchDate ? ` · Launched ${ymdLabel(launchDate)}` : ""}
                </p>
                <h1>{accountName || "Weekly snapshot"}</h1>
                <p className="snap-lede">
                  <b>{glance.delivered}</b> delivered
                  <span className="snap-dot" aria-hidden="true">
                    ·
                  </span>
                  <b>{glance.active}</b> in progress
                  {glance.wins > 0 ? (
                    <>
                      <span className="snap-dot" aria-hidden="true">
                        ·
                      </span>
                      <b>{glance.wins}</b> win{glance.wins === 1 ? "" : "s"}
                    </>
                  ) : null}
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
            {wins.length > 0 ? (
              <section className="snap-panel t-wins">
                <header className="snap-sec-head">
                  <h2>Wins</h2>
                </header>
                <div className="snap-wins2">
                  {wins.map((w) => (
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

            {/* LEADS — the client answers these */}
            {leads.length > 0 || leadWeeks.length > 0 ? (
              <section className="snap-panel t-leads">
                <header className="snap-sec-head">
                  <h2>Leads</h2>
                  <select
                    className="snap-lead-scope"
                    aria-label="Which leads to show"
                    value={leadScope}
                    onChange={(e) => setLeadScope(e.target.value as "week" | "all")}
                  >
                    <option value="week">This week</option>
                    <option value="all">All</option>
                  </select>
                </header>
                {leadAnswered.total > 0 ? (
                  <p className="snap-lead-tally">
                    <b>{leadAnswered.yes}</b> converted · <b>{leadAnswered.no}</b> did not ·{" "}
                    <b>{leadAnswered.pending}</b> still to answer
                  </p>
                ) : null}
                {leads.length === 0 ? (
                  <p className="muted" style={{ margin: 0 }}>
                    No leads logged for this week. Switch to &quot;All leads&quot; to see earlier ones.
                  </p>
                ) : (
                  <div className="snap-leads">
                    {leads.map((l) => (
                      <div key={l.id} className={`snap-lead conv-${l.converted}`}>
                        <div className="snap-lead-main">
                          <div className="snap-lead-name">{leadName(l)}</div>
                          <div className="snap-lead-meta">
                            {l.email ? <a href={`mailto:${l.email}`}>{l.email}</a> : null}
                            {l.phone ? <a href={`tel:${l.phone}`}>{l.phone}</a> : null}
                            <span>
                              {SOURCE_LABEL[l.source]} · {ymdLabel(l.received_on)}
                            </span>
                          </div>
                        </div>
                        <div className="snap-lead-answer">
                          <button
                            className={`snap-lead-btn yes ${l.converted === "yes" ? "on" : ""}`}
                            onClick={() => answerLead(l.id, l.converted === "yes" ? "unknown" : "yes")}
                          >
                            Converted
                          </button>
                          <button
                            className={`snap-lead-btn no ${l.converted === "no" ? "on" : ""}`}
                            onClick={() => answerLead(l.id, l.converted === "no" ? "unknown" : "no")}
                          >
                            Not yet
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ) : null}

            {/* This week's work */}
            <section className="snap-panel t-work">
              <header className="snap-sec-head">
                <h2>This week</h2>
              </header>
              <p className="muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
                Notes stay with the week they were written. Use the arrows above to
                read last week without changing this one.
              </p>
              {rows.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>No deliverables set up yet.</p>
              ) : !anyUpdates ? (
                <p className="muted" style={{ margin: 0 }}>No updates logged for this week yet.</p>
              ) : (
                <div className="snap-n-db">
                  <div className="snap-n-cols snap-n-head" aria-hidden="true">
                    <span>This week</span>
                    <span>Category</span>
                    <span>Status</span>
                  </div>
                  {updatedRows.map((r) => (
                    <div key={r.deliverable_id} className="snap-n-row">
                      <div className="snap-n-cols snap-n-cols-client">
                        <div className="snap-n-title" >
                          <span className="snap-n-ico" aria-hidden="true">
                            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4">
                              <path d="M4.5 2.5h5.2L12.5 5.3V13.5h-8v-11z" />
                              <path d="M9.5 2.5V5.5h3" />
                            </svg>
                          </span>
                          <span className="snap-n-name">{r.name}</span>
                        </div>
                        <span className={`snap-n-tag snap-n-tag-${categoryTagTone(r.category || "Other")}`}>
                          {r.category.trim() || "Other"}
                        </span>
                        <span className={`snap-n-pill status-${r.status}`}>{STATUS_LABEL(r.status)}</span>
                      </div>
                      {r.work_done.trim() || r.next_steps.trim() || r.notes.trim() ? (
                        <div className="snap-n-letter">
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
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Contracted deliverables */}
            {overview.length > 0 ? (
              <section className="snap-panel t-deliv">
                <header className="snap-sec-head">
                  <h2>Contract</h2>
                  <button
                    type="button"
                    className="snap-toggle"
                    aria-expanded={showDeliverables}
                    onClick={() => setShowDeliverables((v) => !v)}
                  >
                    {showDeliverables ? "Hide" : `Show ${overview.length}`}
                  </button>
                </header>
                {showDeliverables ? (
                <div className="snap-n-db">
                  <div className="snap-n-cols snap-n-head snap-n-cols-contract" aria-hidden="true">
                    <span>Deliverable</span>
                    <span>Category</span>
                    <span>Status</span>
                  </div>
                  {ongoing.map((o) => (
                    <div key={o.deliverable_id} className="snap-n-row">
                      <div className="snap-n-cols snap-n-cols-contract">
                        <div className="snap-n-title">
                          <span className="snap-n-ico" aria-hidden="true">
                            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4">
                              <path d="M4.5 2.5h5.2L12.5 5.3V13.5h-8v-11z" />
                              <path d="M9.5 2.5V5.5h3" />
                            </svg>
                          </span>
                          <span className="snap-n-name">{o.name}</span>
                        </div>
                        <span className={`snap-n-tag snap-n-tag-${categoryTagTone(o.category || "Other")}`}>
                          {o.category.trim() || "Other"}
                        </span>
                        <span className={`snap-n-pill status-${o.status}`}>{STATUS_LABEL(o.status)}</span>
                      </div>
                      <p className="snap-n-meta">
                        {isSnapshotContractMet(o.status)
                          ? "Delivered"
                          : o.worked_ever
                            ? "Work in progress"
                            : "Not started yet"}
                      </p>
                    </div>
                  ))}
                  {setupDone.map((o) => (
                    <div key={o.deliverable_id} className="snap-n-row is-met">
                      <div className="snap-n-cols snap-n-cols-contract">
                        <div className="snap-n-title">
                          <span className="snap-n-ico" aria-hidden="true">
                            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4">
                              <path d="M4.5 2.5h5.2L12.5 5.3V13.5h-8v-11z" />
                              <path d="M9.5 2.5V5.5h3" />
                            </svg>
                          </span>
                          <span className="snap-n-name">{o.name}</span>
                        </div>
                        <span className={`snap-n-tag snap-n-tag-${categoryTagTone(o.category || "Other")}`}>
                          {o.category.trim() || "Other"}
                        </span>
                        <span className="snap-n-pill status-completed">Completed</span>
                      </div>
                      <p className="snap-n-meta">Completed · week of {weekLabel(o.completed_on)}</p>
                    </div>
                  ))}
                </div>
                ) : (
                  <p className="muted" style={{ margin: 0 }}>
                    {overview.length} contracted deliverable
                    {overview.length === 1 ? "" : "s"} — open when you want the full list.
                  </p>
                )}
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
