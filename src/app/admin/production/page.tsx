"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

type ColorWeek = "purple" | "red" | "blue" | "green" | "";
type Cadence = "monthly" | "bi_monthly" | "quarterly" | "";
type CycleStatus =
  | "not_configured"
  | "inactive"
  | "not_due"
  | "due"
  | "requested"
  | "scheduled"
  | "sent";

const CADENCE_LABEL: Record<Cadence, string> = {
  monthly: "Monthly",
  bi_monthly: "Bi-Monthly",
  quarterly: "Quarterly",
  "": "—",
};

const STATUS_LABEL: Record<CycleStatus, string> = {
  not_configured: "Not configured",
  inactive: "Inactive",
  not_due: "Not due yet",
  due: "Due",
  requested: "Requested",
  scheduled: "Scheduled",
  sent: "Sent",
};

type Client = {
  id: string;
  name: string;
  active: number;
  contact_name: string;
  contact_email: string;
  poc: string;
  account_manager: string;
  color_week: ColorWeek;
  production_cadence: Cadence;
  last_production_date: string | null;
  schedule_token: string | null;
  production_enrolled: number;
  basecamp_project_id: string;
  videographer_id: string;
};

type Videographer = { id: string; name: string; active: number };

type Row = {
  client: Client;
  window: { start: string; end: string } | null;
  status: CycleStatus;
  existingSend: { id: string; sendDate: string; status: string } | null;
  currentReminderCount: number;
  lastEmailSent: string | null;
  lastWindowEmailed: string | null;
};

type ProductionStatus = "requested" | "planned" | "scheduled" | "sent";
type ProductionTab = "requested" | "confirmed" | "setup";

// The "Log a production" form: a production that was arranged over the phone or
// in another booking system, recorded after the fact.
type LogForm = {
  clientId: string;
  date: string;
  time: string;
  duration: "half" | "full";
  status: "requested" | "scheduled" | "sent";
  note: string;
  cadenceWindowStart: string;
  notifyClient: boolean;
  notifyTeam: boolean;
  advanceAnchor: boolean;
};

type Production = {
  id: string;
  client_name: string;
  send_date: string;
  send_time: string;
  duration: string;
  status: ProductionStatus;
  account_manager: string;
  videographer: string;
  created_at: string;
};

// Which client fields can be edited inline, and how each maps to the PATCH body.
type Field =
  | "name"
  | "contact_name"
  | "contact_email"
  | "poc"
  | "account_manager"
  | "active"
  | "color_week"
  | "production_cadence"
  | "last_production_date"
  | "basecamp_project_id"
  | "videographer_id";

const PATCH_KEY: Record<Field, string> = {
  name: "name",
  contact_name: "contactName",
  contact_email: "contactEmail",
  poc: "poc",
  account_manager: "accountManager",
  active: "active",
  color_week: "colorWeek",
  production_cadence: "productionCadence",
  last_production_date: "lastProductionDate",
  basecamp_project_id: "basecampProjectId",
  videographer_id: "videographerId",
};

const COLOR_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "purple", label: "Purple" },
  { value: "red", label: "Red" },
  { value: "blue", label: "Blue" },
  { value: "green", label: "Green" },
];
const CADENCE_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "monthly", label: "Monthly" },
  { value: "bi_monthly", label: "Bi-Monthly" },
  { value: "quarterly", label: "Quarterly" },
];
const ACTIVE_OPTIONS = [
  { value: "1", label: "Yes" },
  { value: "0", label: "No" },
];
const ACCOUNT_MANAGER_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "Kyle", label: "Kyle" },
  { value: "Cassidy", label: "Cassidy" },
  { value: "Luis", label: "Luis" },
];

function fmtDate(ymd: string | null): string {
  if (!ymd) return "—";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtWindow(w: { start: string; end: string } | null): string {
  if (!w) return "—";
  const short = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  };
  return `${short(w.start)} – ${short(w.end)}`;
}

