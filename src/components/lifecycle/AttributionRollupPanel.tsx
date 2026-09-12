"use client";

import { useCallback, useState } from "react";
import type { AnalyticsPreset } from "@/lib/ghl-email-analytics";
import type { AttributionRollup } from "@/lib/email-attribution-rollup";

const PRESETS: Array<{ id: AnalyticsPreset; label: string }> = [
  { id: "1m", label: "1 mo" },
  { id: "3m", label: "3 mo" },
  { id: "6m", label: "6 mo" },
  { id: "12m", label: "12 mo" },
];

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function prettyRange(start: string, end: string): string {
  return `${start} → ${end}`;
}

export function AttributionRollupPanel({
  onOpenClient,
}: {
  onOpenClient?: (clientId: string) => void;
}) {
  const [range, setRange] = useState<AnalyticsPreset>("3m");
  const [data, setData] = useState<AttributionRollup | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showOthers, setShowOthers] = useState(false);

  const scan = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ range });
        if (refresh) params.set("refresh", "1");
        const res = await fetch(
          `/api/lifecycle/attribution-rollup?${params}`
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(
            typeof body.error === "string"
              ? body.error
              : "Could not scan accounts."
          );
          setData(null);
          return;
        }
        setData(body as AttributionRollup);
      } catch {
        setError("Network error while scanning.");
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [range]
  );

  return (
    <section className="lh-analytics lh-attr-rollup">
      <div className="lh-card-head">
        <div>
          <p className="lh-analytics-kicker">Email → appointments</p>
          <h2>Email wins</h2>
          <p className="lh-card-note">
            Accounts where a campaign or automation send is credited for a
            booked appointment or form fill (last-touch, 5-day window).
          </p>
        </div>
        <div className="lh-analytics-window-controls">
          <div className="lh-filters" role="tablist" aria-label="Date range">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={range === p.id}
                className={range === p.id ? "on" : ""}
                disabled={loading}
                onClick={() => setRange(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn"
            disabled={loading}
            onClick={() => void scan(Boolean(data))}
          >
            {loading ? "Scanning…" : data ? "Rescan" : "Scan all accounts"}
          </button>
        </div>
      </div>

      {error ? <p className="lh-error">{error}</p> : null}

      {!data && !loading && !error ? (
        <p className="lh-card-note">
          This hits every GHL-linked Lifecycle account. First run can take a
          few minutes.
        </p>
      ) : null}

      {loading && !data ? (
        <p className="lh-empty">Scanning GHL-linked accounts…</p>
      ) : null}

      {data ? (
        <div className="lh-analytics-body">
          <p className="lh-analytics-window">
            {prettyRange(data.start, data.end)}
            {data.cached ? " · cached" : ""}
            {" · "}
            {fmt(data.scanned)} scanned · {fmt(data.withWins)} with wins
          </p>

          <div className="lh-kpi-grid" aria-label="Rollup totals">
            <article className="lh-kpi is-cyan">
              <span className="lh-kpi-label">Email → booked</span>
              <strong className="lh-kpi-value">
                {fmt(data.totals.attributedAppointments)}
              </strong>
              <span className="lh-kpi-hint">
                Attributed appointments · {data.attributionDays}-day window
              </span>
            </article>
            <article className="lh-kpi is-teal">
              <span className="lh-kpi-label">Email → forms</span>
              <strong className="lh-kpi-value">
                {fmt(data.totals.attributedFormFills)}
              </strong>
              <span className="lh-kpi-hint">Attributed form fills</span>
            </article>
          </div>

          {data.wins.length === 0 ? (
            <p className="lh-empty">
              No accounts with email-attributed bookings or form fills in this
              window.
            </p>
          ) : (
            <div className="lh-analytics-table-wrap">
              <table className="lh-analytics-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Booked from email</th>
                    <th>Forms from email</th>
                    <th>All booked</th>
                    <th>Sends</th>
                  </tr>
                </thead>
                <tbody>
                  {data.wins.map((row) => (
                    <tr key={row.clientId}>
                      <td>
                        {onOpenClient ? (
                          <button
                            type="button"
                            className="lh-analytics-name lh-attr-link"
                            onClick={() => onOpenClient(row.clientId)}
                          >
                            {row.clientName}
                          </button>
                        ) : (
                          <span className="lh-analytics-name">
                            {row.clientName}
                          </span>
                        )}
                        {row.error ? (
                          <span className="lh-analytics-meta">{row.error}</span>
                        ) : null}
                      </td>
                      <td>
                        <strong>{fmt(row.attributedAppointments)}</strong>
                      </td>
                      <td>{fmt(row.attributedFormFills)}</td>
                      <td>
                        {row.totalAppointments === null
                          ? "—"
                          : fmt(row.totalAppointments)}
                      </td>
                      <td>
                        {fmt(row.campaignSends)} campaigns ·{" "}
                        {fmt(row.flowSends)} flows
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.others.length > 0 ? (
            <div className="lh-attr-others">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowOthers((v) => !v)}
              >
                {showOthers ? "Hide" : "Show"} accounts with no email wins (
                {fmt(data.others.length)})
              </button>
              {showOthers ? (
                <ul className="lh-attr-other-list">
                  {data.others.map((row) => (
                    <li key={row.clientId}>
                      {row.clientName}
                      {row.error ? (
                        <span className="lh-analytics-meta"> — {row.error}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
