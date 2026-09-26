"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ContractImportPanel } from "@/components/ContractImportPanel";
import { SnapshotFillRow, type SnapshotFillSaveOpts, type SnapshotFillSaveState, type SnapshotLinkedTodo } from "@/components/SnapshotFillRow";
import { addWeeks, currentWeek, isCurrentWeek, weekLabel } from "@/lib/week";
import { defaultLoggedForDate } from "@/lib/snapshot-entry-date";
import { TEAMS, teamLabelFor } from "@/lib/people";
import { metricPeriodLabel } from "@/lib/metric-period";
import { type SnapshotStatus } from "@/lib/snapshot-status";
import {
  fillCanSeeAll,
  fillCounts,
  fillFocusTeam,
  fillIsAccountManager,
  fillLane,
  fillPassSummary,
  filterFillRows,
  visibleFillRows,
  type FillFilter,
  type FillViewer,
} from "@/lib/snapshot-fill";

type Section = "week" | "leads" | "wins" | "setup" | "client";

const SECTIONS: { value: Section; label: string }[] = [
  { value: "week", label: "This week" },
  { value: "leads", label: "Leads" },
  { value: "wins", label: "Wins" },
  { value: "setup", label: "Setup" },
  { value: "client", label: "Client view" },
];

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
type RevenueReport = {
  id: string;
  month: string;
  amount: number;
  note: string;
  reported_at: string;
  accepted_at: string;
};
const CONVERTED_LABEL: Record<Converted, string> = {
  unknown: "Waiting on client",
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

type Status = SnapshotStatus;

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
  team: string;
  name: string;
  cadence: string;
  kind: Kind;
  cadence_unit: CadenceUnit;
  due_date: string | null;
  period_start: string;
  week_start: string;
  created_at: string;
  status: Status;
  work_done: string;
  next_steps: string;
  notes: string;
  logged_by: string;
  updated_at: string;
  basecamp_todos: SnapshotLinkedTodo[];
  basecamp_todo_id: string;
  basecamp_project_id: string;
  basecamp_todo_title: string;
  basecamp_todo_url: string;
  basecamp_todo_completed_at: string;
  logged_from: string;
  logged_to: string;
};

// Per-row save state. A save that failed has to look different from one that
// worked: the old code fired the request and never read the response, so a
// dropped connection left the typed text on screen looking saved.
type SaveState = SnapshotFillSaveState;

