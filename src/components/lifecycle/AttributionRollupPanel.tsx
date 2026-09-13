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
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  const a = new Date(`${start}T12:00:00`).toLocaleDateString("en-US", opts);
  const b = new Date(`${end}T12:00:00`).toLocaleDateString("en-US", opts);
  return `${a} – ${b}`;
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
    <section className="lh-card lh-analytics lh-attr-rollup lh-analytics-clean">
      <div className="lh-an-toolbar">
        <div className="lh-an-title">
          <h3>Email wins</h3>
          {data ? (
            <p className="lh-an-sub">
              {prettyRange(data.start, data.end)}
              {data.cached ? " · cached" : ""}
              {" · "}
              {fmt(data.scanned)} scanned · {fmt(data.withWins)} with wins
            </p>
          ) : (
            <p className="lh-an-sub">
              Last-touch bookings and form fills after a send
            </p>
          )}
        </div>
        <div className="lh-an-controls">
          <div className="lh-range" role="group" aria-label="Date range">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`lh-range-btn${range === p.id ? " is-on" : ""}`}
                disabled={loading}
                onClick={() => setRange(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="lh-link"
            disabled={loading}
            onClick={() => void scan(Boolean(data))}
          >
            {loading ? "Scanning…" : data ? "Rescan" : "Scan all"}
          </button>
        </div>
      </div>

      {error ? <p className="lh-error">{error}</p> : null}

      {!data && !loading && !error ? (
        <p className="lh-card-note">
          Scans every GHL-linked Lifecycle account. First run can take a few
          minutes.
        </p>
      ) : null}

      {loading && !data ? (
        <div className="lh-an-skeleton" aria-busy="true">
          <div className="lh-skel" />
          <div className="lh-skel" />
        </div>
      ) : null}

      {data ? (
        <div className="lh-an-body">
          <p className="lh-an-accuracy">
            Credit goes to the last campaign or flow send within{" "}
            {data.attributionDays} days of the booking or form fill. Scheduled
            sends with no real mail volume stay out of the totals.
          </p>

          <div className="lh-an-band">
            <h4 className="lh-an-band-label">Outcomes</h4>
            <div className="lh-an-metrics" aria-label="Rollup totals">
              <div className="lh-an-metric">
                <span>Email → booked</span>
                <strong>{fmt(data.totals.attributedAppointments)}</strong>
                <em>{data.attributionDays}-day last-touch</em>
              </div>
              <div className="lh-an-metric">
                <span>Email → forms</span>
                <strong>{fmt(data.totals.attributedFormFills)}</strong>
                <em>Attributed form fills</em>
              </div>
              <div className="lh-an-metric">
                <span>Accounts with wins</span>
                <strong>{fmt(data.withWins)}</strong>
                <em>{fmt(data.scanned)} scanned</em>
              </div>
            </div>
          </div>

          {data.wins.length === 0 ? (
            <p className="lh-empty">
              No accounts with email-attributed bookings or form fills in this
              window.
            </p>
          ) : (
            <div className="lh-an-table-wrap">
              <table className="lh-an-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Booked</th>
                    <th>Forms</th>
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
                            className="lh-an-name lh-attr-link"
                            onClick={() => onOpenClient(row.clientId)}
                          >
                            {row.clientName}
                          </button>
                        ) : (
                          <span className="lh-an-name">{row.clientName}</span>
                        )}
                        {row.error ? (
                          <div className="lh-an-meta">{row.error}</div>
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
                        <span className="lh-an-meta"> — {row.error}</span>
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
