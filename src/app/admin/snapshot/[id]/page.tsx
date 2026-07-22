"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { Brand } from "@/components/Brand";
import { PerfCharts, type MetricSeries } from "@/components/PerfCharts";
import { addWeeks, currentWeek, isCurrentWeek, weekLabel } from "@/lib/week";

type Win = { id: string; body: string; happened_on: string };
type MetricRow = { id: string; metric: string; period: string; value: number; unit: string };
type Contract = {
  pct: number;
  doneCount: number;
  totalCount: number;
  onTrack: boolean;
  label: string;
};

function contractColor(c: Contract): string {
  if (c.totalCount === 0) return "var(--text-muted)";
  if (c.pct >= 90) return "var(--success)";
  if (c.pct >= 60) return "var(--warning)";
  return "var(--danger)";
}

function groupSeries(rows: MetricRow[]): MetricSeries[] {
  const map = new Map<string, MetricSeries>();
  for (const r of rows) {
    let s = map.get(r.metric);
    if (!s) { s = { metric: r.metric, unit: r.unit, points: [] }; map.set(r.metric, s); }
    if (r.unit && !s.unit) s.unit = r.unit;
    s.points.push({ period: r.period, value: r.value });
  }
  for (const s of map.values()) s.points.sort((a, b) => a.period.localeCompare(b.period));
  return Array.from(map.values());
}

type Status = "not_started" | "in_progress" | "completed" | "shared" | "approved";
const STATUSES: { value: Status; label: string }[] = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "shared", label: "Shared — awaiting approval" },
  { value: "approved", label: "Approved" },
];

type Kind = "recurring" | "one_time";
type Deliverable = { id: string; category: string; name: string; cadence: string; kind: Kind };
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

function groupByCategory(rows: Row[]): [string, Row[]][] {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.category.trim() || "Other";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return Array.from(map.entries());
}

