"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ContractImportPanel } from "@/components/ContractImportPanel";
import { SnapshotDeskWeeklyWin, type DeskWeekWin } from "@/components/SnapshotDeskAccountViews";
import { SnapshotWeekDepartments } from "@/components/SnapshotWeekDepartments";
import { addWeeks, currentWeek, isCurrentWeek, weekLabel } from "@/lib/week";
import { TEAMS } from "@/lib/people";
import { metricPeriodLabel } from "@/lib/metric-period";
import { fillViewerSlug, type FillViewer } from "@/lib/snapshot-fill";

type Section = "week" | "leads" | "wins" | "setup" | "client";

const SECTIONS: { value: Section; label: string }[] = [
  { value: "week", label: "This week" },
  { value: "leads", label: "Leads" },
  { value: "wins", label: "Wins" },
  { value: "setup", label: "Setup" },
  { value: "client", label: "Client view" },
];

type Win = { id: string; body: string; happened_on: string; week_start?: string; logged_by?: string };
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
type RevenueReport = {
  id: string;
  month: string;
  amount: number;
  note: string;
  reported_at: string;
  accepted_at: string;
};
const CONVERTED_LABEL: Record<Converted, string> = {
  unknown: "Not marked",
  yes: "Converted",
  no: "Did not convert",
};
type Contract = {
  pct: number;
  doneCount: number;
  totalCount: number;
  inFlightCount: number;
  onTrack: boolean;
  label: string;
};

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
export default function SnapshotEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [name, setName] = useState("");
  const [launchDate, setLaunchDate] = useState<string | null>(null);
  const [contractEnd, setContractEnd] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [week, setWeek] = useState(currentWeek());
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [section, setSection] = useState<Section>("week");
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
  const [contract, setContract] = useState<Contract | null>(null);
  const [nw, setNw] = useState({ body: "", happenedOn: "" });
  const [leads, setLeads] = useState<Lead[]>([]);
  const [revReports, setRevReports] = useState<RevenueReport[]>([]);
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
  const [viewer, setViewer] = useState<FillViewer>({ role: null, person: null, owner: false });
  const isAdmin = viewer.role === "admin";

  const shareUrl =
    token && typeof window !== "undefined"
      ? `${window.location.origin}/snapshot/${token}`
      : "";

  const loadMeta = useCallback(async () => {
    try {
      const res = await fetch(`/api/snapshot/accounts/${id}`);
      if (res.status === 401) return router.push("/login");
      if (!res.ok) { setError("Account not found."); return; }
      const data = await res.json();
      setName(data.account.name);
      setLaunchDate(typeof data.account.launchDate === "string" ? data.account.launchDate : null);
      setContractEnd(typeof data.account.contractEnd === "string" ? data.account.contractEnd : null);
      setDeliverables(data.deliverables || []);
      setToken(data.token || null);
      setWins(data.wins || []);
      setContract(data.contract || null);
      setRevReports(data.revenueReports || []);
    } catch {
      setError("Network error. Check your connection and try again.");
    }
  }, [id, router]);

  async function saveLaunchDate(next: string) {
    const value = next.trim();
    setLaunchDate(value || null);
    try {
      const res = await fetch(`/api/snapshot/accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ launchDate: value || null }),
      });
      if (!res.ok) {
        setError("Could not save the launch date.");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (typeof data.launchDate === "string" || data.launchDate === null) {
        setLaunchDate(data.launchDate);
      }
      if (typeof data.contractEnd === "string" || data.contractEnd === null) {
        setContractEnd(data.contractEnd);
      }
    } catch {
      setError("Could not save the launch date.");
    }
  }

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

  // Taking the client's figure into rev_metrics. Deliberately a decision
  // someone makes, not something their typing does on its own.
  async function acceptRevReport(reportId: string) {
    const res = await fetch(`/api/snapshot/revenue-report/${reportId}`, { method: "POST" });
    if (!res.ok) { setError("Could not accept that revenue figure."); return; }
    setRevReports((await res.json()).reports || []);
  }

  async function dismissRevReport(reportId: string) {
    if (!confirm("Dismiss this reported figure? The client can send a new one.")) return;
    const res = await fetch(`/api/snapshot/revenue-report/${reportId}`, { method: "DELETE" });
    if (!res.ok) { setError("Could not dismiss that revenue figure."); return; }
    setRevReports((await res.json()).reports || []);
  }

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
    if (!confirm("Remove this lead?")) return;
    await fetch(`/api/snapshot/lead/${leadId}`, { method: "DELETE" });
    fetchLeads(week, leadScope);
  }

  async function addWin(e: FormEvent) {
    e.preventDefault();
    if (!nw.body.trim()) return;
    const res = await fetch("/api/snapshot/win", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: id,
        body: nw.body,
        happenedOn: nw.happenedOn,
        weekStart: week,
      }),
    });
    if (!res.ok) { setError("Could not add win."); return; }
    setNw({ body: "", happenedOn: "" });
    loadMeta();
  }
  async function removeWin(winId: string) {
    await fetch(`/api/snapshot/win/${winId}`, { method: "DELETE" });
    loadMeta();
  }

  useEffect(() => { loadMeta(); }, [loadMeta]);
  useEffect(() => { fetchLeads(week, leadScope); }, [week, leadScope, fetchLeads]);
  useEffect(() => {
    fetch("/api/auth")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.authenticated) return;
        setViewer({
          role: data.role,
          person: data.person || null,
          owner: Boolean(data.owner),
        });
      })
      .catch(() => {});
  }, []);

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
  }

  async function removeDeliverable(dId: string) {
    if (!confirm("Remove this deliverable? Past entries are kept but it stops showing.")) return;
    await fetch(`/api/snapshot/deliverables/${dId}`, { method: "DELETE" });
    await loadMeta();
  }

  async function copyShare() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const pendingRev = revReports.filter((r) => !r.accepted_at);
  const leadsWaiting = leads.filter((l) => l.converted === "unknown").length;

  return (
    <div className="ops-page snap-desk">
      <div className="page-actions">
        <Link className="btn btn-ghost btn-sm" href="/admin/snapshot/desk">All snapshots</Link>
        <Link className="btn btn-ghost btn-sm" href="/admin/snapshot/instructions">
          How to fill
        </Link>
        {isAdmin ? (
          <Link className="btn btn-secondary btn-sm" href={`/admin/snapshot/${id}/backfill`}>
            Past six months
          </Link>
        ) : null}
      </div>

      <div className="ops-page-head">
        <div>
          <p className="ops-eyebrow">Account snapshot</p>
          <h1 className="ops-title">{name || "Account"}</h1>
          <label className="snap-section-nav">
            <span>View</span>
            <select
              value={section}
              aria-label="Account snapshot view"
              onChange={(e) => setSection(e.target.value as Section)}
            >
              {SECTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                  {s.value === "leads" && leadsWaiting ? ` (${leadsWaiting})` : ""}
                </option>
              ))}
            </select>
          </label>
          <p className="ops-sub">Log the weekly win, then what each department did.</p>
          <label className="snap-launch">
            <span>Launch</span>
            <input
              type="date"
              value={launchDate || ""}
              aria-label="Account launch date"
              onChange={(e) => void saveLaunchDate(e.target.value)}
            />
            {contractEnd ? (
              <span className="snap-launch-through">
                through{" "}
                {new Date(+contractEnd.slice(0, 4), +contractEnd.slice(5, 7) - 1, +contractEnd.slice(8, 10)).toLocaleDateString(
                  "en-US",
                  { month: "short", day: "numeric", year: "numeric" }
                )}
              </span>
            ) : null}
          </label>
        </div>
        {section === "week" || section === "leads" ? (
          <div className="snap-desk-week">
            <button type="button" className="cal-nav-btn" aria-label="Previous week" onClick={() => setWeek((w) => addWeeks(w, -1))}>‹</button>
            <span className="snap-desk-week-label">
              {weekLabel(week)}{isCurrentWeek(week) ? " · This week" : ""}
            </span>
            <button type="button" className="cal-nav-btn" aria-label="Next week" onClick={() => setWeek((w) => addWeeks(w, 1))}>›</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setWeek(currentWeek())}>This week</button>
          </div>
        ) : null}
      </div>

      {error ? <p className="error">{error}</p> : null}

      {section === "week" ? (
        <>
          {pendingRev.length > 0 ? (
            <div className="snap-desk-inbox">
              <strong>Client-reported revenue waiting</strong>
              {pendingRev.map((r) => (
                <div key={r.id} className="snap-lead-row">
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontWeight: 600 }}>
                      {metricPeriodLabel(r.month)} · ${r.amount.toLocaleString()}
                    </div>
                    <div className="muted" style={{ fontSize: 12.5 }}>
                      Waiting on your review{r.note ? ` · ${r.note}` : ""}
                    </div>
                  </div>
                  <button className="btn btn-sm" onClick={() => acceptRevReport(r.id)}>Accept</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => dismissRevReport(r.id)}>Dismiss</button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="snap-n-db">
            <SnapshotDeskWeeklyWin
              clientId={id}
              clientName={name || "this account"}
              weekStart={week}
              viewerSlug={fillViewerSlug(viewer)}
              wins={wins
                .filter((w) => (w.week_start || "") === week)
                .map(
                  (w): DeskWeekWin => ({
                    id: w.id,
                    client_id: id,
                    body: w.body,
                    happened_on: w.happened_on,
                    logged_by: w.logged_by || "",
                  })
                )}
              onAdded={(win) =>
                setWins((cur) =>
                  cur.some((w) => w.id === win.id)
                    ? cur
                    : [
                        ...cur,
                        {
                          id: win.id,
                          body: win.body,
                          happened_on: win.happened_on,
                          week_start: week,
                          logged_by: win.logged_by,
                        },
                      ]
                )
              }
            />
            <SnapshotWeekDepartments clientId={id} weekStart={week} />
          </div>
        </>
      ) : null}

      {section === "leads" ? (
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
      ) : null}

      {section === "wins" ? (
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
      ) : null}

      {section === "setup" ? (
        <div className="stack" style={{ gap: 18 }}>
          {isAdmin ? (
            <ContractImportPanel
              clientId={id}
              onAdded={() => {
                loadMeta();
              }}
            />
          ) : null}
          <div className="card card-pad stack">
            <strong>Deliverables</strong>
            {contract && isAdmin ? (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                Last closed period (recurring only)
                {contract.totalCount > 0
                  ? `: ${contract.pct}% · ${contract.doneCount} of ${contract.totalCount} landed.`
                  : ": nothing due long enough to score yet."}
                {contract.inFlightCount > 0
                  ? ` ${contract.inFlightCount} still in the current week/month/quarter.`
                  : ""}{" "}
                One-time setup is not in that number.
              </p>
            ) : null}
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Strategy, brand, proof &amp; authority, and video are Client Services;
              cookies and AI chatbots are Web; retention, reviews, and reputation
              are Email (lifecycle); ads are Ads. Specialists only see rows tagged
              or named for their team.
            </p>
            {deliverables.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>None yet. Add the contracted deliverables below.</p>
            ) : (
              <div className="snap-n-db snap-setup-db">
                <div className="snap-setup-card snap-n-head" aria-hidden="true">
                  <span>Category</span>
                  <span>Team</span>
                  <span>Deliverable</span>
                  <span>Cadence</span>
                  <span>Kind</span>
                  <span>Period / due</span>
                  <span />
                </div>
                {deliverables.map((d) => (
                  <div key={d.id} className="snap-setup-card">
                    <input defaultValue={d.category} placeholder="Category"
                      onBlur={(e) => e.target.value !== d.category && updateDeliverable(d.id, { category: e.target.value })} />
                    <select
                      key={`${d.id}-team-${d.team || "none"}`}
                      defaultValue={d.team || ""}
                      aria-label="Owning team"
                      onChange={(e) => updateDeliverable(d.id, { team: e.target.value })}
                    >
                      <option value="">Unassigned</option>
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
            <form className="snap-setup-card" onSubmit={addDeliverable}>
              <input value={nd.category} onChange={(e) => setNd({ ...nd, category: e.target.value })} placeholder="Category" />
              <select value={nd.team} onChange={(e) => setNd({ ...nd, team: e.target.value })} aria-label="Owning team">
                <option value="">Unassigned</option>
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
        </div>
      ) : null}

      {section === "client" ? (
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
      ) : null}
    </div>
  );
}