function colorLabel(c: ColorWeek): string {
  return c ? c[0].toUpperCase() + c.slice(1) : "—";
}

function fmtTime(hhmm: string): string {
  if (!hhmm) return "—";
  const [hourText, minute = "00"] = hhmm.split(":");
  const hour = Number(hourText);
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}

export default function ProductionPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [productions, setProductions] = useState<Production[]>([]);
  const [tab, setTab] = useState<ProductionTab>("requested");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [linkMessage, setLinkMessage] = useState<Record<string, string>>({});
  const [showInactive, setShowInactive] = useState(true);
  const [colorFilter, setColorFilter] = useState<ColorWeek | "all">("all");

  // Per-cell inline editing.
  const [edit, setEdit] = useState<{ id: string; field: Field } | null>(null);
  const [val, setVal] = useState("");
  const skipCommit = useRef(false);

  const [bc, setBc] = useState<{ configured: boolean; connected: boolean } | null>(null);
  const [videographers, setVideographers] = useState<Videographer[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);

  // "Log a production" form, for productions booked outside the app.
  const [logging, setLogging] = useState<LogForm | null>(null);
  const [logSaving, setLogSaving] = useState(false);
  const [logError, setLogError] = useState("");

  function openLog(clientId = "") {
    setLogError("");
    setLogging({
      clientId,
      date: "",
      time: "09:00",
      duration: "half",
      status: "scheduled",
      note: "",
      cadenceWindowStart: "",
      notifyClient: false,
      notifyTeam: false,
      advanceAnchor: true,
    });
  }

  // Picking a client prefills the date with their current window, which is what
  // you want almost every time. Backfilling a past production means changing it.
  function chooseLogClient(clientId: string) {
    if (!logging) return;
    const row = rows.find((r) => r.client.id === clientId);
    setLogging({
      ...logging,
      clientId,
      date: logging.date || row?.window?.start || "",
    });
  }

  async function submitLog(e: FormEvent) {
    e.preventDefault();
    if (!logging) return;
    if (!logging.clientId) { setLogError("Pick a client."); return; }
    if (!logging.date) { setLogError("Pick the production date."); return; }
    setLogSaving(true);
    setLogError("");
    const res = await fetch("/api/production", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: logging.clientId,
        date: logging.date,
        time: logging.time,
        duration: logging.duration,
        status: logging.status,
        note: logging.note,
        cadenceWindowStart: logging.cadenceWindowStart || undefined,
        notifyClient: logging.notifyClient,
        notifyTeam: logging.notifyTeam,
        // Only meaningful on a completed production; the server ignores it
        // otherwise, but don't send a misleading true.
        advanceAnchor: logging.status === "sent" && logging.advanceAnchor,
      }),
    });
    setLogSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setLogError(data.error || "Could not log the production.");
      return;
    }
    setLogging(null);
    load({ silent: true });
  }

  async function addVideographer() {
    const name = (prompt("Videographer name") || "").trim();
    if (!name) return;
    const res = await fetch("/api/videographers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) load({ silent: true });
  }

  async function loadBc() {
    const res = await fetch("/api/basecamp/status");
    if (res.ok) setBc(await res.json());
  }
  async function disconnectBc() {
    await fetch("/api/basecamp/status", { method: "DELETE" });
    loadBc();
  }
  const [matchMsg, setMatchMsg] = useState("");
  // Held between the preview call and the apply call so importing new clients is
  // never a surprise — you see the counts and names first.
  const [importPreview, setImportPreview] = useState<{
    linked: Array<{ client: string; project: string }>;
    created: Array<{ client: string; project: string }>;
    ambiguous: Array<{ client: string; options: string[] }>;
    noProject: string[];
    skippedInternal: string[];
  } | null>(null);

  async function runMatch(opts: { createMissing: boolean; dryRun: boolean }) {
    setMatchMsg(
      opts.dryRun ? "Checking Basecamp..." : "Matching clients to Basecamp projects..."
    );
    const res = await fetch("/api/basecamp/automatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    if (!res.ok) {
      setMatchMsg("Could not reach Basecamp. Is it still connected?");
      return;
    }
    const d = await res.json();
    if (opts.dryRun) {
      setImportPreview(d);
      setMatchMsg("");
      return;
    }
    setImportPreview(null);
    setMatchMsg(
      `Linked ${d.linked.length}${d.created.length ? `, created ${d.created.length}` : ""}. ` +
        (d.noProject.length ? `No project found for: ${d.noProject.join(", ")}.` : "All set.")
    );
    load({ silent: true });
  }

  const autoMatch = () => runMatch({ createMissing: false, dryRun: false });

  // silent = true skips the loading state so an inline edit or toggle
  // doesn't blank the whole table out and jump the page back to the top.
  async function load(opts?: { silent?: boolean }) {
    if (!opts?.silent) setLoading(true);
    const res = await fetch("/api/production");
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) {
      setError("Failed to load.");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setRows(data.clients || []);
    setProductions(data.productions || []);
    setVideographers(data.videographers || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    fetch("/api/auth")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const admin = data?.role === "admin";
        setIsAdmin(admin);
        if (admin) loadBc();
      })
      .catch(() => {});
  }, []);

  function beginEdit(id: string, field: Field, current: string) {
    setError("");
    setEdit({ id, field });
    setVal(current);
  }

  function cancelEdit() {
    skipCommit.current = true;
    setEdit(null);
  }

  async function commit(override?: string) {
    if (skipCommit.current) {
      skipCommit.current = false;
      return;
    }
    if (!edit) return;
    const { id, field } = edit;
    const raw = override !== undefined ? override : val;
    setEdit(null);

    let value: string | boolean | null = raw;
    if (field === "active") value = raw === "1";
    else if (field === "last_production_date") value = raw || null;

    const res = await fetch(`/api/revenue/clients/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [PATCH_KEY[field]]: value }),
    });
    if (!res.ok) {
      setError("Could not save that change.");
      return;
    }
    load({ silent: true });
  }

  async function setEnrolled(clientId: string, enrolled: boolean) {
    const res = await fetch(`/api/revenue/clients/${clientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productionEnrolled: enrolled }),
    });
    if (!res.ok) {
      setError("Could not update production status.");
      return;
    }
    load({ silent: true });
  }

  async function copyLink(clientId: string) {
    const res = await fetch(`/api/revenue/clients/${clientId}/schedule-token`);
    if (!res.ok) {
      setLinkMessage((m) => ({ ...m, [clientId]: "Could not get link." }));
      return;
    }
    const data = await res.json();
    const url = `${window.location.origin}/schedule/${data.token}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkMessage((m) => ({ ...m, [clientId]: "Copied!" }));
    } catch {
      setLinkMessage((m) => ({ ...m, [clientId]: url }));
    }
  }

  const enrolled = useMemo(() => rows.filter((r) => r.client.production_enrolled), [rows]);
  const removed = useMemo(() => rows.filter((r) => !r.client.production_enrolled), [rows]);
  const visible = useMemo(
    () =>
      enrolled
        .filter((r) => (showInactive ? true : r.client.active))
        .filter((r) => (colorFilter === "all" ? true : r.client.color_week === colorFilter)),
    [enrolled, showInactive, colorFilter]
  );
  const activeCount = enrolled.filter((r) => r.client.active).length;
  const requestedProductions = useMemo(
    () => productions.filter((production) => production.status === "requested"),
    [productions]
  );
  const confirmedProductions = useMemo(
    () => productions.filter((production) => production.status !== "requested"),
    [productions]
  );
  const visibleProductions =
    tab === "requested" ? requestedProductions : confirmedProductions;

  // Only clients whose color week and cadence are set can have a production
  // logged, since without them there's no window to record it against.
  const loggableClients = useMemo(
    () =>
      enrolled
        .filter((r) => r.client.color_week && r.client.production_cadence)
        .sort((a, b) => a.client.name.localeCompare(b.client.name)),
    [enrolled]
  );
  const logSelectedWindow = useMemo(
    () =>
      logging?.clientId
        ? rows.find((r) => r.client.id === logging.clientId)?.window || null
        : null,
    [logging?.clientId, rows]
  );
  // Whether moving the anchor is consequential depends on the cadence: monthly
  // windows don't move, longer cadences shift by whole months.
  const logSelectedCadence = useMemo(
    () =>
      logging?.clientId
        ? rows.find((r) => r.client.id === logging.clientId)?.client
            .production_cadence || ""
        : "",
    [logging?.clientId, rows]
  );

  const vidOptions = [
    { value: "", label: "Unassigned" },
    ...videographers.map((v) => ({ value: v.id, label: v.name })),
  ];
  const vidName = (id: string) => videographers.find((v) => v.id === id)?.name || "";

  // Renders a text/date/select input for the cell currently being edited.
  function editor(field: Field, type: "text" | "date" | "select", options?: { value: string; label: string }[]) {
    const commonKey = (e: React.KeyboardEvent) => {
      if (e.key === "Enter") commit();
      else if (e.key === "Escape") cancelEdit();
    };
    if (type === "select" && options) {
      return (
        <select
          autoFocus
          className="select-clean cell-input"
          value={val}
          onChange={(e) => {
            setVal(e.target.value);
            commit(e.target.value);
          }}
          onBlur={() => commit()}
          onKeyDown={commonKey}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );
    }
    return (
      <input
        autoFocus
        type={type}
        className="cell-input"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => commit()}
        onKeyDown={commonKey}
      />
    );
  }

  // A clickable, editable cell.
  function editableCell(
    r: Row,
    field: Field,
    type: "text" | "date" | "select",
    current: string,
    display: React.ReactNode,
    options?: { value: string; label: string }[]
  ) {
    if (!isAdmin) return <td>{display}</td>;
    const active = edit?.id === r.client.id && edit?.field === field;
    if (active) return <td className="cell-editing">{editor(field, type, options)}</td>;
    return (
      <td className="cell-clickable" title="Click to edit" onClick={() => beginEdit(r.client.id, field, current)}>
        {display}
      </td>
    );
  }

  return (
    <div className="app-shell">
      <main className="container container-wide stack">
        <div className="page-hero">
          <p className="eyebrow">Email department</p>
          <h1 className="h1">Productions</h1>
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
            Review new production requests, see confirmed shoots, or manage the
            master scheduling setup.
          </p>
        </div>

        <div className="tabs" role="tablist" aria-label="Production views">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "requested"}
            className={`tab ${tab === "requested" ? "active" : ""}`}
            onClick={() => setTab("requested")}
          >
            Requested
            <span className="tab-count">{requestedProductions.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "confirmed"}
            className={`tab ${tab === "confirmed" ? "active" : ""}`}
            onClick={() => setTab("confirmed")}
          >
            Confirmed
            <span className="tab-count">{confirmedProductions.length}</span>
          </button>
          <span className="tab-divider" aria-hidden="true" />
          <button
            type="button"
            role="tab"
            aria-selected={tab === "setup"}
            className={`tab ${tab === "setup" ? "active" : ""}`}
            onClick={() => setTab("setup")}
          >
            Client setup
            <span className="tab-count">{enrolled.length}</span>
          </button>
        </div>

        {error ? <p className="error">{error}</p> : null}

        {isAdmin && tab !== "setup" ? (
          logging ? (
            <form className="card card-pad stack" onSubmit={submitLog}>
              <div>
                <h2 className="h3" style={{ margin: 0 }}>Log a production</h2>
                <p className="muted" style={{ margin: "6px 0 0", lineHeight: 1.6 }}>
                  For a production booked over the phone or in another system.
                  This records it against the client&apos;s cadence window, so it
                  shows in the queue and stops their scheduling reminders.
                </p>
              </div>

              <div className="rev-form-grid">
                <div className="field">
                  <label htmlFor="log-client">Client</label>
                  <select
                    id="log-client"
                    className="select-clean"
                    value={logging.clientId}
                    onChange={(e) => chooseLogClient(e.target.value)}
                  >
                    <option value="">Pick a client</option>
                    {loggableClients.map((r) => (
                      <option key={r.client.id} value={r.client.id}>
                        {r.client.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="log-date">Production date</label>
                  <input
                    id="log-date"
                    type="date"
                    value={logging.date}
                    onChange={(e) => setLogging({ ...logging, date: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="log-time">Start time</label>
                  <select
                    id="log-time"
                    className="select-clean"
                    value={logging.time}
                    onChange={(e) => setLogging({ ...logging, time: e.target.value })}
                  >
                    <option value="">No time set</option>
                    {["09:00", "10:00", "11:00", "12:00", "13:00"].map((t) => (
                      <option key={t} value={t}>{fmtTime(t)}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="log-duration">Length</label>
                  <select
                    id="log-duration"
                    className="select-clean"
                    value={logging.duration}
                    onChange={(e) =>
                      setLogging({ ...logging, duration: e.target.value as "half" | "full" })
                    }
                  >
                    <option value="half">4 hours</option>
                    <option value="full">Full day</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="log-status">Status</label>
                  <select
                    id="log-status"
                    className="select-clean"
                    value={logging.status}
                    onChange={(e) =>
                      setLogging({
                        ...logging,
                        status: e.target.value as LogForm["status"],
                      })
                    }
                  >
                    <option value="requested">Requested, not confirmed</option>
                    <option value="scheduled">Confirmed</option>
                    <option value="sent">Already happened</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="log-window">Counts toward window</label>
                  <input
                    id="log-window"
                    type="date"
                    value={logging.cadenceWindowStart}
                    onChange={(e) =>
                      setLogging({ ...logging, cadenceWindowStart: e.target.value })
                    }
                  />
                  <span className="muted" style={{ fontSize: 12, marginTop: 4, display: "block" }}>
                    {logSelectedWindow
                      ? `Leave blank to work it out from the date. Their current window is ${fmtWindow(logSelectedWindow)}.`
                      : "Leave blank to work it out from the production date."}
                  </span>
                </div>
              </div>

              <div className="field">
                <label htmlFor="log-note">Note for the crew</label>
                <textarea
                  id="log-note"
                  rows={2}
                  value={logging.note}
                  onChange={(e) => setLogging({ ...logging, note: e.target.value })}
                  placeholder="Parking, on-site contact, anything the videographer needs."
                />
              </div>

              <div className="row" style={{ gap: 20, flexWrap: "wrap" }}>
                <label className="row" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={logging.notifyClient}
                    onChange={(e) =>
                      setLogging({ ...logging, notifyClient: e.target.checked })
                    }
                  />
                  <span className="muted">Email the client a confirmation</span>
                </label>
                <label className="row" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={logging.notifyTeam}
                    onChange={(e) =>
                      setLogging({ ...logging, notifyTeam: e.target.checked })
                    }
                  />
                  <span className="muted">Post to the Video Editing Campfire</span>
                </label>
                {logging.status === "sent" ? (
                  <label className="row" style={{ gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={logging.advanceAnchor}
                      onChange={(e) =>
                        setLogging({ ...logging, advanceAnchor: e.target.checked })
                      }
                    />
                    <span className="muted">
                      Move their last production date to this one
                    </span>
                  </label>
                ) : null}
              </div>

              {logging.status === "sent" && logging.advanceAnchor && logSelectedCadence ? (
                <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
                  {logSelectedCadence === "monthly"
                    ? "Safe on a monthly client: every month has a window, so their next one stays where it is."
                    : "Careful on a " +
                      (logSelectedCadence === "quarterly" ? "quarterly" : "bi-monthly") +
                      " client. The cadence counts forward from the month of their last production, so this moves every future window."}
                </p>
              ) : null}

              {logError ? <p className="error">{logError}</p> : null}

              <div className="row" style={{ gap: 10 }}>
                <button className="btn" type="submit" disabled={logSaving}>
                  {logSaving ? "Saving..." : "Log production"}
                </button>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => setLogging(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-secondary btn-sm" onClick={() => openLog()}>
                + Log a production
              </button>
            </div>
          )
        ) : null}

        {tab === "setup" ? (
          <>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <span className="muted">
            {colorFilter === "all"
              ? `${activeCount} active · ${enrolled.length} in production`
              : `${visible.length} ${colorLabel(colorFilter as ColorWeek)} client${visible.length === 1 ? "" : "s"}`}
          </span>
          <div className="row" style={{ gap: 16 }}>
            <label className="row" style={{ gap: 8 }}>
              <span className="muted">Color week</span>
              <select
                className="select-clean"
                style={{ width: "auto", padding: "6px 10px", fontSize: 13 }}
                value={colorFilter}
                onChange={(e) => setColorFilter(e.target.value as ColorWeek | "all")}
              >
                <option value="all">All colors</option>
                <option value="purple">Purple</option>
                <option value="red">Red</option>
                <option value="blue">Blue</option>
                <option value="green">Green</option>
              </select>
            </label>
            <label className="row" style={{ gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              <span className="muted">Show inactive</span>
            </label>
          </div>
        </div>

        <div className="row" style={{ gap: 8 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            Videographers: {videographers.length ? videographers.map((v) => v.name).join(", ") : "none yet"}
          </span>
          {isAdmin ? (
            <button className="btn btn-ghost btn-sm" onClick={addVideographer}>+ Add videographer</button>
          ) : null}
          <span className="muted" style={{ fontSize: 12 }}>
            One production per day each. A booked day blocks that videographer&apos;s other clients.
          </span>
        </div>

        {bc ? (
          <div className="card card-pad row" style={{ justifyContent: "space-between", gap: 12 }}>
            <span className="row" style={{ gap: 8 }}>
              <span
                className="color-dot"
                style={{ background: bc.connected ? "var(--success)" : "var(--border-strong)" }}
              />
              <strong>Basecamp</strong>
              <span className="muted">
                {bc.connected
                  ? "Connected. Scheduling cards post to each client's project."
                  : bc.configured
                    ? "Not connected yet."
                    : "Not configured. Add the Basecamp integration keys on the server."}
              </span>
            </span>
            {bc.configured && !bc.connected ? (
              <a className="btn btn-sm" href="/api/basecamp/connect">Connect Basecamp</a>
            ) : null}
            {bc.connected ? (
              <span className="row" style={{ gap: 8 }}>
                <button className="btn btn-sm" onClick={autoMatch}>Auto-match projects</button>
                <button
                  className="btn btn-sm"
                  onClick={() => runMatch({ createMissing: true, dryRun: true })}
                >
                  Import clients from Basecamp
                </button>
                <button className="btn btn-ghost btn-sm" onClick={disconnectBc}>Disconnect</button>
              </span>
            ) : null}
          </div>
        ) : null}
        {matchMsg ? <p className="muted" style={{ marginTop: -6 }}>{matchMsg}</p> : null}

        {importPreview ? (
          <div className="card card-pad" style={{ marginBottom: 16 }}>
            <strong>Preview: nothing has been changed yet</strong>
            <p className="muted" style={{ fontSize: 13, margin: "6px 0 12px" }}>
              {importPreview.linked.length} existing clients would be linked to a project,{" "}
              {importPreview.created.length} new clients would be created,{" "}
              {importPreview.skippedInternal.length} internal projects skipped.
            </p>
            {importPreview.created.length ? (
              <details style={{ marginBottom: 8 }}>
                <summary>New clients to create ({importPreview.created.length})</summary>
                <ul style={{ fontSize: 13, marginTop: 8 }}>
                  {importPreview.created.map((c) => (
                    <li key={c.project}>{c.client}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            {importPreview.linked.length ? (
              <details style={{ marginBottom: 8 }}>
                <summary>Existing clients to link ({importPreview.linked.length})</summary>
                <ul style={{ fontSize: 13, marginTop: 8 }}>
                  {importPreview.linked.map((c) => (
                    <li key={c.client}>
                      {c.client} → {c.project}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {importPreview.ambiguous.length ? (
              <details style={{ marginBottom: 8 }}>
                <summary>
                  Ambiguous, left alone ({importPreview.ambiguous.length}) — set these by hand
                </summary>
                <ul style={{ fontSize: 13, marginTop: 8 }}>
                  {importPreview.ambiguous.map((a) => (
                    <li key={a.client}>
                      {a.client}: {a.options.join(" | ")}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {importPreview.noProject.length ? (
              <details style={{ marginBottom: 12 }}>
                <summary>No Basecamp project found ({importPreview.noProject.length})</summary>
                <p style={{ fontSize: 13, marginTop: 8 }}>
                  {importPreview.noProject.join(", ")}
                </p>
              </details>
            ) : null}
            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn btn-sm"
                onClick={() => runMatch({ createMissing: true, dryRun: false })}
              >
                Apply these changes
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setImportPreview(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <p className="muted">Loading...</p>
        ) : visible.length === 0 ? (
          <div className="empty"><p>No clients to show.</p></div>
        ) : (
          <div className="card card-pad" style={{ overflowX: "auto" }}>
            <table className="rev-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Contact</th>
                  <th>Email</th>
                  <th>POC</th>
                  <th>Account manager</th>
                  <th>Active</th>
                  <th>Color</th>
                  <th>Videographer</th>
                  <th>Cadence</th>
                  <th>Last production</th>
                  <th>Scheduling window</th>
                  <th>Last email sent</th>
                  <th>Last window emailed</th>
                  <th>Status</th>
                  <th>Basecamp project</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.client.id} style={{ opacity: r.client.active ? 1 : 0.55 }}>
                    {editableCell(r, "name", "text", r.client.name, <strong>{r.client.name}</strong>)}
                    {editableCell(r, "contact_name", "text", r.client.contact_name, r.client.contact_name || "—")}
                    {editableCell(
                      r, "contact_email", "text", r.client.contact_email,
                      r.client.contact_email ? <span style={{ fontSize: 13 }}>{r.client.contact_email}</span> : <span className="muted">no email</span>
                    )}
                    {editableCell(
                      r, "poc", "text", r.client.poc,
                      r.client.poc ? <span style={{ fontSize: 13 }}>{r.client.poc}</span> : <span className="muted">Set POC</span>
                    )}
                    {editableCell(
                      r, "account_manager", "select", r.client.account_manager,
                      r.client.account_manager ? <span style={{ fontSize: 13 }}>{r.client.account_manager}</span> : <span className="muted">Set manager</span>,
                      ACCOUNT_MANAGER_OPTIONS
                    )}
                    {editableCell(r, "active", "select", r.client.active ? "1" : "0", r.client.active ? "Yes" : "No", ACTIVE_OPTIONS)}
                    {editableCell(
                      r, "color_week", "select", r.client.color_week,
                      <>{r.client.color_week ? <span className={`color-dot ${r.client.color_week}`} /> : null}{colorLabel(r.client.color_week)}</>,
                      COLOR_OPTIONS
                    )}
                    {editableCell(
                      r, "videographer_id", "select", r.client.videographer_id,
                      r.client.videographer_id
                        ? vidName(r.client.videographer_id)
                        : <span className="muted">Unassigned</span>,
                      vidOptions
                    )}
                    {editableCell(r, "production_cadence", "select", r.client.production_cadence, CADENCE_LABEL[r.client.production_cadence], CADENCE_OPTIONS)}
                    {editableCell(r, "last_production_date", "date", r.client.last_production_date || "", fmtDate(r.client.last_production_date))}
                    <td>{fmtWindow(r.window)}</td>
                    <td>{r.lastEmailSent ? fmtDate(r.lastEmailSent) : "—"}</td>
                    <td>{r.lastWindowEmailed ? fmtDate(r.lastWindowEmailed) : "—"}</td>
                    <td><span className={`badge badge-${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                    {editableCell(
                      r, "basecamp_project_id", "text", r.client.basecamp_project_id,
                      r.client.basecamp_project_id
                        ? <span style={{ fontSize: 13 }}>{r.client.basecamp_project_id}</span>
                        : <span className="muted">Set project</span>
                    )}
                    <td>
                      {isAdmin ? (
                        <>
                          <div className="row" style={{ gap: 6 }}>
                            {r.existingSend ? (
                              <Link
                                className="btn btn-secondary btn-sm"
                                href={`/admin/production/${r.existingSend.id}`}
                              >
                                View details
                              </Link>
                            ) : null}
                            {r.client.color_week && r.client.production_cadence ? (
                              <button className="btn btn-ghost btn-sm" onClick={() => copyLink(r.client.id)}>Copy link</button>
                            ) : null}
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => {
                                if (confirm(`Remove ${r.client.name} from production scheduling? This keeps the client and all their data — they just won't get productions or reminders.`)) {
                                  setEnrolled(r.client.id, false);
                                }
                              }}
                            >
                              Remove
                            </button>
                          </div>
                          {linkMessage[r.client.id] ? (
                            <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>{linkMessage[r.client.id]}</div>
                          ) : null}
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {isAdmin && removed.length > 0 ? (
          <div className="card card-pad stack">
            <strong>Removed from production ({removed.length})</strong>
            <p className="muted" style={{ margin: 0 }}>
              These clients are kept in full but don&apos;t get productions or reminders.
              Add one back anytime.
            </p>
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              {removed.map((r) => (
                <span key={r.client.id} className="removed-chip">
                  {r.client.name}
                  <button className="btn btn-ghost btn-sm" onClick={() => setEnrolled(r.client.id, true)}>
                    Add to production
                  </button>
                </span>
              ))}
            </div>
          </div>
        ) : null}
          </>
        ) : (
          <ProductionQueue
            productions={visibleProductions}
            loading={loading}
            emptyLabel={
              tab === "requested"
                ? "No production requests are waiting for confirmation."
                : "No productions have been confirmed yet."
            }
          />
        )}
      </main>
    </div>
  );
}

