"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ContractImportPanel } from "@/components/ContractImportPanel";
import { PerfCharts, type MetricSeries } from "@/components/PerfCharts";
import { addWeeks, currentWeek, isCurrentWeek, weekLabel } from "@/lib/week";
import { actorLabel, TEAMS } from "@/lib/people";
import { metricPeriodLabel } from "@/lib/metric-period";

type Win = { id: string; body: string; happened_on: string };
type Converted = "unknown" | "yes" | "no";
type LeadSource = "form" | "call" | "other";
type Lead = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  source: LeadSource;
  received_on: string;
  notes: string;
  converted: Converted;
  client_note: string;
  answered_at: string;
};
const LEAD_SOURCES: { value: LeadSource; label: string }[] = [
  { value: "form", label: "Filled a form" },
  { value: "call", label: "Called in" },
  { value: "other", label: "Other" },
];
const CONVERTED_LABEL: Record<Converted, string> = {
  unknown: "Waiting on client",
  yes: "Converted",
  no: "Did not convert",
};
type MetricRow = { id: string; metric: string; period: string; value: number; unit: string };
type Contract = {
  pct: number;
  doneCount: number;
  totalCount: number;
  // Recurring deliverables whose current period is still running. Not scored, so
  // the percentage is about periods that have actually closed.
  inFlightCount: number;
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
type CadenceUnit = "weekly" | "monthly" | "quarterly";
const CADENCE_UNIT_LABEL: Record<CadenceUnit, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
};
type Deliverable = {
  id: string;
  category: string;
  team: string;
  name: string;
  cadence: string;
  kind: Kind;
  cadence_unit: CadenceUnit;
  due_date: string | null;
};
type BehindItem = {
  deliverable_id: string;
  category: string;
  name: string;
  kind: Kind;
  cadence_unit: CadenceUnit | null;
  due_date: string;
  status: Status;
};
type Row = {
  deliverable_id: string;
  category: string;
  name: string;
  cadence: string;
  kind: Kind;
  cadence_unit: CadenceUnit;
  status: Status;
  work_done: string;
  next_steps: string;
  notes: string;
  logged_by: string;
  updated_at: string;
};

// Per-row save state. A save that failed has to look different from one that
// worked: the old code fired the request and never read the response, so a
// dropped connection left the typed text on screen looking saved.
type SaveState = "saving" | "saved" | "failed";

