"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Brand } from "@/components/Brand";

type Model = "ecomm" | "b2b" | "home_service";
type Fmt = "currency" | "number" | "percent" | "multiple";

type ColorWeek = "purple" | "red" | "blue" | "green" | "";
type Cadence = "monthly" | "bi_monthly" | "quarterly" | "";

type Client = {
  id: string;
  name: string;
  business_model: Model;
  ghl_location_id: string;
  klaviyo_account: string;
  retainer: number;
  monthly_cost: number;
  ltv: number | null;
  color_week: ColorWeek;
  production_cadence: Cadence;
  last_production_date: string | null;
  contract_start: string | null;
  contract_end: string | null;
  blackout_dates: string;
  contact_name: string;
  contact_email: string;
  schedule_token: string | null;
};

type CycleStatus =
  | "not_configured"
  | "inactive"
  | "not_due"
  | "due"
  | "requested"
  | "scheduled"
  | "sent";

const CYCLE_STATUS_LABEL: Record<CycleStatus, string> = {
  not_configured: "Not configured",
  inactive: "Inactive",
  not_due: "Not due yet",
  due: "Due",
  requested: "Requested",
  scheduled: "Scheduled",
  sent: "Sent",
};

type Metric = {
  month: string;
  revenue: number;
  orders: number;
  appointments: number;
  leads: number;
  recipients: number;
  campaigns_sent: number;
  opens: number;
  clicks: number;
  revenue_source: string;
  activity_source: string;
  note: string;
};

type Kpi = { key: string; label: string; fmt: Fmt; hint: string | null; value: number | null };

function contractColor(pct: number, totalCount: number): string {
  if (totalCount === 0) return "var(--text-muted)";
  if (pct >= 90) return "var(--success)";
  if (pct >= 60) return "var(--warning)";
  return "var(--danger)";
}