function ProductionQueue({
  productions,
  loading,
  emptyLabel,
}: {
  productions: Production[];
  loading: boolean;
  emptyLabel: string;
}) {
  if (loading) return <p className="muted">Loading productions...</p>;
  if (!productions.length) {
    return (
      <div className="empty">
        <p>{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="card card-pad" style={{ overflowX: "auto" }}>
      <table className="rev-table">
        <thead>
          <tr>
            <th>Client</th>
            <th>Production date</th>
            <th>Start time</th>
            <th>Length</th>
            <th>Videographer</th>
            <th>Account manager</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {productions.map((production) => {
            const statusLabel =
              production.status === "requested"
                ? "Requested"
                : production.status === "sent"
                  ? "Completed"
                  : "Confirmed";
            return (
              <tr key={production.id}>
                <td><strong>{production.client_name}</strong></td>
                <td>{fmtDate(production.send_date)}</td>
                <td>{fmtTime(production.send_time)}</td>
                <td>{production.duration === "full" ? "Full day" : "4 hours"}</td>
                <td>{production.videographer || <span className="muted">Unassigned</span>}</td>
                <td>{production.account_manager || <span className="muted">Not set</span>}</td>
                <td>
                  <span className={`badge badge-${production.status}`}>
                    {statusLabel}
                  </span>
                </td>
                <td>
                  <Link
                    className="btn btn-secondary btn-sm"
                    href={`/admin/production/${production.id}`}
                  >
                    View details
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