export default function SnapshotEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [name, setName] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [week, setWeek] = useState(currentWeek());
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [managing, setManaging] = useState(false);
  const [view, setView] = useState<"team" | "client">("team");
  const [nd, setNd] = useState<{ category: string; name: string; cadence: string; kind: Kind }>({
    category: "",
    name: "",
    cadence: "",
    kind: "recurring",
  });
  const [wins, setWins] = useState<Win[]>([]);
  const [metricsRaw, setMetricsRaw] = useState<MetricRow[]>([]);
  const [contract, setContract] = useState<Contract | null>(null);
  const [nw, setNw] = useState({ body: "", happenedOn: "" });
  const [nm, setNm] = useState({ metric: "", period: "", value: "", unit: "" });

  const shareUrl =
    token && typeof window !== "undefined"
      ? `${window.location.origin}/snapshot/${token}`
      : "";

  const fetchWeek = useCallback(
    async (w: string) => {
      const res = await fetch(`/api/snapshot/accounts/${id}/week?week=${w}`);
      if (res.status === 401) return router.push("/login");
      if (res.ok) setRows((await res.json()).rows || []);
    },
    [id, router]
  );

  const loadMeta = useCallback(async () => {
    const res = await fetch(`/api/snapshot/accounts/${id}`);
    if (res.status === 401) return router.push("/login");
    if (!res.ok) { setError("Account not found."); return; }
    const data = await res.json();
    setName(data.account.name);
    setDeliverables(data.deliverables || []);
    setToken(data.token || null);
    setWins(data.wins || []);
    setMetricsRaw(data.metricsRaw || []);
    setContract(data.contract || null);
  }, [id, router]);

  async function addWin(e: FormEvent) {
    e.preventDefault();
    if (!nw.body.trim()) return;
    const res = await fetch("/api/snapshot/win", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: id, body: nw.body, happenedOn: nw.happenedOn }),
    });
    if (!res.ok) { setError("Could not add win."); return; }
    setNw({ body: "", happenedOn: "" });
    loadMeta();
  }
  async function removeWin(winId: string) {
    await fetch(`/api/snapshot/win/${winId}`, { method: "DELETE" });
    loadMeta();
  }
  async function addMetric(e: FormEvent) {
    e.preventDefault();
    if (!nm.metric.trim() || !nm.period.trim() || nm.value === "") return;
    const res = await fetch("/api/snapshot/metric", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: id,
        metric: nm.metric,
        period: nm.period,
        value: Number(nm.value),
        unit: nm.unit,
      }),
    });
    if (!res.ok) { setError("Could not save metric."); return; }
    setNm({ metric: nm.metric, period: "", value: "", unit: nm.unit });
    loadMeta();
  }
  async function removeMetric(mId: string) {
    await fetch(`/api/snapshot/metric/${mId}`, { method: "DELETE" });
    loadMeta();
  }

  useEffect(() => { loadMeta(); }, [loadMeta]);
  useEffect(() => { fetchWeek(week); }, [week, fetchWeek]);

  function patchRow(delivId: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.deliverable_id === delivId ? { ...r, ...patch } : r)));
  }

  async function saveEntry(delivId: string, patch: Partial<Row>) {
    await fetch("/api/snapshot/entry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deliverableId: delivId,
        weekStart: week,
        status: patch.status,
        workDone: patch.work_done,
        nextSteps: patch.next_steps,
        notes: patch.notes,
      }),
    });
  }

  async function addDeliverable(e: FormEvent) {
    e.preventDefault();
    if (!nd.name.trim()) return;
    const res = await fetch(`/api/snapshot/accounts/${id}/deliverables`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nd),
    });
    if (!res.ok) { setError("Could not add deliverable."); return; }
    setNd({ category: nd.category, name: "", cadence: "", kind: nd.kind });
    await loadMeta();
    fetchWeek(week);
  }

  async function updateDeliverable(dId: string, patch: Partial<Deliverable>) {
    await fetch(`/api/snapshot/deliverables/${dId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    await loadMeta();
    fetchWeek(week);
  }

  async function removeDeliverable(dId: string) {
    if (!confirm("Remove this deliverable? Past entries are kept but it stops showing.")) return;
    await fetch(`/api/snapshot/deliverables/${dId}`, { method: "DELETE" });
    await loadMeta();
    fetchWeek(week);
  }

  async function copyShare() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const grouped = groupByCategory(rows);

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand href="/admin" />
        <div className="row">
          <Link className="btn btn-ghost btn-sm" href="/admin/snapshot">All accounts</Link>
          <div className="tabs" style={{ marginBottom: 0 }}>
            <button
              className={`tab ${view === "team" ? "active" : ""}`}
              onClick={() => setView("team")}
            >
              Team view
            </button>
            <button
              className={`tab ${view === "client" ? "active" : ""}`}
              onClick={() => setView("client")}
            >
              Client view
            </button>
          </div>
          {view === "team" ? (
            <button className="btn btn-secondary btn-sm" onClick={() => setManaging((v) => !v)}>
              {managing ? "Done editing" : "Edit deliverables"}
            </button>
          ) : null}
        </div>
      </header>

      <main className="container container-wide stack">
        <div className="cal-header">
          <div>
            <p className="eyebrow">Account snapshot</p>
            <h1 className="h1">{name}</h1>
            <Link className="muted" href={`/admin/revenue/${id}`} style={{ fontSize: 13 }}>
              View revenue →
            </Link>
          </div>
          {view === "team" ? (
            <div className="cal-nav">
              <button className="cal-nav-btn" onClick={() => setWeek((w) => addWeeks(w, -1))}>‹</button>
              <span className="cal-month">
                {weekLabel(week)}{isCurrentWeek(week) ? " · This week" : ""}
              </span>
              <button className="cal-nav-btn" onClick={() => setWeek((w) => addWeeks(w, 1))}>›</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setWeek(currentWeek())}>This week</button>
            </div>
          ) : null}
        </div>

        {error ? <p className="error">{error}</p> : null}

        {contract ? (
          <div className="card card-pad row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <strong>Contract fulfillment</strong>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
                {contract.totalCount > 0
                  ? `${contract.doneCount} of ${contract.totalCount} recurring deliverables currently completed.`
                  : "No recurring deliverables tracked yet."}
              </p>
            </div>
            <span style={{ color: contractColor(contract), fontWeight: 700, fontSize: 20 }}>
              {contract.totalCount > 0 ? `${contract.pct}%` : "—"}
              <span className="muted" style={{ marginLeft: 8, fontSize: 13, fontWeight: 400 }}>
                {contract.label}
              </span>
            </span>
          </div>
        ) : null}

        {view === "client" ? (
          <div className="stack" style={{ gap: 18 }}>
            {token ? (
              <div className="card card-pad snap-share">
                <div>
                  <strong>Client link</strong>
                  <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
                    Read-only. Send this to the client — it always shows the latest.
                  </p>
                </div>
                <div className="copy-box" style={{ flex: 1, minWidth: 220 }}>
                  <code>{shareUrl}</code>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={copyShare}>
                  {copied ? "Copied" : "Copy link"}
                </button>
              </div>
            ) : null}
            {shareUrl ? (
              <div className="snap-preview">
                <div className="snap-preview-bar">
                  <span>Exactly what the client sees at this link</span>
                  <a className="btn btn-ghost btn-sm" href={shareUrl} target="_blank" rel="noreferrer">
                    Open in new tab ↗
                  </a>
                </div>
                <iframe
                  key={shareUrl}
                  className="snap-preview-frame"
                  src={shareUrl}
                  title="Client snapshot preview"
                />
              </div>
            ) : null}
          </div>
        ) : (
        <>
        {managing ? (
          <div className="card card-pad stack">
            <strong>Deliverables</strong>
            {deliverables.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>None yet. Add the contracted deliverables below.</p>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {deliverables.map((d) => (
                  <div key={d.id} className="snap-deliv-edit">
                    <input defaultValue={d.category} placeholder="Category"
                      onBlur={(e) => e.target.value !== d.category && updateDeliverable(d.id, { category: e.target.value })} />
                    <input defaultValue={d.name} placeholder="Deliverable"
                      onBlur={(e) => e.target.value !== d.name && updateDeliverable(d.id, { name: e.target.value })} />
                    <input defaultValue={d.cadence} placeholder="Cadence (e.g. 2x/mo)"
                      onBlur={(e) => e.target.value !== d.cadence && updateDeliverable(d.id, { cadence: e.target.value })} />
                    <select defaultValue={d.kind}
                      onChange={(e) => updateDeliverable(d.id, { kind: e.target.value as Kind })}>
                      <option value="recurring">Recurring</option>
                      <option value="one_time">One-time setup</option>
                    </select>
                    <button className="btn btn-danger btn-sm" onClick={() => removeDeliverable(d.id)}>Remove</button>
                  </div>
                ))}
              </div>
            )}
            <form className="snap-deliv-edit" onSubmit={addDeliverable}>
              <input value={nd.category} onChange={(e) => setNd({ ...nd, category: e.target.value })} placeholder="Category" />
              <input value={nd.name} onChange={(e) => setNd({ ...nd, name: e.target.value })} placeholder="New deliverable" />
              <input value={nd.cadence} onChange={(e) => setNd({ ...nd, cadence: e.target.value })} placeholder="Cadence" />
              <select value={nd.kind} onChange={(e) => setNd({ ...nd, kind: e.target.value as Kind })}>
                <option value="recurring">Recurring</option>
                <option value="one_time">One-time setup</option>
              </select>
              <button className="btn btn-sm" type="submit">Add</button>
            </form>
          </div>
        ) : null}

        {rows.length === 0 ? (
          <div className="empty">
            <p>No deliverables yet. Click &quot;Edit deliverables&quot; to add them.</p>
          </div>
        ) : (
          <div className="stack" style={{ gap: 18 }}>
            {grouped.map(([category, catRows]) => (
              <div key={category} className="snap-group">
                <div className="snap-cat">{category}</div>
                <div className="stack" style={{ gap: 10 }}>
                  {catRows.map((r) => (
                    <div key={r.deliverable_id} className="snap-card">
                      <div className="snap-card-head">
                        <div>
                          <div className="snap-name">{r.name}</div>
                          {r.cadence ? <div className="snap-cadence">{r.cadence}</div> : null}
                        </div>
                        <select
                          className={`snap-status-select status-${r.status}`}
                          value={r.status}
                          onChange={(e) => {
                            const status = e.target.value as Status;
                            patchRow(r.deliverable_id, { status });
                            saveEntry(r.deliverable_id, { status });
                          }}
                        >
                          {STATUSES.map((s) => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="snap-fields">
                        <label>
                          <span>What we did</span>
                          <textarea
                            value={r.work_done}
                            onChange={(e) => patchRow(r.deliverable_id, { work_done: e.target.value })}
                            onBlur={(e) => saveEntry(r.deliverable_id, { work_done: e.target.value })}
                            placeholder="What got done this week"
                          />
                        </label>
                        <label>
                          <span>Next steps</span>
                          <textarea
                            value={r.next_steps}
                            onChange={(e) => patchRow(r.deliverable_id, { next_steps: e.target.value })}
                            onBlur={(e) => saveEntry(r.deliverable_id, { next_steps: e.target.value })}
                            placeholder="What's coming next"
                          />
                        </label>
                        <label>
                          <span>Notes</span>
                          <textarea
                            value={r.notes}
                            onChange={(e) => patchRow(r.deliverable_id, { notes: e.target.value })}
                            onBlur={(e) => saveEntry(r.deliverable_id, { notes: e.target.value })}
                            placeholder="Anything the client should know"
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="card card-pad stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>Wins</strong>
            <span className="muted" style={{ fontSize: 12 }}>Shown to the client, newest first</span>
          </div>
          {wins.length > 0 ? (
            <div className="stack" style={{ gap: 8 }}>
              {wins.map((w) => (
                <div key={w.id} className="snap-win-edit">
                  <span aria-hidden="true">🏆</span>
                  <div style={{ flex: 1 }}>
                    <div>{w.body}</div>
                    {w.happened_on ? <span className="muted" style={{ fontSize: 12 }}>{w.happened_on}</span> : null}
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => removeWin(w.id)}>Remove</button>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>No wins yet.</p>
          )}
          <form className="row" style={{ gap: 8 }} onSubmit={addWin}>
            <input style={{ flex: 1 }} value={nw.body}
              onChange={(e) => setNw({ ...nw, body: e.target.value })}
              placeholder="Add a win the client should see" />
            <input type="date" value={nw.happenedOn}
              onChange={(e) => setNw({ ...nw, happenedOn: e.target.value })} />
            <button className="btn btn-sm" type="submit">Add win</button>
          </form>
        </div>

        <div className="card card-pad stack">
          <strong>Performance</strong>
          <PerfCharts series={groupSeries(metricsRaw)} />
          <form className="snap-metric-form" onSubmit={addMetric}>
            <input value={nm.metric} onChange={(e) => setNm({ ...nm, metric: e.target.value })} placeholder="Metric (e.g. Leads)" />
            <input value={nm.period} onChange={(e) => setNm({ ...nm, period: e.target.value })} placeholder="Period (YYYY-MM)" />
            <input value={nm.value} onChange={(e) => setNm({ ...nm, value: e.target.value })} placeholder="Value" type="number" step="any" />
            <input value={nm.unit} onChange={(e) => setNm({ ...nm, unit: e.target.value })} placeholder="Unit ($, %, blank)" />
            <button className="btn btn-sm" type="submit">Add / update</button>
          </form>
          {metricsRaw.length > 0 ? (
            <div className="snap-metric-list">
              {metricsRaw.map((m) => (
                <div key={m.id} className="snap-metric-row">
                  <span><strong>{m.metric}</strong> · {m.period}</span>
                  <span>{m.unit === "$" ? "$" : ""}{m.value.toLocaleString()}{m.unit === "%" ? "%" : ""}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => removeMetric(m.id)}>×</button>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Add data points (same metric name across months builds a trend chart).
            </p>
          )}
        </div>
        </>
        )}
      </main>
    </div>
  );
}
