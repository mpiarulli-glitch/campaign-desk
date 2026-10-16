"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import type { AnalyticsPreset } from "@/lib/ghl-email-analytics";
import type { AttributionRollup } from "@/lib/email-attribution-rollup";
import {
  attributionPortfolioNote,
  utmAttributionLine,
} from "@/lib/attribution-copy";

const PRESETS: Array<{ id: AnalyticsPreset; label: string }> = [
  { id: "1m", label: "1 mo" },
  { id: "3m", label: "3 mo" },
  { id: "6m", label: "6 mo" },
  { id: "12m", label: "12 mo" },
];

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function proofLabel(confidence: "confirmed" | "inferred"): string {
  return confidence === "confirmed" ? "Confirmed" : "Inferred";
}

function sourceLabel(source: "email" | "sms"): string {
  return source === "sms" ? "SMS" : "Email";
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
  const requestGen = useRef(0);

  const scan = useCallback(
    async (refresh = false) => {
      const gen = ++requestGen.current;
      setLoading(true);
      setError("");
      let refreshOnce = refresh;
      try {
        for (;;) {
          const params = new URLSearchParams({ range });
          if (refreshOnce) params.set("refresh", "1");
          refreshOnce = false;
          const res = await fetch(
            `/api/lifecycle/attribution-rollup?${params}`
          );
          const body = await res.json().catch(() => ({}));
          if (gen !== requestGen.current) return;
          if (!res.ok) {
            setError(
              typeof body.error === "string"
                ? body.error
                : "Could not scan accounts."
            );
            setData(null);
            return;
          }
          const next = body as AttributionRollup;
          setData(next);
          if (next.status !== "running") return;
          await new Promise((resolve) => setTimeout(resolve, 2000));
          if (gen !== requestGen.current) return;
        }
      } catch {
        if (gen !== requestGen.current) return;
        setError("Network error while scanning.");
        setData(null);
      } finally {
        if (gen === requestGen.current) setLoading(false);
      }
    },
    [range]
  );

  return (
    <section className="lh-card lh-analytics lh-attr-rollup lh-analytics-clean">
      <div className="lh-an-toolbar">
        <div className="lh-an-title">
          <h3>Email & SMS wins</h3>
          {data ? (
            <p className="lh-an-sub">
              {prettyRange(data.start, data.end)}
              {data.cached ? " · cached" : ""}
              {" · "}
              {data.status === "running"
                ? `Scanning ${fmt(data.progress.done)} of ${fmt(data.progress.total)}`
                : `${fmt(data.scanned)} scanned · ${fmt(data.withWins)} with wins`}
            </p>
          ) : (
            <p className="lh-an-sub">
              Which email or SMS drove each form fill and booking
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
                onClick={() => {
                  requestGen.current += 1;
                  setLoading(false);
                  setRange(p.id);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="lh-link"
            disabled={loading}
            onClick={() => void scan(Boolean(data && !data.incomplete))}
          >
            {loading ? "Scanning…" : data && !data.incomplete ? "Rescan" : "Scan all"}
          </button>
        </div>
      </div>

      {error ? <p className="lh-error">{error}</p> : null}

      {data?.status === "running" ? (
        <p className="lh-card-note">
          Scanning {fmt(data.progress.done)} of {fmt(data.progress.total)}{" "}
          accounts. Results show up as each account finishes.
        </p>
      ) : null}
      {data
        ? [...data.wins, ...data.others]
            .filter((row) => row.error)
            .map((row) => (
              <p key={row.clientId} className="lh-error">
                {row.clientName}: {row.error}
              </p>
            ))
        : null}

      {!data && !loading && !error ? (
        <p className="lh-card-note">
          Scans every GHL-linked Lifecycle account except Trailhead.{" "}
          {attributionPortfolioNote()} UTM-confirmed conversions are read from
          Converted fields, then Latest or First attribution. First run can
          take a few minutes.
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
          <p className="lh-an-accuracy">{utmAttributionLine(data.attributionDays)}</p>

          <div className="lh-an-band">
            <div className="lh-an-band-head">
              <h4 className="lh-an-band-label">Outcomes</h4>
              <Link className="lh-link" href="/admin/lifecycle/conversions">
                Open conversion log
              </Link>
            </div>
            <div className="lh-an-metrics" aria-label="Rollup totals">
              <div className="lh-an-metric">
                <span>Confirmed booked</span>
                <strong>{fmt(data.totals.confirmedAppointments)}</strong>
                <em>UTM email or SMS</em>
              </div>
              <div className="lh-an-metric">
                <span>Confirmed forms</span>
                <strong>{fmt(data.totals.confirmedFormFills)}</strong>
                <em>UTM email or SMS</em>
              </div>
              <div className="lh-an-metric">
                <span>Inferred</span>
                <strong>
                  {fmt(
                    data.totals.inferredAppointments + data.totals.inferredFormFills
                  )}
                </strong>
                <em>
                  {fmt(data.totals.inferredAppointments)} booked ·{" "}
                  {fmt(data.totals.inferredFormFills)} forms
                </em>
              </div>
              <div className="lh-an-metric">
                <span>Email</span>
                <strong>
                  {fmt(data.totals.emailAppointments + data.totals.emailFormFills)}
                </strong>
                <em>
                  {fmt(data.totals.emailAppointments)} booked ·{" "}
                  {fmt(data.totals.emailFormFills)} forms
                </em>
              </div>
              <div className="lh-an-metric">
                <span>SMS</span>
                <strong>
                  {fmt(data.totals.smsAppointments + data.totals.smsFormFills)}
                </strong>
                <em>
                  {fmt(data.totals.smsAppointments)} booked ·{" "}
                  {fmt(data.totals.smsFormFills)} forms
                </em>
              </div>
            </div>
          </div>

          {data.wins.length === 0 ? (
            <p className="lh-empty">
              No accounts with email or SMS bookings or form fills in this window.
            </p>
          ) : (
            <div className="lh-an-table-wrap">
              <table className="lh-an-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Booked</th>
                    <th>Forms</th>
                    <th>Email</th>
                    <th>SMS</th>
                    <th>All booked</th>
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
                        <div className="lh-an-meta">
                          {fmt(row.confirmedAppointments)} confirmed ·{" "}
                          {fmt(row.inferredAppointments)} inferred
                        </div>
                      </td>
                      <td>
                        {fmt(row.attributedFormFills)}
                        <div className="lh-an-meta">
                          {fmt(row.confirmedFormFills)} confirmed ·{" "}
                          {fmt(row.inferredFormFills)} inferred
                        </div>
                      </td>
                      <td>
                        {fmt(row.emailAppointments + row.emailFormFills)}
                      </td>
                      <td>{fmt(row.smsAppointments + row.smsFormFills)}</td>
                      <td>
                        {row.totalAppointments === null
                          ? "—"
                          : fmt(row.totalAppointments)}
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
                {showOthers ? "Hide" : "Show"} accounts with no email or SMS wins (
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

          {data.pieces.length > 0 ? (
            <div className="lh-attr-pieces">
              <h4 className="lh-an-band-label">By email / SMS</h4>
              <p className="lh-an-meta">
                Grouped by the specific message (Converted Content, or the
                message verified on the contact).
              </p>
              <div className="lh-an-table-wrap">
                <table className="lh-an-table">
                  <thead>
                    <tr>
                      <th>Message</th>
                      <th>Source</th>
                      <th>Campaign</th>
                      <th>Proof</th>
                      <th>Booked</th>
                      <th>Forms</th>
                      <th>Account</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pieces.map((piece) => (
                      <tr
                        key={[
                          piece.clientId,
                          piece.content,
                          piece.source,
                          piece.campaign || "",
                          piece.confidence,
                        ].join(":")}
                      >
                        <td>
                          <span className="lh-an-name">{piece.content}</span>
                        </td>
                        <td>{sourceLabel(piece.source)}</td>
                        <td>{piece.campaign || "—"}</td>
                        <td>
                          <span
                            className={`lh-proof is-${piece.confidence}`}
                          >
                            {proofLabel(piece.confidence)}
                          </span>
                        </td>
                        <td>{fmt(piece.appointments)}</td>
                        <td>{fmt(piece.formFills)}</td>
                        <td>{piece.clientName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
