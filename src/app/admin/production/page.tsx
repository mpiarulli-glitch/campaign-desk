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

type Row = {
  client: {
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
  window: { start: string; end: string } | null;
  status: CycleStatus;
  existingSend: { sendDate: string; status: string } | null;
  currentReminderCount: number;
  lastEmailSent: string | null;
  lastWindowEmailed: string | null;
};

// "2026-06-20" -> "Jun 20, 2026". Passes through anything non-ISO untouched.
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
            status in one place. Click a row to open that client.
          </p>
        </div>

        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <span className="muted">
            {activeCount} active · {rows.length} total
          </span>
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
          <div className="empty">
            <p>No clients to show.</p>
          </div>
        ) : (
          <div className="card card-pad" style={{ overflowX: "auto" }}>
            <table className="rev-table">
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
                {visible.map((r) => (
                  <tr
                    key={r.client.id}
                    className="rev-row"
                    style={{ opacity: r.client.active ? 1 : 0.55 }}
                    onClick={() => router.push(`/admin/revenue/${r.client.id}`)}
                  >
                    <td><strong>{r.client.name}</strong></td>
                    <td>{r.client.contact_name || "—"}</td>
                    <td>
                      {r.client.contact_email ? (
                        <span style={{ fontSize: 13 }}>{r.client.contact_email}</span>
                      ) : (
                        <span className="muted">no email</span>
                      )}
                    </td>
                    <td>{r.client.active ? "Yes" : "No"}</td>
                    <td>
                      {r.client.color_week ? (
                        <span className={`color-dot ${r.client.color_week}`} />
                      ) : null}
                      {colorLabel(r.client.color_week)}
                    </td>
                    <td>{CADENCE_LABEL[r.client.production_cadence]}</td>
                    <td>{fmtDate(r.client.last_production_date)}</td>
                    <td>{fmtWindow(r.window)}</td>
                    <td>
                      {r.lastEmailSent
                        ? `${fmtDate(r.lastEmailSent)}${r.currentReminderCount > 1 ? ` (${r.currentReminderCount}x)` : ""}`
                        : "—"}
                    </td>
                    <td>{r.lastWindowEmailed ? fmtDate(r.lastWindowEmailed) : "—"}</td>
                    <td>
                      <span className={`badge badge-${r.status}`}>{STATUS_LABEL[r.status]}</span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {r.client.color_week && r.client.production_cadence ? (
                        <>
                          <button className="btn btn-ghost btn-sm" onClick={() => copyLink(r.client.id)}>
                            Copy link
                          </button>
                          {linkMessage[r.client.id] ? (
                            <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                              {linkMessage[r.client.id]}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <Link className="btn btn-ghost btn-sm" href={`/admin/revenue/${r.client.id}`}>
                          Set up
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
