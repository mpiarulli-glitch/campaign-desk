"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AnalyticsPreset,
  ClientEmailAnalytics,
} from "@/lib/ghl-email-analytics";
import { buildEmailRecommendations } from "@/lib/email-analytics-tips";

const PRESETS: Array<{ id: AnalyticsPreset; label: string }> = [
  { id: "1m", label: "1 mo" },
  { id: "3m", label: "3 mo" },
  { id: "6m", label: "6 mo" },
  { id: "12m", label: "12 mo" },
  { id: "custom", label: "Custom" },
];

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function prettyRange(start: string, end: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  const a = new Date(`${start}T12:00:00`).toLocaleDateString("en-US", opts);
  const b = new Date(`${end}T12:00:00`).toLocaleDateString("en-US", opts);
  return `${a} – ${b}`;
}

export function EmailAnalyticsPanel({
  clientId,
  memberIds = [],
  ghlLinked,
}: {
  clientId: string;
  memberIds?: string[];
  ghlLinked: boolean;
}) {
  const [preset, setPreset] = useState<AnalyticsPreset>("1m");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<ClientEmailAnalytics | null>(null);

  const tips = useMemo(
    () => (data ? buildEmailRecommendations(data) : []),
    [data]
  );

  const pull = useCallback(async () => {
    if (!ghlLinked) return;
    if (preset === "custom" && (!from || !to)) {
      setError("Pick a start and end date.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ range: preset });
      if (preset === "custom") {
        params.set("from", from);
        params.set("to", to);
      }
      if (memberIds.length) params.set("members", memberIds.join(","));
      const res = await fetch(`/api/lifecycle/hub/${clientId}/analytics?${params}`);
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        analytics?: ClientEmailAnalytics;
      };
      if (!res.ok || !body.analytics) {
        setError(body.error || "Could not pull analytics.");
        setData(null);
        return;
      }
      setData(body.analytics);
    } catch {
      setError("Could not pull analytics.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [clientId, from, ghlLinked, memberIds, preset, to]);

  useEffect(() => {
    if (!ghlLinked) return;
    if (preset === "custom") return;
    void pull();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghlLinked, preset]);

  if (!ghlLinked) {
    return (
      <section className="lh-card lh-analytics">
        <div className="lh-card-head">
          <h3>Email analytics</h3>
        </div>
        <p className="lh-card-note">
          Link a GoHighLevel location for this account from Lifecycle → Tools to
          pull campaign stats.
        </p>
      </section>
    );
  }

  const totals = data?.totals;

  return (
    <section className="lh-card lh-analytics">
      <div className="lh-card-head">
        <h3>Email analytics</h3>
        <button
          type="button"
          className="lh-link"
          onClick={() => void pull()}
          disabled={loading || (preset === "custom" && (!from || !to))}
        >
          {loading ? "Pulling…" : data ? "Refresh" : "Pull from GHL"}
        </button>
      </div>

      <div className="lh-range" role="group" aria-label="Date range">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`lh-range-btn${preset === p.id ? " is-on" : ""}`}
            onClick={() => setPreset(p.id)}
            disabled={loading}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === "custom" ? (
        <div className="lh-custom-range">
          <label className="lh-field">
            <span>From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="Start date"
            />
          </label>
          <label className="lh-field">
            <span>To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-label="End date"
            />
          </label>
          <button
            type="button"
            className="btn btn-sm"
            disabled={loading || !from || !to}
            onClick={() => void pull()}
          >
            {loading ? "Pulling…" : "Pull"}
          </button>
        </div>
      ) : null}

      {error ? <p className="lh-error">{error}</p> : null}

      {loading && !data ? (
        <p className="lh-card-note">Pulling campaign stats from GoHighLevel…</p>
      ) : null}

      {data && totals ? (
        <div className="lh-analytics-body">
          <div className="lh-analytics-main">
            <p className="lh-analytics-window">{prettyRange(data.start, data.end)}</p>
            <p className="lh-card-note">
              Form fills and bookings are credited to the most recent campaign or
              automation send in the prior {data.attributionDays} days. Abandoned
              booking recovery uses GHL tags (<code>abandoned booking</code> →{" "}
              <code>meeting booked</code>) plus calendar bookings.
            </p>
            <div className="lh-metrics" aria-label="Money outcomes">
              <div className="lh-metric">
                <b>{data.formFills === null ? "—" : fmt(data.formFills)}</b>
                <span>form fills</span>
              </div>
              <div className="lh-metric">
                <b>
                  {data.appointments === null ? "—" : fmt(data.appointments)}
                </b>
                <span>booked</span>
              </div>
              <div className="lh-metric">
                <b>
                  {data.abandonedRecovery?.error
                    ? "—"
                    : data.abandonedRecovery
                      ? fmt(data.abandonedRecovery.recoveredInWindow)
                      : "—"}
                </b>
                <span>abandoned recovered</span>
              </div>
              <div className="lh-metric">
                <b>
                  {data.abandonedRecovery && !data.abandonedRecovery.error
                    ? fmtPct(data.abandonedRecovery.recoveryRate)
                    : "—"}
                </b>
                <span>recovery rate</span>
              </div>
              <div className="lh-metric">
                <b>{fmt(totals.sent)}</b>
                <span>sent</span>
              </div>
              <div className="lh-metric">
                <b>{fmtPct(totals.openRate)}</b>
                <span>open rate</span>
              </div>
              <div className="lh-metric">
                <b>{fmtPct(totals.clickRate)}</b>
                <span>click rate</span>
              </div>
            </div>
            {data.formFillsError ? (
              <p className="lh-card-note">Form fills: {data.formFillsError}</p>
            ) : null}
            {data.appointmentsError ? (
              <p className="lh-card-note">Appointments: {data.appointmentsError}</p>
            ) : null}
            {data.abandonedRecovery?.error ? (
              <p className="lh-card-note">
                Abandoned recovery: {data.abandonedRecovery.error}
              </p>
            ) : data.abandonedRecovery ? (
              <p className="lh-card-note">
                Abandoned pool {fmt(data.abandonedRecovery.abandoned)} · recovered{" "}
                {fmt(data.abandonedRecovery.recovered)} · still open{" "}
                {fmt(data.abandonedRecovery.stillAbandoned)} · in this window{" "}
                {fmt(data.abandonedRecovery.recoveredInWindow)}
              </p>
            ) : null}

            <h4 className="lh-analytics-section-title">Campaigns</h4>
            {data.campaigns.length === 0 ? (
              <p className="lh-card-note">No GHL campaigns found in that window.</p>
            ) : (
              <div className="lh-analytics-table-wrap">
                <table className="lh-analytics-table">
                  <thead>
                    <tr>
                      <th>Campaign</th>
                      <th>Subject</th>
                      <th>Sent</th>
                      <th>Open %</th>
                      <th>Click %</th>
                      <th>Forms</th>
                      <th>Booked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.campaigns.map((c) => (
                      <tr key={c.id || c.bulkRequestId || c.name}>
                        <td>
                          <div className="lh-analytics-name">{c.name}</div>
                          <div className="lh-analytics-meta">
                            {c.sentOn || "—"}
                            {c.statsAvailable ? "" : " · no stats yet"}
                          </div>
                        </td>
                        <td className="lh-analytics-subject">
                          {c.subject?.trim() || "—"}
                        </td>
                        <td>{fmt(c.sent)}</td>
                        <td>{fmtPct(c.openRate)}</td>
                        <td>{fmtPct(c.clickRate)}</td>
                        <td>{fmt(c.formFills)}</td>
                        <td>{fmt(c.attributedAppointments)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h4 className="lh-analytics-section-title">Automation flows</h4>
            {data.flows.length === 0 ? (
              <p className="lh-card-note">
                No published workflow email campaigns found (or the location token
                is missing emails/campaigns.readonly).
              </p>
            ) : (
              <div className="lh-analytics-table-wrap">
                <table className="lh-analytics-table">
                  <thead>
                    <tr>
                      <th>Flow</th>
                      <th>Sent</th>
                      <th>Open %</th>
                      <th>Click %</th>
                      <th>Forms</th>
                      <th>Booked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.flows.map((c) => (
                      <tr key={c.id || c.name}>
                        <td>
                          <div className="lh-analytics-name">{c.name}</div>
                          <div className="lh-analytics-meta">
                            {c.abandonedRecovery ? "Abandoned booking recovery · " : ""}
                            {c.sentOn || "—"}
                            {c.statsAvailable ? "" : " · no stats yet"}
                          </div>
                        </td>
                        <td>{fmt(c.sent)}</td>
                        <td>{fmtPct(c.openRate)}</td>
                        <td>{fmtPct(c.clickRate)}</td>
                        <td>{fmt(c.formFills)}</td>
                        <td>{fmt(c.attributedAppointments)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {tips.length > 0 ? (
            <aside className="lh-recs" aria-label="Recommendations for next month">
              <h4>Next month</h4>
              <p className="lh-recs-lead">
                Based on this window’s sends, form fills, bookings, and abandoned
                recoveries.
              </p>
              <ul className="lh-recs-list">
                {tips.map((tip) => (
                  <li key={tip.id} className={`lh-rec is-${tip.tone}`}>
                    <strong>{tip.title}</strong>
                    <span>{tip.detail}</span>
                  </li>
                ))}
              </ul>
            </aside>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
