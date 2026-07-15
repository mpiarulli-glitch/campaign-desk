"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Brand } from "@/components/Brand";

type Model = "ecomm" | "b2b" | "home_service";

const MODEL_LABEL: Record<Model, string> = {
  ecomm: "Ecommerce",
  b2b: "B2B",
  home_service: "Home service",
};

type Rollup = {
  client: {
    id: string;
    name: string;
    business_model: Model;
    retainer: number;
    monthly_cost: number;
  };
  agg: { revenue: number; appointments: number; orders: number; months: number };
  clientRoi: number | null;
  agencyMargin: number;
  latestMonth: string | null;
};

type Summary = {
  clients: Rollup[];
  totalRevenue: number;
  totalRetainer: number;
  totalAgencyMargin: number;
  blendedRoi: number | null;
  totalAppointments: number;
  totalOrders: number;
  months: string[];
};

function money(v: number): string {
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}
function mult(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(1)}x`;
}

export default function RevenuePage() {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [model, setModel] = useState<Model>("home_service");
  const [ghlLocationId, setGhlLocationId] = useState("");
  const [retainer, setRetainer] = useState("");
  const [monthlyCost, setMonthlyCost] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/revenue/summary");
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) {
      setError("Failed to load.");
      setLoading(false);
      return;
    }
    setSummary(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function addClient(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError("");
    const res = await fetch("/api/revenue/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        businessModel: model,
        ghlLocationId,
        retainer: retainer ? Number(retainer) : 0,
        monthlyCost: monthlyCost ? Number(monthlyCost) : 0,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Could not add client.");
      return;
    }
    const data = await res.json();
    router.push(`/admin/revenue/${data.client.id}`);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand href="/admin" />
        <div className="row">
          <Link className="btn btn-ghost btn-sm" href="/admin">
            Campaigns
          </Link>
          <Link className="btn btn-ghost btn-sm" href="/admin/calendar">
            Calendar
          </Link>
          <button
            className="btn btn-sm"
            onClick={() => setAdding((v) => !v)}
          >
            {adding ? "Cancel" : "Add client"}
          </button>
        </div>
      </header>

      <main className="container container-wide stack">
        <div className="page-hero">
          <p className="eyebrow">Email department</p>
          <h1 className="h1">Revenue dashboard</h1>
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
            Profitability, ROI, and email-driven revenue across every client.
          </p>
        </div>

        {error ? <p className="error">{error}</p> : null}

        {adding ? (
          <form className="card card-pad stack" onSubmit={addClient}>
            <strong>Add a client</strong>
            <div className="rev-form-grid">
              <div className="field">
                <label htmlFor="cn">Client name</label>
                <input id="cn" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="cm">Business model</label>
                <select id="cm" value={model} onChange={(e) => setModel(e.target.value as Model)} className="select-clean">
                  <option value="home_service">Home service</option>
                  <option value="b2b">B2B</option>
                  <option value="ecomm">Ecommerce</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="gl">GHL location ID</label>
                <input id="gl" value={ghlLocationId} onChange={(e) => setGhlLocationId(e.target.value)} placeholder="optional" />
              </div>
              <div className="field">
                <label htmlFor="rt">Monthly retainer ($)</label>
                <input id="rt" type="number" value={retainer} onChange={(e) => setRetainer(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="mc">Monthly cost to deliver ($)</label>
                <input id="mc" type="number" value={monthlyCost} onChange={(e) => setMonthlyCost(e.target.value)} />
              </div>
            </div>
            <div className="row">
              <button className="btn" type="submit" disabled={saving}>
                {saving ? "Adding..." : "Add client"}
              </button>
            </div>
          </form>
        ) : null}

        {loading ? (
          <p className="muted">Loading...</p>
        ) : !summary ? null : (
          <>
            <div className="kpi-grid">
              <div className="kpi-tile">
                <span className="kpi-label">Attributed revenue</span>
                <span className="kpi-value">{money(summary.totalRevenue)}</span>
              </div>
              <div className="kpi-tile">
                <span className="kpi-label">Blended ROI</span>
                <span className="kpi-value">{mult(summary.blendedRoi)}</span>
              </div>
              <div className="kpi-tile">
                <span className="kpi-label">Agency margin</span>
                <span className="kpi-value">{money(summary.totalAgencyMargin)}</span>
              </div>
              <div className="kpi-tile">
                <span className="kpi-label">Appointments</span>
                <span className="kpi-value">
                  {summary.totalAppointments.toLocaleString()}
                </span>
              </div>
              <div className="kpi-tile">
                <span className="kpi-label">Orders / deals</span>
                <span className="kpi-value">
                  {summary.totalOrders.toLocaleString()}
                </span>
              </div>
            </div>

            {summary.clients.length === 0 ? (
              <div className="empty">
                <p>No clients yet. Add one to start tracking.</p>
              </div>
            ) : (
              <div className="card card-pad" style={{ overflowX: "auto" }}>
                <table className="rev-table">
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Model</th>
                      <th className="num">Revenue</th>
                      <th className="num">ROI</th>
                      <th className="num">Agency margin</th>
                      <th className="num">Appts</th>
                      <th>Latest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.clients.map((r) => (
                      <tr
                        key={r.client.id}
                        className="rev-row"
                        onClick={() => router.push(`/admin/revenue/${r.client.id}`)}
                      >
                        <td><strong>{r.client.name}</strong></td>
                        <td>
                          <span className="badge">{MODEL_LABEL[r.client.business_model]}</span>
                        </td>
                        <td className="num">{money(r.agg.revenue)}</td>
                        <td className="num">{mult(r.clientRoi)}</td>
                        <td className="num">{money(r.agencyMargin)}</td>
                        <td className="num">{r.agg.appointments.toLocaleString()}</td>
                        <td>{r.latestMonth ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