function fmtTime(hhmm: string): string {
  if (!hhmm) return "";
  const h = Number(hhmm.split(":")[0]);
  if (Number.isNaN(h)) return "";
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12} ${period}`;
}

function fmtVal(v: number | null, fmt: Fmt): string {
  if (v === null || Number.isNaN(v)) return "—";
  if (fmt === "currency")
    return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: v >= 1000 ? 0 : 2 });
  if (fmt === "percent") return `${(v * 100).toFixed(1)}%`;
  if (fmt === "multiple") return `${v.toFixed(1)}x`;
  return Math.round(v).toLocaleString("en-US");
}

const EMPTY_MONTH = {
  month: "",
  revenue: "",
  orders: "",
  appointments: "",
  leads: "",
  recipients: "",
  campaignsSent: "",
  opens: "",
  clicks: "",
  note: "",
};

function RevenueChart({ metrics }: { metrics: Metric[] }) {
  if (metrics.length === 0) return null;
  const max = Math.max(...metrics.map((m) => m.revenue), 1);
  const W = 640;
  const H = 180;
  const pad = 28;
  const bw = (W - pad * 2) / metrics.length;
  return (
    <div style={{ overflowX: "auto" }}>
      <svg width={W} height={H} role="img" aria-label="Revenue by month" style={{ maxWidth: "100%" }}>
        {metrics.map((m, i) => {
          const h = ((H - pad * 2) * m.revenue) / max;
          const x = pad + i * bw + bw * 0.15;
          const y = H - pad - h;
          return (
            <g key={m.month}>
              <rect x={x} y={y} width={bw * 0.7} height={h} rx={3} fill="#1f9d63" />
              <text x={x + bw * 0.35} y={H - pad + 14} textAnchor="middle" fontSize="9" fill="#6b7280">
                {m.month.slice(5)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function RevenueClientPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [client, setClient] = useState<Client | null>(null);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<"overview" | "data" | "config" | "production">("overview");
  const [row, setRow] = useState({ ...EMPTY_MONTH });
  const [saving, setSaving] = useState(false);

  // config drafts
  const [cfg, setCfg] = useState<Partial<Client>>({});
  const [blackoutInput, setBlackoutInput] = useState("");
  const [cadenceInfo, setCadenceInfo] = useState<{
    window: { start: string; end: string } | null;
    status: CycleStatus;
    existingSend: { sendDate: string; sendTime: string; status: string } | null;
  } | null>(null);
  const [scheduleLink, setScheduleLink] = useState("");
  const [linkMessage, setLinkMessage] = useState("");
  const [contract, setContract] = useState<{
    pct: number;
    doneCount: number;
    totalCount: number;
    onTrack: boolean;
    label: string;
  } | null>(null);
  const [deliverableCount, setDeliverableCount] = useState(0);

  async function load() {
    const res = await fetch(`/api/revenue/clients/${id}`);
    if (res.status === 401) return router.push("/login");
    if (!res.ok) {
      setError("Client not found.");
      return;
    }
    const data = await res.json();
    setClient(data.client);
    setMetrics(data.metrics || []);
    setKpis(data.kpis || []);
    setCfg(data.client);
    setContract(data.contract || null);
    setDeliverableCount(data.deliverableCount || 0);
    setBlackoutInput(
      (() => {
        try {
          return (JSON.parse(data.client.blackout_dates || "[]") as string[]).join(", ");
        } catch {
          return "";
        }
      })()
    );
  }

  async function loadCadence() {
    const res = await fetch(`/api/revenue/clients/${id}/cadence`);
    if (res.ok) setCadenceInfo(await res.json());
  }

  useEffect(() => {
    load();
    loadCadence();
  }, [id]);

  async function copyScheduleLink() {
    setLinkMessage("");
    const res = await fetch(`/api/revenue/clients/${id}/schedule-token`);
    if (!res.ok) {
      setLinkMessage("Could not get link.");
      return;
    }
    const data = await res.json();
    const url = `${window.location.origin}/schedule/${data.token}`;
    setScheduleLink(url);
    try {
      await navigator.clipboard.writeText(url);
      setLinkMessage("Link copied to clipboard.");
    } catch {
      setLinkMessage("Link ready — copy it below.");
    }
  }

  async function saveMonth(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{4}-\d{2}$/.test(row.month)) {
      setError("Month must be YYYY-MM.");
      return;
    }
    setSaving(true);
    setError("");
    const numify = (v: string) => (v === "" ? undefined : Number(v));
    const res = await fetch(`/api/revenue/clients/${id}/metrics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        month: row.month,
        revenue: numify(row.revenue),
        orders: numify(row.orders),
        appointments: numify(row.appointments),
        leads: numify(row.leads),
        recipients: numify(row.recipients),
        campaignsSent: numify(row.campaignsSent),
        opens: numify(row.opens),
        clicks: numify(row.clicks),
        note: row.note || undefined,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Could not save month.");
      return;
    }
    setRow({ ...EMPTY_MONTH });
    setMessage("Month saved.");
    load();
  }

  function editMonth(m: Metric) {
    setRow({
      month: m.month,
      revenue: String(m.revenue || ""),
      orders: String(m.orders || ""),
      appointments: String(m.appointments || ""),
      leads: String(m.leads || ""),
      recipients: String(m.recipients || ""),
      campaignsSent: String(m.campaigns_sent || ""),
      opens: String(m.opens || ""),
      clicks: String(m.clicks || ""),
      note: m.note || "",
    });
    setTab("data");
  }

  async function saveConfig(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const res = await fetch(`/api/revenue/clients/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: cfg.name,
        businessModel: cfg.business_model,
        ghlLocationId: cfg.ghl_location_id,
        klaviyoAccount: cfg.klaviyo_account,
        retainer: Number(cfg.retainer) || 0,
        monthlyCost: Number(cfg.monthly_cost) || 0,
        ltv: cfg.ltv === null || cfg.ltv === undefined ? null : Number(cfg.ltv),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Could not save config.");
      return;
    }
    setMessage("Config saved.");
    load();
  }

  async function saveProduction(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const blackoutDates = blackoutInput
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    const res = await fetch(`/api/revenue/clients/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        colorWeek: cfg.color_week || "",
        productionCadence: cfg.production_cadence || "",
        lastProductionDate: cfg.last_production_date || null,
        contractStart: cfg.contract_start || null,
        contractEnd: cfg.contract_end || null,
        blackoutDates,
        contactName: cfg.contact_name || "",
        contactEmail: cfg.contact_email || "",
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Could not save production cadence.");
      return;
    }
    setMessage("Production cadence saved.");
    await load();
    await loadCadence();
  }

  async function removeClient() {
    if (!confirm("Delete this client and all its metrics?")) return;
    const res = await fetch(`/api/revenue/clients/${id}`, { method: "DELETE" });
    if (res.ok) router.push("/admin/revenue");
  }

  if (error && !client) {
    return (
      <div className="container">
        <p className="error">{error}</p>
        <Link href="/admin/revenue">Back to dashboard</Link>
      </div>
    );
  }
  if (!client) {
    return (
      <div className="container">
        <p className="muted">Loading...</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand href="/admin" />
        <Link className="btn btn-ghost btn-sm" href="/admin/revenue">
          All clients
        </Link>
      </header>

      <main className="container container-wide stack">
        <div>
          <p className="eyebrow">Client revenue</p>
          <h1 className="h1">{client.name}</h1>
          <p className="muted" style={{ margin: "8px 0 0" }}>
            {client.business_model === "ecomm"
              ? "Ecommerce"
              : client.business_model === "b2b"
                ? "B2B"
                : "Home service"}{" "}
            · Retainer {client.retainer ? `$${client.retainer.toLocaleString()}/mo` : "not set"} ·{" "}
            {metrics.length} month{metrics.length === 1 ? "" : "s"} tracked
          </p>
        </div>

        {message ? <p className="success">{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}

        <div className="card card-pad row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <strong>Account snapshot</strong>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
              {deliverableCount} deliverable{deliverableCount === 1 ? "" : "s"} tracked
              {contract && contract.totalCount > 0
                ? ` · ${contract.doneCount} of ${contract.totalCount} recurring deliverables completed`
                : ""}
            </p>
          </div>
          <div className="row" style={{ gap: 16, alignItems: "center" }}>
            {contract ? (
              <span style={{ color: contractColor(contract.pct, contract.totalCount), fontWeight: 700, fontSize: 18 }}>
                {contract.totalCount > 0 ? `${contract.pct}%` : "—"}
                <span className="muted" style={{ marginLeft: 8, fontSize: 13, fontWeight: 400 }}>
                  {contract.label}
                </span>
              </span>
            ) : null}
            <Link className="btn btn-secondary btn-sm" href={`/admin/snapshot/${id}`}>
              Open snapshot
            </Link>
          </div>
        </div>

        <div className="tabs">
          <button className={`tab ${tab === "overview" ? "active" : ""}`} onClick={() => setTab("overview")}>
            Overview
          </button>
          <button className={`tab ${tab === "data" ? "active" : ""}`} onClick={() => setTab("data")}>
            Monthly data
          </button>
          <button className={`tab ${tab === "production" ? "active" : ""}`} onClick={() => setTab("production")}>
            Production
          </button>
          <button className={`tab ${tab === "config" ? "active" : ""}`} onClick={() => setTab("config")}>
            Settings
          </button>
        </div>

        {tab === "overview" ? (
          <>
            <div className="kpi-grid">
              {kpis.map((k) => (
                <div className="kpi-tile" key={k.key} title={k.hint || undefined}>
                  <span className="kpi-label">{k.label}</span>
                  <span className="kpi-value">{fmtVal(k.value, k.fmt)}</span>
                </div>
              ))}
            </div>
            {metrics.length > 0 ? (
              <div className="card card-pad stack">
                <strong>Revenue by month</strong>
                <RevenueChart metrics={metrics} />
              </div>
            ) : (
              <div className="empty">
                <p>No monthly data yet. Add a month under &quot;Monthly data.&quot;</p>
              </div>
            )}
          </>
        ) : null}

        {tab === "data" ? (
          <>
            <form className="card card-pad stack" onSubmit={saveMonth}>
              <strong>Add / update a month</strong>
              <div className="rev-form-grid">
                {(
                  [
                    ["month", "Month (YYYY-MM)", "text"],
                    ["revenue", "Revenue ($)", "number"],
                    ["orders", "Orders / deals", "number"],
                    ["appointments", "Appointments", "number"],
                    ["leads", "Leads", "number"],
                    ["recipients", "Recipients", "number"],
                    ["campaignsSent", "Campaigns sent", "number"],
                    ["opens", "Opens", "number"],
                    ["clicks", "Clicks", "number"],
                  ] as const
                ).map(([key, label, type]) => (
                  <div className="field" key={key}>
                    <label>{label}</label>
                    <input
                      type={type}
                      value={(row as Record<string, string>)[key]}
                      onChange={(e) => setRow((r) => ({ ...r, [key]: e.target.value }))}
                      placeholder={key === "month" ? "2026-06" : ""}
                    />
                  </div>
                ))}
              </div>
              <div className="field">
                <label>Note</label>
                <input value={row.note} onChange={(e) => setRow((r) => ({ ...r, note: e.target.value }))} />
              </div>
              <div className="row">
                <button className="btn" type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Save month"}
                </button>
              </div>
            </form>

            {metrics.length > 0 ? (
              <div className="card card-pad" style={{ overflowX: "auto" }}>
                <table className="rev-table">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th className="num">Revenue</th>
                      <th className="num">Orders</th>
                      <th className="num">Appts</th>
                      <th className="num">Leads</th>
                      <th className="num">Recipients</th>
                      <th className="num">Sends</th>
                      <th>Source</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.map((m) => (
                      <tr key={m.month}>
                        <td><strong>{m.month}</strong></td>
                        <td className="num">${m.revenue.toLocaleString()}</td>
                        <td className="num">{m.orders}</td>
                        <td className="num">{m.appointments}</td>
                        <td className="num">{m.leads}</td>
                        <td className="num">{m.recipients.toLocaleString()}</td>
                        <td className="num">{m.campaigns_sent}</td>
                        <td>
                          <span className="badge" style={{ fontSize: 11 }}>
                            rev:{m.revenue_source} / act:{m.activity_source}
                          </span>
                        </td>
                        <td>
                          <button className="btn btn-ghost btn-sm" onClick={() => editMonth(m)}>
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : null}

        {tab === "production" ? (
          <>
            <div className="card card-pad stack">
              <strong>Next production window</strong>
              {cadenceInfo?.window ? (
                <p className="muted" style={{ margin: 0 }}>
                  {cadenceInfo.window.start} → {cadenceInfo.window.end}{" "}
                  <span className={`badge badge-${cadenceInfo.status}`}>
                    {CYCLE_STATUS_LABEL[cadenceInfo.status]}
                  </span>
                </p>
              ) : (
                <p className="muted" style={{ margin: 0 }}>
                  Set a color week and cadence below to compute a window.
                </p>
              )}
              {cadenceInfo?.existingSend ? (
                <p className="muted" style={{ margin: 0 }}>
                  Current pick: {cadenceInfo.existingSend.sendDate}
                  {cadenceInfo.existingSend.sendTime
                    ? ` at ${fmtTime(cadenceInfo.existingSend.sendTime)}`
                    : ""}{" "}
                  ({cadenceInfo.existingSend.status})
                </p>
              ) : null}
              <div className="row">
                <button type="button" className="btn btn-sm" onClick={copyScheduleLink}>
                  Copy schedule link
                </button>
                {linkMessage ? <span className="muted">{linkMessage}</span> : null}
              </div>
              {scheduleLink ? (
                <input readOnly value={scheduleLink} onFocus={(e) => e.currentTarget.select()} />
              ) : null}
            </div>

            <form className="card card-pad stack" onSubmit={saveProduction}>
              <strong>Production cadence</strong>
              <div className="rev-form-grid">
                <div className="field">
                  <label>Color week</label>
                  <select
                    className="select-clean"
                    value={cfg.color_week || ""}
                    onChange={(e) => setCfg((c) => ({ ...c, color_week: e.target.value as ColorWeek }))}
                  >
                    <option value="">Not set</option>
                    <option value="purple">Purple</option>
                    <option value="red">Red</option>
                    <option value="blue">Blue</option>
                    <option value="green">Green</option>
                  </select>
                </div>
                <div className="field">
                  <label>Cadence</label>
                  <select
                    className="select-clean"
                    value={cfg.production_cadence || ""}
                    onChange={(e) => setCfg((c) => ({ ...c, production_cadence: e.target.value as Cadence }))}
                  >
                    <option value="">Not set</option>
                    <option value="monthly">Monthly</option>
                    <option value="bi_monthly">Bi-Monthly</option>
                    <option value="quarterly">Quarterly</option>
                  </select>
                </div>
                <div className="field">
                  <label>Last production date</label>
                  <input
                    type="date"
                    value={cfg.last_production_date || ""}
                    onChange={(e) => setCfg((c) => ({ ...c, last_production_date: e.target.value || null }))}
                  />
                </div>
                <div className="field">
                  <label>Contract start</label>
                  <input
                    type="date"
                    value={cfg.contract_start || ""}
                    onChange={(e) => setCfg((c) => ({ ...c, contract_start: e.target.value || null }))}
                  />
                </div>
                <div className="field">
                  <label>Contract end</label>
                  <input
                    type="date"
                    value={cfg.contract_end || ""}
                    onChange={(e) => setCfg((c) => ({ ...c, contract_end: e.target.value || null }))}
                  />
                </div>
                <div className="field">
                  <label>Contact name</label>
                  <input
                    value={cfg.contact_name || ""}
                    onChange={(e) => setCfg((c) => ({ ...c, contact_name: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label>Contact email</label>
                  <input
                    value={cfg.contact_email || ""}
                    onChange={(e) => setCfg((c) => ({ ...c, contact_email: e.target.value }))}
                  />
                </div>
              </div>
              <div className="field">
                <label>Blackout dates (comma-separated, YYYY-MM-DD)</label>
                <input value={blackoutInput} onChange={(e) => setBlackoutInput(e.target.value)} placeholder="2026-12-24, 2026-12-25" />
              </div>
              <div className="row">
                <button className="btn" type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Save cadence"}
                </button>
              </div>
            </form>
          </>
        ) : null}

        {tab === "config" ? (
          <form className="card card-pad stack" onSubmit={saveConfig}>
            <strong>Client settings</strong>
            <div className="rev-form-grid">
              <div className="field">
                <label>Name</label>
                <input value={cfg.name || ""} onChange={(e) => setCfg((c) => ({ ...c, name: e.target.value }))} />
              </div>
              <div className="field">
                <label>Business model</label>
                <select
                  className="select-clean"
                  value={cfg.business_model}
                  onChange={(e) => setCfg((c) => ({ ...c, business_model: e.target.value as Model }))}
                >
                  <option value="home_service">Home service</option>
                  <option value="b2b">B2B</option>
                  <option value="ecomm">Ecommerce</option>
                </select>
              </div>
              <div className="field">
                <label>Monthly retainer ($)</label>
                <input type="number" value={cfg.retainer ?? ""} onChange={(e) => setCfg((c) => ({ ...c, retainer: Number(e.target.value) }))} />
              </div>
              <div className="field">
                <label>Monthly cost ($)</label>
                <input type="number" value={cfg.monthly_cost ?? ""} onChange={(e) => setCfg((c) => ({ ...c, monthly_cost: Number(e.target.value) }))} />
              </div>
              <div className="field">
                <label>Customer LTV ($)</label>
                <input type="number" value={cfg.ltv ?? ""} onChange={(e) => setCfg((c) => ({ ...c, ltv: e.target.value === "" ? null : Number(e.target.value) }))} />
              </div>
              <div className="field">
                <label>GHL location ID</label>
                <input value={cfg.ghl_location_id || ""} onChange={(e) => setCfg((c) => ({ ...c, ghl_location_id: e.target.value }))} />
              </div>
              <div className="field">
                <label>Klaviyo account</label>
                <input value={cfg.klaviyo_account || ""} onChange={(e) => setCfg((c) => ({ ...c, klaviyo_account: e.target.value }))} />
              </div>
            </div>
            <div className="row">
              <button className="btn" type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save settings"}
              </button>
              <button className="btn btn-danger btn-sm" type="button" onClick={removeClient}>
                Delete client
              </button>
            </div>
          </form>
        ) : null}
      </main>
    </div>
  );
}
