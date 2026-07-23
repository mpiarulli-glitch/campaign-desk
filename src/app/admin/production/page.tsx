"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Brand } from "@/components/Brand";
import { NavMenu } from "@/components/NavMenu";

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
  existingSend: { sendDate: string; status: string } | null;
  currentReminderCount: number;
  lastEmailSent: string | null;
  lastWindowEmailed: string | null;
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

export default function ProductionPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
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
  async function autoMatch() {
    setMatchMsg("Matching clients to Basecamp projects...");
    const res = await fetch("/api/basecamp/automatch", { method: "POST" });
    if (!res.ok) {
      setMatchMsg("Could not auto-match. Is Basecamp connected?");
      return;
    }
    const d = await res.json();
    setMatchMsg(
      `Matched ${d.matched.length} of ${d.matched.length + d.unmatched.length}. ` +
        (d.unmatched.length ? `Still need a project: ${d.unmatched.join(", ")}.` : "All set.")
    );
    load({ silent: true });
  }

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
    setVideographers(data.videographers || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    loadBc();
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
      <header className="topbar">
        <Brand href="/admin" />
        <div className="row">
          <NavMenu current="/admin/production" />
        </div>
      </header>

      <main className="container container-wide stack">
        <div className="page-hero">
          <p className="eyebrow">Email department</p>
          <h1 className="h1">Master scheduler</h1>
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
            Every client&apos;s color week, cadence, next production window, and reminder
            status. <strong>Click any field to edit it</strong> — press Enter to save,
            Esc to cancel. The window and reminder columns are calculated automatically.
          </p>
        </div>

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
          <button className="btn btn-ghost btn-sm" onClick={addVideographer}>+ Add videographer</button>
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
                <button className="btn btn-ghost btn-sm" onClick={disconnectBc}>Disconnect</button>
              </span>
            ) : null}
          </div>
        ) : null}
        {matchMsg ? <p className="muted" style={{ marginTop: -6 }}>{matchMsg}</p> : null}

        {error ? <p className="error">{error}</p> : null}

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
                      <div className="row" style={{ gap: 6 }}>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {removed.length > 0 ? (
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
      </main>
    </div>
  );
}
