"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import type { AnalyticsPreset, EmailJourneyKind } from "@/lib/ghl-email-analytics";
import type { ConversionLog, ConversionLogRow } from "@/lib/conversion-log";
import {
  attributionPortfolioNote,
  utmAttributionLine,
} from "@/lib/attribution-copy";
import type { AttributionConfidence, MessageSource } from "@/lib/utm-conversion-attribution";

const PRESETS: Array<{ id: AnalyticsPreset; label: string }> = [
  { id: "1m", label: "1 mo" },
  { id: "3m", label: "3 mo" },
  { id: "6m", label: "6 mo" },
  { id: "12m", label: "12 mo" },
];

const KIND_FILTERS: Array<{ id: "all" | EmailJourneyKind; label: string }> = [
  { id: "all", label: "All" },
  { id: "appointment", label: "Booked" },
  { id: "form_fill", label: "Forms" },
];

const PROOF_FILTERS: Array<{ id: "all" | AttributionConfidence; label: string }> = [
  { id: "all", label: "Any proof" },
  { id: "confirmed", label: "Confirmed" },
  { id: "inferred", label: "Inferred" },
];

const SOURCE_FILTERS: Array<{ id: "all" | MessageSource; label: string }> = [
  { id: "all", label: "Email & SMS" },
  { id: "email", label: "Email" },
  { id: "sms", label: "SMS" },
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

function prettyDay(ymd: string): string {
  return new Date(`${ymd}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function typeLabel(kind: EmailJourneyKind): string {
  return kind === "appointment" ? "Booked" : "Form";
}

function contactLabel(row: ConversionLogRow): string {
  if (row.contactName?.trim()) return row.contactName.trim();
  if (row.contactEmail?.trim()) return row.contactEmail.trim();
  return "Unknown contact";
}

function proofLabel(row: ConversionLogRow): string {
  if (row.confidence !== "confirmed") return "Inferred";
  if (row.basis === "latest_utm") return "Confirmed · latest";
  if (row.basis === "first_utm") return "Confirmed · first";
  return "Confirmed";
}

function sourceLabel(source: MessageSource): string {
  return source === "sms" ? "SMS" : "Email";
}

export function ConversionLogPanel() {
  const [range, setRange] = useState<AnalyticsPreset>("3m");
  const [kind, setKind] = useState<"all" | EmailJourneyKind>("all");
  const [data, setData] = useState<ConversionLog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [proof, setProof] = useState<"all" | AttributionConfidence>("all");
  const [source, setSource] = useState<"all" | MessageSource>("all");

  const requestGen = useRef(0);

  const load = useCallback(
    async (refresh = false) => {
      const gen = ++requestGen.current;
      setLoading(true);
      setError("");
      let refreshOnce = refresh;
      try {
        for (;;) {
          const params = new URLSearchParams({ range, kind });
          if (refreshOnce) params.set("refresh", "1");
          refreshOnce = false;
          const res = await fetch(`/api/lifecycle/conversion-log?${params}`);
          const body = await res.json().catch(() => ({}));
          if (gen !== requestGen.current) return;
          if (!res.ok) {
            setError(
              typeof body.error === "string"
                ? body.error
                : "Could not load conversions."
            );
            setData(null);
            return;
          }
          const next = body as ConversionLog;
          setData(next);
          if (next.status !== "running") return;
          await new Promise((resolve) => setTimeout(resolve, 2000));
          if (gen !== requestGen.current) return;
        }
      } catch {
        if (gen !== requestGen.current) return;
        setError("Network error while loading conversions.");
        setData(null);
      } finally {
        if (gen === requestGen.current) setLoading(false);
      }
    },
    [range, kind]
  );

  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.rows.filter((row) => {
      if (proof !== "all" && row.confidence !== proof) return false;
      if (source !== "all" && row.messageSource !== source) return false;
      if (!q) return true;
      const hay = [
        row.clientName,
        row.contactName,
        row.contactEmail,
        row.sendName,
        row.subject,
        row.campaign,
        row.content,
        typeLabel(row.kind),
        proofLabel(row),
        sourceLabel(row.messageSource),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [data, query, proof, source]);

  return (
    <section className="lh-card lh-analytics lh-conversion-log lh-analytics-clean">
      <div className="lh-an-toolbar">
        <div className="lh-an-title">
          <h3>Conversion log</h3>
          {data ? (
            <p className="lh-an-sub">
              {prettyRange(data.start, data.end)}
              {data.cached ? " · cached" : ""}
              {" · "}
              {data.status === "running"
                ? `Loading ${fmt(data.progress.done)} of ${fmt(data.progress.total)} accounts`
                : `${fmt(data.scanned)} accounts · ${fmt(data.rows.length)} conversions`}
            </p>
          ) : (
            <p className="lh-an-sub">
              Form fills and bookings driven by a specific email or SMS
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
          <div className="lh-range" role="group" aria-label="Conversion type">
            {KIND_FILTERS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`lh-range-btn${kind === p.id ? " is-on" : ""}`}
                disabled={loading}
                onClick={() => {
                  requestGen.current += 1;
                  setLoading(false);
                  setKind(p.id);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="lh-range" role="group" aria-label="Proof">
            {PROOF_FILTERS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`lh-range-btn${proof === p.id ? " is-on" : ""}`}
                disabled={loading || !data}
                onClick={() => setProof(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="lh-range" role="group" aria-label="Channel">
            {SOURCE_FILTERS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`lh-range-btn${source === p.id ? " is-on" : ""}`}
                disabled={loading || !data}
                onClick={() => setSource(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="lh-link"
            disabled={loading}
            onClick={() => void load(Boolean(data && !data.incomplete))}
          >
            {loading ? "Loading…" : data && !data.incomplete ? "Refresh" : "Load all"}
          </button>
        </div>
      </div>

      {error ? <p className="lh-error">{error}</p> : null}

      {!data && !loading && !error ? (
        <p className="lh-card-note">
          Loads email and SMS conversions from every GHL-linked Lifecycle
          account except Trailhead. {attributionPortfolioNote()} Confirmed
          rows use UTM fields. Inferred rows are on that contact&apos;s thread.
          First run can take a few minutes.
        </p>
      ) : null}

      {loading && !data ? (
        <div className="lh-an-skeleton" aria-busy="true">
          <div className="lh-skel" />
          <div className="lh-skel" />
          <div className="lh-skel" />
        </div>
      ) : null}

      {data ? (
        <div className="lh-an-body">
          <p className="lh-an-accuracy">{utmAttributionLine(data.attributionDays)}</p>

          <div className="lh-an-band">
            <h4 className="lh-an-band-label">Totals</h4>
            <div className="lh-an-metrics" aria-label="Conversion totals">
              <div className="lh-an-metric">
                <span>Booked</span>
                <strong>{fmt(data.totals.appointments)}</strong>
                <em>Email or SMS</em>
              </div>
              <div className="lh-an-metric">
                <span>Forms</span>
                <strong>{fmt(data.totals.formFills)}</strong>
                <em>Email or SMS</em>
              </div>
              <div className="lh-an-metric">
                <span>Confirmed</span>
                <strong>{fmt(data.totals.confirmed)}</strong>
                <em>{fmt(data.totals.inferred)} inferred</em>
              </div>
              <div className="lh-an-metric">
                <span>SMS</span>
                <strong>{fmt(data.totals.sms)}</strong>
                <em>{fmt(data.totals.email)} email</em>
              </div>
              <div className="lh-an-metric">
                <span>Showing</span>
                <strong>{fmt(rows.length)}</strong>
                <em>
                  {query.trim() || proof !== "all" || source !== "all"
                    ? "filtered"
                    : `${fmt(data.scanned)} accounts`}
                </em>
              </div>
            </div>
          </div>

          <div className="lh-clog-search">
            <label className="sr-only" htmlFor="clog-search">
              Filter conversions
            </label>
            <input
              id="clog-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by account, contact, message, campaign…"
              disabled={loading}
            />
          </div>

          {rows.length === 0 ? (
            <p className="lh-empty">
              {`No email or SMS conversions in this window${
                query.trim() || proof !== "all" || source !== "all"
                  ? " match that filter"
                  : ""
              }.`}
            </p>
          ) : (
            <div className="lh-an-table-wrap lh-clog-table-wrap">
              <table className="lh-an-table lh-clog-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Account</th>
                    <th>Contact</th>
                    <th>Type</th>
                    <th>Message</th>
                    <th>Proof</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{prettyDay(row.conversionAt)}</strong>
                        {row.kind === "appointment" && row.formFilledAt ? (
                          <div className="lh-an-meta">
                            Form {prettyDay(row.formFilledAt)}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <Link
                          className="lh-an-name lh-attr-link"
                          href={`/admin/lifecycle?client=${encodeURIComponent(row.clientId)}`}
                        >
                          {row.clientName}
                        </Link>
                      </td>
                      <td>
                        <span className="lh-an-name">{contactLabel(row)}</span>
                        {row.contactEmail && row.contactName ? (
                          <div className="lh-an-meta">{row.contactEmail}</div>
                        ) : null}
                      </td>
                      <td>
                        <span
                          className={`lh-clog-type is-${
                            row.kind === "appointment" ? "booked" : "form"
                          }`}
                        >
                          {typeLabel(row.kind)}
                        </span>
                      </td>
                      <td>
                        <span className="lh-an-name">{row.content || row.sendName}</span>
                        <div className="lh-an-meta">
                          {sourceLabel(row.messageSource)}
                          {row.campaign ? ` · ${row.campaign}` : ""}
                          {row.subject && row.subject !== row.content
                            ? ` · ${row.subject}`
                            : ""}
                        </div>
                      </td>
                      <td>
                        <span className={`lh-proof is-${row.confidence}`}>
                          {proofLabel(row)}
                        </span>
                        {row.confidence === "inferred" && row.emailTouchDay ? (
                          <div className="lh-an-meta">
                            On thread {prettyDay(row.emailTouchDay)}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.status === "running" ? (
            <p className="lh-card-note">
              Loading {fmt(data.progress.done)} of {fmt(data.progress.total)}{" "}
              accounts. Conversions show up as each account finishes.
            </p>
          ) : null}
          {data.errors.map((err) => (
            <p key={err.clientId} className="lh-error">
              {err.clientName}: {err.error || "The account scan failed."}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
