"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Brand } from "@/components/Brand";

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
  color_week: ColorWeek;
  production_cadence: Cadence;
  last_production_date: string | null;
  schedule_token: string | null;
};

type Row = {
  client: Client;
  window: { start: string; end: string } | null;
  status: CycleStatus;
  existingSend: { sendDate: string; status: string } | null;
  currentReminderCount: number;
  lastEmailSent: string | null;
  lastWindowEmailed: string | null;
};

type Draft = {
  name: string;
  contact_name: string;
  contact_email: string;
  active: boolean;
  color_week: ColorWeek;
  production_cadence: Cadence;
  last_production_date: string;
};

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
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
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
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function startEdit(c: Client) {
    setLinkMessage({});
    setEditId(c.id);
    setDraft({
      name: c.name,
      contact_name: c.contact_name || "",
      contact_email: c.contact_email || "",
      active: Boolean(c.active),
      color_week: c.color_week,
      production_cadence: c.production_cadence,
      last_production_date: c.last_production_date || "",
    });
  }

  function cancelEdit() {
    setEditId(null);
    setDraft(null);
  }

  async function saveEdit() {
    if (!editId || !draft) return;
    setSaving(true);
    setError("");
    const res = await fetch(`/api/revenue/clients/${editId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draft.name,
        contactName: draft.contact_name,
        contactEmail: draft.contact_email,
        active: draft.active,
        colorWeek: draft.color_week,
        productionCadence: draft.production_cadence,
        lastProductionDate: draft.last_production_date || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Could not save changes.");
      return;
    }
    setEditId(null);
    setDraft(null);
    load();
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

  const visible = useMemo(
    () => (showInactive ? rows : rows.filter((r) => r.client.active)),
    [rows, showInactive]
  );
  const activeCount = rows.filter((r) => r.client.active).length;

  const upd = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand href="/admin" />
        <div className="row">
          <Link className="btn btn-ghost btn-sm" href="/admin">Campaigns</Link>
          <Link className="btn btn-ghost btn-sm" href="/admin/calendar">Calendar</Link>
          <Link className="btn btn-ghost btn-sm" href="/admin/revenue">Revenue</Link>
        </div>
      </header>

      <main className="container container-wide stack">
        <div className="page-hero">
          <p className="eyebrow">Email department</p>
          <h1 className="h1">Master scheduler</h1>
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
            Every client&apos;s color week, cadence, next production window, and reminder
            status. <strong>Click any row to edit it</strong> inline (handy if a production
            was scheduled manually and the last production date needs fixing).
          </p>
        </div>

        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <span className="muted">{activeCount} active · {rows.length} total</span>
          <label className="row" style={{ gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            <span className="muted">Show inactive</span>
          </label>
        </div>

        {error ? <p className="error">{error}</p> : null}

        {loading ? (
          <p className="muted">Loading...</p>
        ) : visible.length === 0 ? (
          <div className="empty"><p>No clients to show.</p></div>
        ) : (
          <div className="card card-pad" style={{ overflowX: "auto" }}>
            <table className="rev-table sched-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Contact</th>
                  <th>Email</th>
                  <th>Active</th>
                  <th>Color</th>
                  <th>Cadence</th>
                  <th>Last production</th>
                  <th>Scheduling window</th>
                  <th>Last email sent</th>
                  <th>Last window emailed</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const editing = editId === r.client.id;
                  if (editing && draft) {
                    return (
                      <tr key={r.client.id} className="rev-row-editing">
                        <td><input className="cell-input" value={draft.name} onChange={(e) => upd({ name: e.target.value })} /></td>
                        <td><input className="cell-input" value={draft.contact_name} onChange={(e) => upd({ contact_name: e.target.value })} /></td>
                        <td><input className="cell-input" value={draft.contact_email} onChange={(e) => upd({ contact_email: e.target.value })} /></td>
                        <td>
                          <select className="select-clean cell-input" value={draft.active ? "1" : "0"} onChange={(e) => upd({ active: e.target.value === "1" })}>
                            <option value="1">Yes</option>
                            <option value="0">No</option>
                          </select>
                        </td>
                        <td>
                          <select className="select-clean cell-input" value={draft.color_week} onChange={(e) => upd({ color_week: e.target.value as ColorWeek })}>
                            <option value="">Not set</option>
                            <option value="purple">Purple</option>
                            <option value="red">Red</option>
                            <option value="blue">Blue</option>
                            <option value="green">Green</option>
                          </select>
                        </td>
                        <td>
                          <select className="select-clean cell-input" value={draft.production_cadence} onChange={(e) => upd({ production_cadence: e.target.value as Cadence })}>
                            <option value="">Not set</option>
                            <option value="monthly">Monthly</option>
                            <option value="bi_monthly">Bi-Monthly</option>
                            <option value="quarterly">Quarterly</option>
                          </select>
                        </td>
                        <td><input type="date" className="cell-input" value={draft.last_production_date} onChange={(e) => upd({ last_production_date: e.target.value })} /></td>
                        <td>{fmtWindow(r.window)}</td>
                        <td>{r.lastEmailSent ? fmtDate(r.lastEmailSent) : "—"}</td>
                        <td>{r.lastWindowEmailed ? fmtDate(r.lastWindowEmailed) : "—"}</td>
                        <td><span className={`badge badge-${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                        <td>
                          <div className="row" style={{ gap: 6 }}>
                            <button className="btn btn-sm" disabled={saving} onClick={saveEdit}>{saving ? "Saving..." : "Save"}</button>
                            <button className="btn btn-secondary btn-sm" type="button" onClick={cancelEdit}>Cancel</button>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr
                      key={r.client.id}
                      className="rev-row"
                      style={{ opacity: r.client.active ? 1 : 0.55 }}
                      onClick={() => startEdit(r.client)}
                      title="Click to edit"
                    >
                      <td><strong>{r.client.name}</strong></td>
                      <td>{r.client.contact_name || "—"}</td>
                      <td>
                        {r.client.contact_email
                          ? <span style={{ fontSize: 13 }}>{r.client.contact_email}</span>
                          : <span className="muted">no email</span>}
                      </td>
                      <td>{r.client.active ? "Yes" : "No"}</td>
                      <td>
                        {r.client.color_week ? <span className={`color-dot ${r.client.color_week}`} /> : null}
                        {colorLabel(r.client.color_week)}
                      </td>
                      <td>{CADENCE_LABEL[r.client.production_cadence]}</td>
                      <td>{fmtDate(r.client.last_production_date)}</td>
                      <td>{fmtWindow(r.window)}</td>
                      <td>{r.lastEmailSent ? fmtDate(r.lastEmailSent) : "—"}</td>
                      <td>{r.lastWindowEmailed ? fmtDate(r.lastWindowEmailed) : "—"}</td>
                      <td><span className={`badge badge-${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                      <td onClick={stop}>
                        <div className="row" style={{ gap: 6 }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => startEdit(r.client)}>Edit</button>
                          {r.client.color_week && r.client.production_cadence ? (
                            <button className="btn btn-ghost btn-sm" onClick={() => copyLink(r.client.id)}>Copy link</button>
                          ) : null}
                        </div>
                        {linkMessage[r.client.id] ? (
                          <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>{linkMessage[r.client.id]}</div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
