"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Brand } from "@/components/Brand";
import { NavMenu } from "@/components/NavMenu";

type CycleStatus =
  | "not_configured"
  | "inactive"
  | "not_due"
  | "due"
  | "requested"
  | "scheduled"
  | "sent";

type Kpi = { key: string; label: string; fmt: string; hint: string | null; value: number | null };
type DeliverableOverview = { deliverable_id: string; category: string; name: string; status: string };
type Send = { id: string; title: string; send_date: string; status: string };
type ActivityItem = { kind: string; at: string; summary: string; detail: string };

type OkrStatus = "on_track" | "at_risk" | "off_track" | "achieved";
type KeyResult = { id: string; description: string; target: number; current: number; unit: string };
type Okr = {
  id: string;
  client_id: string;
  objective: string;
  keyResults: KeyResult[];
  target_date: string | null;
  status: OkrStatus;
};

type DashboardData = {
  client: { id: string; name: string };
  production: {
    window: { start: string; end: string } | null;
    status: CycleStatus;
    existingSend: { sendDate: string; status: string } | null;
  };
  snapshot: { token: string | null; overview: DeliverableOverview[] };
  accountData: { kpis: Kpi[] };
  calendar: Send[];
  activity: ActivityItem[];
  okrs: Okr[];
};

const STATUS_LABEL: Record<CycleStatus, string> = {
  not_configured: "Not configured",
  inactive: "Inactive",
  not_due: "Not due yet",
  due: "Ready to book",
  requested: "Requested",
  scheduled: "Scheduled",
  sent: "Sent",
};

const OKR_STATUS_LABEL: Record<OkrStatus, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
  achieved: "Achieved",
};

function fmtDate(ymd: string): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtKpi(value: number | null, fmt: string): string {
  if (value === null || Number.isNaN(value)) return "—";
  if (fmt === "currency") {
    return value.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: value >= 1000 ? 0 : 2,
    });
  }
  if (fmt === "percent") return `${(value * 100).toFixed(1)}%`;
  if (fmt === "multiple") return `${value.toFixed(2)}x`;
  return value.toLocaleString("en-US");
}