// "2 hours ago" for a recent write, a date once that stops being the useful fact.
function relativeTime(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

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
  const [nd, setNd] = useState<{
    category: string;
    team: string;
    name: string;
    cadence: string;
    kind: Kind;
    cadenceUnit: CadenceUnit;
    dueDate: string;
  }>({
    category: "",
    team: "",
    name: "",
    cadence: "",
    kind: "recurring",
    cadenceUnit: "monthly",
    dueDate: "",
  });
  const [wins, setWins] = useState<Win[]>([]);
  const [metricsRaw, setMetricsRaw] = useState<MetricRow[]>([]);
  const [contract, setContract] = useState<Contract | null>(null);
  const [behind, setBehind] = useState<BehindItem[]>([]);
  const [showBehindOnly, setShowBehindOnly] = useState(false);
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  // What failed to save, per row, so Retry re-sends every field and not just the
  // last one the person happened to leave.
  const [failedPatch, setFailedPatch] = useState<Record<string, Partial<Row>>>({});
  const [metricError, setMetricError] = useState("");
  const [nw, setNw] = useState({ body: "", happenedOn: "" });
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadScope, setLeadScope] = useState<"week" | "all">("week");
  const [nl, setNl] = useState<{
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    source: LeadSource;
    receivedOn: string;
    notes: string;
  }>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    source: "form",
    receivedOn: "",
    notes: "",
  });
  const [nm, setNm] = useState({ metric: "", period: "", value: "", unit: "" });
  const [role, setRole] = useState<"admin" | "forecast" | null>(null);
  const isAdmin = role === "admin";

  const shareUrl =
    token && typeof window !== "undefined"
      ? `${window.location.origin}/snapshot/${token}`
      : "";

  const fetchWeek = useCallback(
    async (w: string) => {
      try {
        const res = await fetch(`/api/snapshot/accounts/${id}/week?week=${w}`);
        if (res.status === 401) return router.push("/login");
        if (res.ok) {
          setRows((await res.json()).rows || []);
          // Save badges belong to the week that was on screen. Carrying a "failed"
          // marker into a different week would point at the wrong row.
          setSaveState({});
          setFailedPatch({});
        }
      } catch {
        setError("Network error. Check your connection and try again.");
      }
    },
    [id, router]
  );

  const loadMeta = useCallback(async () => {
    try {
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
      setBehind(data.behind || []);
    } catch {
      setError("Network error. Check your connection and try again.");
    }
  }, [id, router]);

  // Leads are scoped to the week being viewed by default, with "All" as an
  // escape hatch — the same choice the client gets on the shared link.
  const fetchLeads = useCallback(
    async (w: string, scope: "week" | "all") => {
      try {
        const res = await fetch(
          `/api/snapshot/accounts/${id}/leads${scope === "week" ? `?week=${w}` : ""}`
        );
        if (res.status === 401) return router.push("/login");
        if (res.ok) setLeads((await res.json()).leads || []);
      } catch {
        setError("Network error. Check your connection and try again.");
      }
    },
    [id, router]
  );

  async function addLead(e: FormEvent) {
    e.preventDefault();
    if (!nl.firstName.trim()) return;
    const res = await fetch(`/api/snapshot/accounts/${id}/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nl),
    });
    if (!res.ok) { setError("Could not add lead."); return; }
    // Source and date carry over: leads get entered in batches off one report.
    setNl({
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      source: nl.source,
      receivedOn: nl.receivedOn,
      notes: "",
    });
    fetchLeads(week, leadScope);
  }

  async function patchLead(leadId: string, patch: Record<string, unknown>) {
    await fetch(`/api/snapshot/lead/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    fetchLeads(week, leadScope);
  }

  async function removeLead(leadId: string) {
    if (!confirm("Remove this lead? The client's answer goes with it.")) return;
    await fetch(`/api/snapshot/lead/${leadId}`, { method: "DELETE" });
    fetchLeads(week, leadScope);
  }

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
    setMetricError("");
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
    if (!res.ok) {
      // The server explains an unreadable month specifically. Showing that beats
      // "Could not save metric", which leaves the person guessing which field.
      const data = await res.json().catch(() => ({}));
      setMetricError(data.error || "Could not save metric.");
      return;
    }
    setNm({ metric: nm.metric, period: "", value: "", unit: nm.unit });
    loadMeta();
  }
  async function removeMetric(mId: string) {
    await fetch(`/api/snapshot/metric/${mId}`, { method: "DELETE" });
    loadMeta();
  }

  useEffect(() => { loadMeta(); }, [loadMeta]);
  useEffect(() => { fetchWeek(week); }, [week, fetchWeek]);
  useEffect(() => { fetchLeads(week, leadScope); }, [week, leadScope, fetchLeads]);
  useEffect(() => {
    fetch("/api/auth")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.authenticated) setRole(data.role);
      })
      .catch(() => {});
  }, []);

  // Undefined keys are dropped rather than assigned, so a caller passing a field
  // it has no news about ("the response did not include an author") leaves the
  // existing value alone instead of blanking it.
  function patchRow(delivId: string, patch: Partial<Row>) {
    const defined = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined)
    ) as Partial<Row>;
    setRows((rs) => rs.map((r) => (r.deliverable_id === delivId ? { ...r, ...defined } : r)));
  }

  /**
   * Write one field of one row.
   *
   * The result is read and shown. This used to be fire-and-forget: the request
   * went out, the response was dropped on the floor, and a failed save was
   * indistinguishable from a good one — the text stayed on screen and vanished on
   * the next reload. Now a row says saving, saved, or failed, and a failure keeps
   * a Retry next to it so the typing is not lost.
   */
  async function saveEntry(delivId: string, patch: Partial<Row>) {
    setSaveState((s) => ({ ...s, [delivId]: "saving" }));
    try {
      const res = await fetch("/api/snapshot/entry", {
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
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) {
        setSaveState((s) => ({ ...s, [delivId]: "failed" }));
        setFailedPatch((f) => ({ ...f, [delivId]: { ...(f[delivId] || {}), ...patch } }));
        return;
      }
      // Reflect the new author on the row without reloading the whole week.
      const data = await res.json().catch(() => ({}));
      patchRow(delivId, {
        logged_by: typeof data.loggedBy === "string" ? data.loggedBy : undefined,
        updated_at: typeof data.updatedAt === "string" ? data.updatedAt : undefined,
      });
      setSaveState((s) => ({ ...s, [delivId]: "saved" }));
      setFailedPatch((f) => {
        if (!f[delivId]) return f;
        const next = { ...f };
        delete next[delivId];
        return next;
      });
    } catch {
      setSaveState((s) => ({ ...s, [delivId]: "failed" }));
      setFailedPatch((f) => ({ ...f, [delivId]: { ...(f[delivId] || {}), ...patch } }));
    }
  }

  // Re-send everything that failed on this row, not just the last field touched.
  async function retryEntry(delivId: string) {
    const pending = failedPatch[delivId];
    if (!pending) return;
    await saveEntry(delivId, pending);
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
    // Category and team persist between adds: deliverables are usually entered
    // a group at a time.
    setNd({ category: nd.category, team: nd.team, name: "", cadence: "", kind: nd.kind, cadenceUnit: nd.cadenceUnit, dueDate: "" });
    await loadMeta();
    fetchWeek(week);
  }

  async function updateDeliverable(dId: string, patch: Partial<Deliverable>) {
    const { cadence_unit, due_date, ...rest } = patch;
    const body: Record<string, unknown> = { ...rest };
    if (cadence_unit) body.cadenceUnit = cadence_unit;
    if (due_date !== undefined) body.dueDate = due_date;
    await fetch(`/api/snapshot/deliverables/${dId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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

  const behindIds = new Set(behind.map((b) => b.deliverable_id));
  const visibleRows = showBehindOnly ? rows.filter((r) => behindIds.has(r.deliverable_id)) : rows;
  const grouped = groupByCategory(visibleRows);

  return (
    <div className="app-shell">
      <div className="page-actions">
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

      <main className="container container-wide stack">
        <div className="cal-header">
          <div>
            <p className="eyebrow">Account snapshot</p>
            <h1 className="h1">{name}</h1>
            {isAdmin ? (
              <Link className="muted" href={`/admin/revenue/${id}`} style={{ fontSize: 13 }}>
                View revenue →
              </Link>
            ) : null}
          </div>
          {view === "team" ? (
            <div className="cal-nav">
              <button className="cal-nav-btn" aria-label="Previous week" onClick={() => setWeek((w) => addWeeks(w, -1))}>‹</button>
              <span className="cal-month">
                {weekLabel(week)}{isCurrentWeek(week) ? " · This week" : ""}
              </span>
              <button className="cal-nav-btn" aria-label="Next week" onClick={() => setWeek((w) => addWeeks(w, 1))}>›</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setWeek(currentWeek())}>This week</button>
            </div>
          ) : null}
        </div>

        {view === "team" ? (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Weekly deliverables need a status every week. Monthly and quarterly ones keep
            whatever status you set across every week in that period, then reset to
            &quot;Not started&quot; once the next month or quarter begins.
          </p>
        ) : null}

        {error ? <p className="error">{error}</p> : null}

        {contract ? (
          <div className="card card-pad row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <strong>Contract fulfillment</strong>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
                {contract.totalCount > 0
                  ? `${contract.doneCount} of ${contract.totalCount} recurring deliverables landed in their last period.`
                  : "Nothing has been due long enough to score yet."}
                {/* Named so the figure is readable: a low count here explains why
                    the percentage is based on fewer items than the account has. */}
                {contract.inFlightCount > 0
                  ? ` ${contract.inFlightCount} still in this period.`
                  : ""}
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

        {view === "team" && behind.length > 0 ? (
          <div className="card card-pad row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <span>
              <strong style={{ color: "var(--danger)" }}>{behind.length}</strong>{" "}
              deliverable{behind.length === 1 ? "" : "s"} overdue
            </span>
            <label className="row" style={{ gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={showBehindOnly}
                onChange={(e) => setShowBehindOnly(e.target.checked)}
              />
              <span className="muted">Show only what&apos;s behind</span>
            </label>
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
        {managing && isAdmin ? (
          <ContractImportPanel
            clientId={id}
            onAdded={() => {
              loadMeta();
              fetchWeek(week);
            }}
          />
        ) : null}

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
                    {/* Owning team. Unassigned stays visible to everyone, which
                        is why "Any team" is a real choice and not a blank. */}
                    <select defaultValue={d.team || ""} aria-label="Owning team"
                      onChange={(e) => updateDeliverable(d.id, { team: e.target.value })}>
                      <option value="">Any team</option>
                      {TEAMS.map((t) => (
                        <option key={t.slug} value={t.slug}>{t.label}</option>
                      ))}
                    </select>
                    <input defaultValue={d.name} placeholder="Deliverable"
                      onBlur={(e) => e.target.value !== d.name && updateDeliverable(d.id, { name: e.target.value })} />
                    <input defaultValue={d.cadence} placeholder="Cadence (e.g. 2x/mo)"
                      onBlur={(e) => e.target.value !== d.cadence && updateDeliverable(d.id, { cadence: e.target.value })} />
                    <select defaultValue={d.kind}
                      onChange={(e) => updateDeliverable(d.id, { kind: e.target.value as Kind })}>
                      <option value="recurring">Recurring</option>
                      <option value="one_time">One-time setup</option>
                    </select>
                    {d.kind === "recurring" ? (
                      <select defaultValue={d.cadence_unit}
                        title="How often this resets to Not started"
                        onChange={(e) => updateDeliverable(d.id, { cadence_unit: e.target.value as CadenceUnit })}>
                        {(["weekly", "monthly", "quarterly"] as CadenceUnit[]).map((u) => (
                          <option key={u} value={u}>{CADENCE_UNIT_LABEL[u]}</option>
                        ))}
                      </select>
                    ) : (
                      <input type="date" defaultValue={d.due_date || ""}
                        title="Optional due date — flags this overdue on the behind report"
                        onBlur={(e) => e.target.value !== (d.due_date || "") && updateDeliverable(d.id, { due_date: e.target.value })} />
                    )}
                    <button className="btn btn-danger btn-sm" onClick={() => removeDeliverable(d.id)}>Remove</button>
                  </div>
                ))}
              </div>
            )}
            <form className="snap-deliv-edit" onSubmit={addDeliverable}>
              <input value={nd.category} onChange={(e) => setNd({ ...nd, category: e.target.value })} placeholder="Category" />
              <select value={nd.team} onChange={(e) => setNd({ ...nd, team: e.target.value })} aria-label="Owning team">
                <option value="">Any team</option>
                {TEAMS.map((t) => (
                  <option key={t.slug} value={t.slug}>{t.label}</option>
                ))}
              </select>
              <input value={nd.name} onChange={(e) => setNd({ ...nd, name: e.target.value })} placeholder="New deliverable" />
              <input value={nd.cadence} onChange={(e) => setNd({ ...nd, cadence: e.target.value })} placeholder="Cadence" />
              <select value={nd.kind} onChange={(e) => setNd({ ...nd, kind: e.target.value as Kind })}>
                <option value="recurring">Recurring</option>
                <option value="one_time">One-time setup</option>
              </select>
              {nd.kind === "recurring" ? (
                <select value={nd.cadenceUnit}
                  title="How often this resets to Not started"
                  onChange={(e) => setNd({ ...nd, cadenceUnit: e.target.value as CadenceUnit })}>
                  {(["weekly", "monthly", "quarterly"] as CadenceUnit[]).map((u) => (
                    <option key={u} value={u}>{CADENCE_UNIT_LABEL[u]}</option>
                  ))}
                </select>
              ) : (
                <input type="date" value={nd.dueDate}
                  title="Optional due date — flags this overdue on the behind report"
                  onChange={(e) => setNd({ ...nd, dueDate: e.target.value })} />
              )}
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
                          <div className="snap-name">
                            {r.name}
                            {behindIds.has(r.deliverable_id) ? (
                              <span style={{ color: "var(--danger)", fontWeight: 600, fontSize: 12, marginLeft: 8 }}>
                                OVERDUE
                              </span>
                            ) : null}
                          </div>
                          <div className="snap-cadence">
                            {r.kind === "one_time" ? "One-time" : CADENCE_UNIT_LABEL[r.cadence_unit]}
                            {r.cadence ? ` · ${r.cadence}` : ""}
                          </div>
                          {/* Who logged this and when. Blank for a period nobody
                              has touched, and for entries that predate the app
                              recording it. Team-side only. */}
                          {r.logged_by || r.updated_at ? (
                            <div className="snap-logged-by">
                              {r.logged_by ? actorLabel(r.logged_by) : "Logged"}
                              {r.updated_at ? ` · ${relativeTime(r.updated_at)}` : ""}
                            </div>
                          ) : null}
                        </div>
                        <div className="snap-card-actions">
                          {saveState[r.deliverable_id] === "saving" ? (
                            <span className="snap-save snap-save-busy">Saving…</span>
                          ) : saveState[r.deliverable_id] === "saved" ? (
                            <span className="snap-save snap-save-ok">Saved</span>
                          ) : saveState[r.deliverable_id] === "failed" ? (
                            <span className="snap-save snap-save-bad">
                              Not saved
                              <button
                                type="button"
                                className="link-button"
                                onClick={() => retryEntry(r.deliverable_id)}
                              >
                                Retry
                              </button>
                            </span>
                          ) : null}
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
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div>
              <strong>Leads</strong>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
                Log every lead you see come through. The client marks each one converted or
                not from their snapshot link.
              </p>
            </div>
            <select
              aria-label="Which leads to show"
              value={leadScope}
              onChange={(e) => setLeadScope(e.target.value as "week" | "all")}
            >
              <option value="week">This week only</option>
              <option value="all">All leads</option>
            </select>
          </div>
          <form className="snap-lead-form" onSubmit={addLead}>
            <input value={nl.firstName} onChange={(e) => setNl({ ...nl, firstName: e.target.value })} placeholder="First name" />
            <input value={nl.lastName} onChange={(e) => setNl({ ...nl, lastName: e.target.value })} placeholder="Last name" />
            <input value={nl.email} onChange={(e) => setNl({ ...nl, email: e.target.value })} placeholder="Email" type="email" />
            <input value={nl.phone} onChange={(e) => setNl({ ...nl, phone: e.target.value })} placeholder="Phone" />
            <select value={nl.source} onChange={(e) => setNl({ ...nl, source: e.target.value as LeadSource })}>
              {LEAD_SOURCES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <input type="date" value={nl.receivedOn}
              title="Date they filled the form or called. Defaults to today."
              onChange={(e) => setNl({ ...nl, receivedOn: e.target.value })} />
            <button className="btn btn-sm" type="submit">Add lead</button>
          </form>
          {leads.length === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              {leadScope === "week"
                ? "No leads logged for this week yet."
                : "No leads logged for this account yet."}
            </p>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {leads.map((l) => (
                <div key={l.id} className="snap-lead-row">
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontWeight: 600 }}>
                      {[l.first_name, l.last_name].filter(Boolean).join(" ") || "Unnamed lead"}
                    </div>
                    <div className="muted" style={{ fontSize: 12.5 }}>
                      {[l.email, l.phone].filter(Boolean).join(" · ")}
                      {l.email || l.phone ? " · " : ""}
                      {LEAD_SOURCES.find((s) => s.value === l.source)?.label} · {l.received_on}
                    </div>
                    {l.client_note ? (
                      <div className="muted" style={{ fontSize: 12.5 }}>
                        Client said: {l.client_note}
                      </div>
                    ) : null}
                  </div>
                  {/* Normally the client's answer, but editable here for the
                      ones who answer on a call instead of on the link. */}
                  <select
                    value={l.converted}
                    aria-label="Converted"
                    onChange={(e) => patchLead(l.id, { converted: e.target.value })}
                  >
                    {(["unknown", "yes", "no"] as Converted[]).map((c) => (
                      <option key={c} value={c}>{CONVERTED_LABEL[c]}</option>
                    ))}
                  </select>
                  <button className="btn btn-ghost btn-sm" aria-label="Remove lead" onClick={() => removeLead(l.id)}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>

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
            {/* A datalist of the metrics already on this account, so a second
                month of "Leads" is picked rather than retyped. A near-miss used to
                fork the series in two and plot half the data. */}
            <input
              list="snap-metric-names"
              value={nm.metric}
              onChange={(e) => setNm({ ...nm, metric: e.target.value })}
              placeholder="Metric (e.g. Leads)"
            />
            <datalist id="snap-metric-names">
              {Array.from(new Set(metricsRaw.map((m) => m.metric))).map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            {/* A month picker, so the stored period is always canonical YYYY-MM and
                the chart's x-axis sorts chronologically. Typed months are still
                accepted by the API for anything scripted. */}
            <input
              type="month"
              value={nm.period}
              onChange={(e) => setNm({ ...nm, period: e.target.value })}
              aria-label="Month"
            />
            <input value={nm.value} onChange={(e) => setNm({ ...nm, value: e.target.value })} placeholder="Value" type="number" step="any" />
            <input value={nm.unit} onChange={(e) => setNm({ ...nm, unit: e.target.value })} placeholder="Unit ($, %, blank)" />
            <button className="btn btn-sm" type="submit">Add / update</button>
          </form>
          {metricError ? <p className="error" style={{ margin: 0 }}>{metricError}</p> : null}
          {metricsRaw.length > 0 ? (
            <div className="snap-metric-list">
              {metricsRaw.map((m) => (
                <div key={m.id} className="snap-metric-row">
                  <span><strong>{m.metric}</strong> · {metricPeriodLabel(m.period)}</span>
                  <span>{m.unit === "$" ? "$" : ""}{m.value.toLocaleString()}{m.unit === "%" ? "%" : ""}</span>
                  <button className="btn btn-ghost btn-sm" aria-label="Remove metric" onClick={() => removeMetric(m.id)}>×</button>
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