export default function SnapshotEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [name, setName] = useState("");
  const [launchDate, setLaunchDate] = useState<string | null>(null);
  const [contractEnd, setContractEnd] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [week, setWeek] = useState(currentWeek());
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [section, setSection] = useState<Section>("week");
  const [fillFilter, setFillFilter] = useState<FillFilter>("all");
  const [seeAll, setSeeAll] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [weekLoaded, setWeekLoaded] = useState("");
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
  const [behind, setBehind] = useState<BehindItem[]>([]);
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});
  // What failed to save, per row, so Retry re-sends every field and not just the
  // last one the person happened to leave.
  const [failedPatch, setFailedPatch] = useState<Record<string, Partial<Row>>>({});
  /** Per-row backdate override; resets when the viewed week changes. */
  const [loggedForByRow, setLoggedForByRow] = useState<Record<string, string>>({});
  const [keptIds, setKeptIds] = useState<string[]>([]);
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
  const [viewerReady, setViewerReady] = useState(false);
  const isAdmin = viewer.role === "admin";

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
          setWeekLoaded(w);
          // Save badges belong to the week that was on screen. Carrying a "failed"
          // marker into a different week would point at the wrong row.
          setSaveState({});
          setFailedPatch({});
          setLoggedForByRow({});
          setKeptIds([]);
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
      setLaunchDate(typeof data.account.launchDate === "string" ? data.account.launchDate : null);
      setContractEnd(typeof data.account.contractEnd === "string" ? data.account.contractEnd : null);
      setDeliverables(data.deliverables || []);
      setToken(data.token || null);
      setWins(data.wins || []);
      setContract(data.contract || null);
      setBehind(data.behind || []);
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
  useEffect(() => { fetchWeek(week); }, [week, fetchWeek]);
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
      .catch(() => {})
      .finally(() => setViewerReady(true));
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
  async function saveEntry(
    delivId: string,
    patch: Partial<Row>,
    opts?: SnapshotFillSaveOpts
  ) {
    setSaveState((s) => ({ ...s, [delivId]: "saving" }));
    if (patch.status && fillLane({ deliverable_id: delivId, status: patch.status }, behindIds) === "done") {
      setKeptIds((ids) => (ids.includes(delivId) ? ids : [...ids, delivId]));
      setOpenId(delivId);
    }
    const loggedFor = opts?.loggedFor ?? loggedForForRow(delivId);
    let basecampTodo = opts?.basecampTodo;
    const basecampTodos = opts?.basecampTodos;
    if (
      basecampTodos === undefined &&
      basecampTodo === undefined &&
      Object.prototype.hasOwnProperty.call(patch, "basecamp_todo_id")
    ) {
      const id = (patch.basecamp_todo_id || "").trim();
      basecampTodo = id
        ? {
            id,
            projectId: (patch.basecamp_project_id || "").trim(),
            title: (patch.basecamp_todo_title || "").trim(),
            url: (patch.basecamp_todo_url || "").trim(),
            completedAt: (patch.basecamp_todo_completed_at || "").trim(),
          }
        : null;
    }
    try {
      const body: Record<string, unknown> = {
        deliverableId: delivId,
        weekStart: week,
        loggedFor,
        status: patch.status,
        workDone: patch.work_done,
        nextSteps: patch.next_steps,
        notes: patch.notes,
      };
      if (basecampTodos !== undefined) body.basecampTodos = basecampTodos;
      else if (basecampTodo !== undefined) body.basecampTodo = basecampTodo;
      if (opts?.loggedRange !== undefined) {
        body.loggedFrom = opts.loggedRange?.from || "";
        body.loggedTo = opts.loggedRange?.to || "";
      }
      const res = await fetch("/api/snapshot/entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
      if (loggedFor !== defaultLoggedForDate(week)) {
        void loadMeta();
        void fetchWeek(week);
      }
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

  function loggedForForRow(delivId: string): string {
    // Prefer an explicit date the user picked. Otherwise stamp new activity to
    // today-in-this-week so monthly/quarterly progress shows on the client view
    // for this week instead of staying filed under the 1st of the month.
    if (loggedForByRow[delivId]) return loggedForByRow[delivId];
    return defaultLoggedForDate(week);
  }

  function setLoggedFor(delivId: string, loggedFor: string) {
    setLoggedForByRow((m) => ({ ...m, [delivId]: loggedFor }));
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

  const behindIds = useMemo(
    () => new Set(behind.map((b) => b.deliverable_id)),
    [behind]
  );
  const focusTeam = fillFocusTeam(viewer);
  const canSeeAll = fillCanSeeAll(viewer);
  const isAm = fillIsAccountManager(viewer);
  const viewerTeam = seeAll || isAm ? null : focusTeam;
  const scopedRows = useMemo(() => {
    // Auth has not landed yet: an unscoped default would flash every team's
    // rows to Michael before the owner session is classified as email.
    if (!viewerReady) return [];
    const visible = visibleFillRows(rows, viewerTeam, { accountManager: isAm });
    const q = query.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q)
    );
  }, [rows, viewerTeam, isAm, query, viewerReady]);
  const counts = fillCounts(scopedRows, behindIds);
  const stayOnList = useMemo(() => {
    const ids = new Set(keptIds);
    if (openId) ids.add(openId);
    return ids;
  }, [keptIds, openId]);
  const filteredRows = filterFillRows(scopedRows, fillFilter, behindIds, stayOnList);
  const pendingRev = revReports.filter((r) => !r.accepted_at);
  const leadsWaiting = leads.filter((l) => l.converted === "unknown").length;
  const passLine = fillPassSummary(counts, isCurrentWeek(week));
  const scopeLabel = !viewerReady
    ? "Loading your list"
    : isAm
    ? "All deliverables · strategy first"
    : seeAll || !focusTeam
      ? "All teams"
      : `${teamLabelFor(focusTeam)} team`;

  useEffect(() => {
    if (weekLoaded !== week) return;
    const first = scopedRows.find((r) => fillLane(r, behindIds) !== "done");
    setOpenId(first?.deliverable_id ?? null);
    // Only when that week's rows arrive, not on every keystroke in a field.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- weekLoaded is the gate
  }, [week, weekLoaded]);

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
        {canSeeAll ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setSeeAll((v) => !v)}
          >
            {seeAll ? `Show ${teamLabelFor(focusTeam || "email")} team` : "See all"}
          </button>
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
                  {s.value === "week" && counts.attention ? ` (${counts.attention})` : ""}
                  {s.value === "leads" && leadsWaiting ? ` (${leadsWaiting})` : ""}
                </option>
              ))}
            </select>
          </label>
          <p className="ops-sub">{scopeLabel}</p>
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
          {counts.total > 0 ? (
            <div className={`ads-pass-banner ${counts.attention === 0 ? "is-clear" : "is-work"}`}>
              <p className="ads-pass-banner-line">{passLine}</p>
            </div>
          ) : null}

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

          {counts.total > 0 ? (
            <label className="snap-desk-search snap-desk-client">
              <span>Show</span>
              <select
                value={fillFilter}
                aria-label="Filter this week"
                onChange={(e) => setFillFilter(e.target.value as FillFilter)}
              >
                <option value="all">All · {counts.total}</option>
                <option value="todo">Needs update · {counts.attention}</option>
                <option value="overdue">Overdue · {counts.overdue}</option>
                <option value="done">Logged · {counts.done}</option>
              </select>
            </label>
          ) : null}

          {scopedRows.length > 8 ? (
            <label className="snap-desk-search">
              <span>Find a deliverable</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name or category"
              />
            </label>
          ) : null}

          {!viewerReady ? (
            <div className="empty">
              <p>Loading this week&apos;s pass…</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="empty">
              <p>No deliverables yet. Open Setup to add what this account bought.</p>
              <button type="button" className="btn btn-sm" onClick={() => setSection("setup")}>Open setup</button>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="empty">
              <p>
                {query.trim()
                  ? "Nothing matches that search."
                  : fillFilter === "todo"
                    ? "Clear — nothing left to update in this view."
                    : "Nothing in this filter."}
              </p>
              {fillFilter !== "all" && !query.trim() ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFillFilter("all")}>
                  View all
                </button>
              ) : null}
            </div>
          ) : (
            <div className="snap-n-db">
              <div className="snap-n-cols snap-n-head" aria-hidden="true">
                <span>Deliverable</span>
                <span>Category</span>
                <span>Status</span>
                <span>Period</span>
                <span />
              </div>
              {filteredRows.map((r) => (
                <SnapshotFillRow
                  key={r.deliverable_id}
                  row={r}
                  clientId={id}
                  viewWeek={week}
                  loggedFor={loggedForForRow(r.deliverable_id)}
                  overdue={behindIds.has(r.deliverable_id)}
                  overdueDetail={behind.find((b) => b.deliverable_id === r.deliverable_id) || null}
                  open={openId === r.deliverable_id}
                  saveState={saveState[r.deliverable_id]}
                  onToggle={() => setOpenId(openId === r.deliverable_id ? null : r.deliverable_id)}
                  onPatch={(patch) => patchRow(r.deliverable_id, patch)}
                  onLoggedForChange={(d) => setLoggedFor(r.deliverable_id, d)}
                  onSave={(patch, opts) => void saveEntry(r.deliverable_id, patch, opts)}
                  onRetry={() => void retryEntry(r.deliverable_id)}
                  onCatchUpDone={() => {
                    void loadMeta();
                    void fetchWeek(week);
                  }}
                  launchDate={launchDate}
                />
              ))}
            </div>
          )}
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
                fetchWeek(week);
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