function fmtAt(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ClientHubPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"overview" | "okrs">("overview");
  const [dashboardToken, setDashboardToken] = useState<string | null>(null);
  const [copyMsg, setCopyMsg] = useState("");

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      const res = await fetch(`/api/admin/clients/${id}/dashboard`);
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) {
        setError("Could not load this client's hub.");
        setLoading(false);
        return;
      }
      setData(await res.json());
      setLoading(false);
    },
    [id, router]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch(`/api/admin/clients/${id}/dashboard-token`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setDashboardToken(d.token));
  }, [id]);

  async function rotateToken() {
    const res = await fetch(`/api/admin/clients/${id}/dashboard-token`, { method: "POST" });
    if (res.ok) {
      const d = await res.json();
      setDashboardToken(d.token);
      setCopyMsg("Link rotated — old link no longer works.");
    }
  }

  function copyLink() {
    if (!dashboardToken) return;
    const url = `${window.location.origin}/dashboard/${dashboardToken}`;
    navigator.clipboard.writeText(url);
    setCopyMsg("Copied to clipboard.");
    setTimeout(() => setCopyMsg(""), 3000);
  }

  async function addOkr() {
    const objective = (prompt("Objective") || "").trim();
    if (!objective) return;
    const targetDate = (prompt("Target date (YYYY-MM-DD), or leave blank") || "").trim();
    const res = await fetch(`/api/okrs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: id, objective, targetDate: targetDate || null, keyResults: [] }),
    });
    if (res.ok) load({ silent: true });
  }

  async function addKeyResult(okr: Okr) {
    const description = (prompt("Key result") || "").trim();
    if (!description) return;
    const target = Number(prompt("Target value") || "0");
    const unit = (prompt("Unit (e.g. $, %, leave blank)") || "").trim();
    const keyResults = [
      ...okr.keyResults,
      { id: "", description, target: Number.isFinite(target) ? target : 0, current: 0, unit },
    ];
    const res = await fetch(`/api/okrs/${okr.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyResults }),
    });
    if (res.ok) load({ silent: true });
  }

  async function updateKeyResultCurrent(okr: Okr, krId: string, current: number) {
    const keyResults = okr.keyResults.map((kr) => (kr.id === krId ? { ...kr, current } : kr));
    await fetch(`/api/okrs/${okr.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyResults }),
    });
    load({ silent: true });
  }

  async function setOkrStatus(okr: Okr, status: OkrStatus) {
    await fetch(`/api/okrs/${okr.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load({ silent: true });
  }

  async function deleteOkr(okrId: string) {
    if (!confirm("Delete this OKR?")) return;
    await fetch(`/api/okrs/${okrId}`, { method: "DELETE" });
    load({ silent: true });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand href="/admin" />
        <NavMenu current="/admin/revenue" />
      </header>

      <main className="container stack" style={{ gap: 20 }}>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : error ? (
          <p className="error">{error}</p>
        ) : data ? (
          <>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <h1 style={{ margin: 0 }}>{data.client.name}</h1>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={copyLink} disabled={!dashboardToken}>
                  Copy client link
                </button>
                <button className="btn btn-secondary btn-sm" onClick={rotateToken}>
                  Rotate link
                </button>
              </div>
            </div>
            {copyMsg ? <p className="muted" style={{ margin: 0 }}>{copyMsg}</p> : null}

            <div className="view-toggle">
              <button
                className={`view-toggle-btn ${tab === "overview" ? "is-on" : ""}`}
                onClick={() => setTab("overview")}
              >
                Overview
              </button>
              <button
                className={`view-toggle-btn ${tab === "okrs" ? "is-on" : ""}`}
                onClick={() => setTab("okrs")}
              >
                Goals &amp; OKRs
              </button>
            </div>

            {tab === "overview" ? (
              <div className="stack" style={{ gap: 20 }}>
                <section className="card card-pad stack" style={{ gap: 8 }}>
                  <h2 className="snap-section-title" style={{ margin: 0 }}>Production status</h2>
                  <p style={{ margin: 0, fontWeight: 600 }}>{STATUS_LABEL[data.production.status]}</p>
                  {data.production.window ? (
                    <p className="muted" style={{ margin: 0 }}>
                      {data.production.existingSend
                        ? `Booked for ${fmtDate(data.production.existingSend.sendDate)}`
                        : `Next window: ${fmtDate(data.production.window.start)} – ${fmtDate(data.production.window.end)}`}
                    </p>
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>Not configured.</p>
                  )}
                </section>

                <section className="card card-pad stack" style={{ gap: 8 }}>
                  <h2 className="snap-section-title" style={{ margin: 0 }}>Weekly snapshot</h2>
                  <p className="muted" style={{ margin: 0 }}>
                    {data.snapshot.overview.length} deliverable(s) tracked.
                  </p>
                  {data.snapshot.token ? (
                    <a
                      className="btn btn-secondary btn-sm"
                      href={`/admin/snapshot/${data.client.id}`}
                      style={{ width: "fit-content" }}
                    >
                      Open snapshot editor
                    </a>
                  ) : null}
                </section>

                <section className="card card-pad stack" style={{ gap: 8 }}>
                  <h2 className="snap-section-title" style={{ margin: 0 }}>Account data</h2>
                  <div className="kpi-grid">
                    {data.accountData.kpis.map((k) => (
                      <div key={k.key} className="kpi-tile">
                        <span className="kpi-label">{k.label}</span>
                        <span className="kpi-value">{fmtKpi(k.value, k.fmt)}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="card card-pad stack" style={{ gap: 8 }}>
                  <h2 className="snap-section-title" style={{ margin: 0 }}>Campaign calendar</h2>
                  {data.calendar.length ? (
                    data.calendar.map((s) => (
                      <div key={s.id} className="row" style={{ justifyContent: "space-between" }}>
                        <span>{s.title}</span>
                        <span className="muted" style={{ fontSize: 13 }}>{fmtDate(s.send_date)}</span>
                      </div>
                    ))
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>Nothing scheduled.</p>
                  )}
                </section>

                <section className="card card-pad stack" style={{ gap: 8 }}>
                  <h2 className="snap-section-title" style={{ margin: 0 }}>Activity</h2>
                  {data.activity.length ? (
                    data.activity.map((a, i) => (
                      <div key={i} className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <div style={{ fontSize: 14 }}>{a.summary}</div>
                          {a.detail ? <div className="muted" style={{ fontSize: 13 }}>{a.detail}</div> : null}
                        </div>
                        <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{fmtAt(a.at)}</span>
                      </div>
                    ))
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>No activity yet.</p>
                  )}
                </section>
              </div>
            ) : (
              <div className="stack" style={{ gap: 16 }}>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <button className="btn btn-sm" onClick={addOkr}>+ Add OKR</button>
                </div>
                {data.okrs.length === 0 ? (
                  <div className="empty"><p>No goals tracked for this account yet.</p></div>
                ) : (
                  data.okrs.map((okr) => (
                    <div key={okr.id} className="card card-pad stack" style={{ gap: 10 }}>
                      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 16 }}>{okr.objective}</div>
                          {okr.target_date ? (
                            <div className="muted" style={{ fontSize: 13 }}>
                              Target: {fmtDate(okr.target_date)}
                            </div>
                          ) : null}
                        </div>
                        <div className="row" style={{ gap: 8 }}>
                          <select
                            className="select-clean badge-select"
                            value={okr.status}
                            onChange={(e) => setOkrStatus(okr, e.target.value as OkrStatus)}
                          >
                            {Object.entries(OKR_STATUS_LABEL).map(([v, l]) => (
                              <option key={v} value={v}>{l}</option>
                            ))}
                          </select>
                          <button className="btn btn-ghost btn-sm" onClick={() => deleteOkr(okr.id)}>
                            Delete
                          </button>
                        </div>
                      </div>
                      <div className="stack" style={{ gap: 6 }}>
                        {okr.keyResults.map((kr) => (
                          <div key={kr.id} className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: 14 }}>{kr.description}</span>
                            <div className="row" style={{ gap: 6, alignItems: "center" }}>
                              <input
                                type="number"
                                className="cell-input"
                                style={{ width: 90 }}
                                defaultValue={kr.current}
                                onBlur={(e) => updateKeyResultCurrent(okr, kr.id, Number(e.target.value))}
                              />
                              <span className="muted" style={{ fontSize: 13 }}>
                                / {kr.target}{kr.unit}
                              </span>
                            </div>
                          </div>
                        ))}
                        <button
                          className="btn btn-secondary btn-sm"
                          style={{ width: "fit-content" }}
                          onClick={() => addKeyResult(okr)}
                        >
                          + Add key result
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
