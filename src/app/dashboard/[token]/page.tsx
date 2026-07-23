"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Brand } from "@/components/Brand";

type CycleStatus =
  | "not_configured"
  | "inactive"
  | "not_due"
  | "due"
  | "requested"
  | "scheduled"
  | "sent";

type Kpi = { key: string; label: string; fmt: string; hint: string | null; value: number | null };

type DeliverableOverview = {
  deliverable_id: string;
  category: string;
  name: string;
  status: string;
};

type Send = {
  id: string;
  title: string;
  send_date: string;
  send_time: string;
  status: string;
};

type ActivityItem = {
  kind: string;
  at: string;
  summary: string;
  detail: string;
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
};

const STATUS_LABEL: Record<CycleStatus, string> = {
  not_configured: "Not configured yet",
  inactive: "Account inactive",
  not_due: "Not due yet",
  due: "Ready to book",
  requested: "Requested — awaiting confirmation",
  scheduled: "Scheduled",
  sent: "Sent",
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
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function ClientDashboardPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/dashboard/${token}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (res.ok) setData(await res.json());
      else setError("Could not load your dashboard.");
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  if (notFound) {
    return (
      <div className="login-wrap">
        <div className="card login-card">
          <h1>Link not found</h1>
          <p className="muted">This dashboard link is invalid or has been reset.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell snap-client">
      <header className="topbar">
        <Brand />
        <span className="snap-topbar-tag">Account dashboard</span>
      </header>

      <section className="snap-hero">
        <div className="snap-hero-inner">
          <p className="snap-hero-eyebrow">Your account, in one place</p>
          <h1 className="snap-hero-title">{data?.client.name || "Dashboard"}</h1>
          <p className="snap-hero-sub">Prepared by Marketing Empire Group</p>
        </div>
      </section>

      <main className="container stack" style={{ gap: 26 }}>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : error ? (
          <p className="error">{error}</p>
        ) : data ? (
          <>
            <section className="card card-pad stack" style={{ gap: 10 }}>
              <h2 className="snap-section-title" style={{ margin: 0 }}>
                Production status
              </h2>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
                {STATUS_LABEL[data.production.status]}
              </p>
              {data.production.window ? (
                <p className="muted" style={{ margin: 0 }}>
                  {data.production.existingSend
                    ? `Booked for ${fmtDate(data.production.existingSend.sendDate)}`
                    : `Next window: ${fmtDate(data.production.window.start)} – ${fmtDate(data.production.window.end)}`}
                </p>
              ) : (
                <p className="muted" style={{ margin: 0 }}>
                  No production schedule configured for this account yet.
                </p>
              )}
            </section>

            <section className="card card-pad stack" style={{ gap: 10 }}>
              <h2 className="snap-section-title" style={{ margin: 0 }}>
                Weekly snapshot
              </h2>
              <p className="muted" style={{ margin: 0 }}>
                {data.snapshot.overview.length
                  ? `${data.snapshot.overview.length} deliverable${data.snapshot.overview.length === 1 ? "" : "s"} tracked.`
                  : "No deliverables tracked yet."}
              </p>
              {data.snapshot.token ? (
                <a className="btn btn-secondary btn-sm" href={`/snapshot/${data.snapshot.token}`}>
                  View full snapshot
                </a>
              ) : null}
            </section>

            <section className="card card-pad stack" style={{ gap: 10 }}>
              <h2 className="snap-section-title" style={{ margin: 0 }}>
                Account data
              </h2>
              <div className="kpi-grid">
                {data.accountData.kpis.map((k) => (
                  <div key={k.key} className="kpi-tile">
                    <span className="kpi-label">{k.label}</span>
                    <span className="kpi-value">{fmtKpi(k.value, k.fmt)}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="card card-pad stack" style={{ gap: 10 }}>
              <h2 className="snap-section-title" style={{ margin: 0 }}>
                Campaign calendar
              </h2>
              {data.calendar.length ? (
                <div className="stack" style={{ gap: 8 }}>
                  {data.calendar.map((s) => (
                    <div key={s.id} className="row" style={{ justifyContent: "space-between" }}>
                      <span>{s.title}</span>
                      <span className="muted" style={{ fontSize: 13 }}>
                        {fmtDate(s.send_date)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted" style={{ margin: 0 }}>Nothing on the calendar right now.</p>
              )}
            </section>

            <section className="card card-pad stack" style={{ gap: 10 }}>
              <h2 className="snap-section-title" style={{ margin: 0 }}>
                Recent activity
              </h2>
              {data.activity.length ? (
                <div className="stack" style={{ gap: 8 }}>
                  {data.activity.map((a, i) => (
                    <div key={i} className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontSize: 14 }}>{a.summary}</div>
                        {a.detail ? <div className="muted" style={{ fontSize: 13 }}>{a.detail}</div> : null}
                      </div>
                      <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                        {fmtAt(a.at)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted" style={{ margin: 0 }}>No activity yet.</p>
              )}
            </section>

            <footer className="snap-footer">Prepared by Marketing Empire Group</footer>
          </>
        ) : null}
      </main>
    </div>
  );
}
