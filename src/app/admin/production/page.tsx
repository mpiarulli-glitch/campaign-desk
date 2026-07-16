"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
    color_week: ColorWeek;
    production_cadence: Cadence;
    last_production_date: string | null;
    schedule_token: string | null;
    contact_email: string;
  };
  window: { start: string; end: string } | null;
  status: CycleStatus;
  existingSend: { sendDate: string; status: string } | null;
  reminder: { lastSent: string; count: number } | null;
};

export default function ProductionPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [linkMessage, setLinkMessage] = useState<Record<string, string>>({});

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

  const configured = rows.filter((r) => r.client.color_week && r.client.production_cadence);
  const unconfigured = rows.filter((r) => !r.client.color_week || !r.client.production_cadence);

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
          <h1 className="h1">Production scheduling</h1>
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
            Each client&apos;s next production window, computed from their color week and cadence.
          </p>
        </div>

        {error ? <p className="error">{error}</p> : null}

        {loading ? (
          <p className="muted">Loading...</p>
        ) : configured.length === 0 ? (
          <div className="empty">
            <p>No clients have a color week and cadence configured yet.</p>
          </div>
        ) : (
          <div className="card card-pad" style={{ overflowX: "auto" }}>
            <table className="rev-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Color</th>
                  <th>Cadence</th>
                  <th>Last production</th>
                  <th>Next window</th>
                  <th>Status</th>
                  <th>Reminders</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {configured.map((r) => (
                  <tr
                    key={r.client.id}
                    className="rev-row"
                    onClick={() => router.push(`/admin/revenue/${r.client.id}`)}
                  >
                    <td><strong>{r.client.name}</strong></td>
                    <td>
                      {r.client.color_week ? (
                        <span className={`color-dot ${r.client.color_week}`} />
                      ) : null}
                      {r.client.color_week
                        ? r.client.color_week[0].toUpperCase() + r.client.color_week.slice(1)
                        : "—"}
                    </td>
                    <td>{CADENCE_LABEL[r.client.production_cadence]}</td>
                    <td>{r.client.last_production_date || "—"}</td>
                    <td>{r.window ? `${r.window.start} → ${r.window.end}` : "—"}</td>
                    <td>
                      <span className={`badge badge-${r.status}`}>{STATUS_LABEL[r.status]}</span>
                    </td>
                    <td>
                      {r.reminder
                        ? `${r.reminder.count} sent · last ${r.reminder.lastSent}`
                        : r.client.contact_email
                          ? "—"
                          : "no email"}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="btn btn-ghost btn-sm" onClick={() => copyLink(r.client.id)}>
                        Copy link
                      </button>
                      {linkMessage[r.client.id] ? (
                        <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                          {linkMessage[r.client.id]}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {unconfigured.length > 0 ? (
          <div className="card card-pad stack">
            <strong>Not yet configured</strong>
            <p className="muted" style={{ margin: 0 }}>
              These clients need a color week and cadence set before a window can be computed.
            </p>
            <div className="row" style={{ flexWrap: "wrap" }}>
              {unconfigured.map((r) => (
                <Link
                  key={r.client.id}
                  className="btn btn-ghost btn-sm"
                  href={`/admin/revenue/${r.client.id}`}
                >
                  {r.client.name}
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
