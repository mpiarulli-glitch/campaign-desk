"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import type { AnalyticsPreset, EmailJourneyKind } from "@/lib/ghl-email-analytics";
import type { ConversionLog, ConversionLogRow } from "@/lib/conversion-log";

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

export function ConversionLogPanel() {
  const [range, setRange] = useState<AnalyticsPreset>("3m");
  const [kind, setKind] = useState<"all" | EmailJourneyKind>("all");
  const [data, setData] = useState<ConversionLog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ range, kind });
        if (refresh) params.set("refresh", "1");
        const res = await fetch(`/api/lifecycle/conversion-log?${params}`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(
            typeof body.error === "string"
              ? body.error
              : "Could not load conversions."
          );
          setData(null);
          return;
        }
        setData(body as ConversionLog);
      } catch {
        setError("Network error while loading conversions.");
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [range, kind]
  );

  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter((row) => {
      const hay = [
        row.clientName,
        row.contactName,
        row.contactEmail,
        row.sendName,
        row.subject,
        typeLabel(row.kind),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [data, query]);

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
              {fmt(data.scanned)} accounts · {fmt(data.rows.length)} conversions
            </p>
          ) : (
            <p className="lh-an-sub">
              Email-attributed bookings and form fills across every account
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
          <div className="lh-range" role="group" aria-label="Conversion type">
            {KIND_FILTERS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`lh-range-btn${kind === p.id ? " is-on" : ""}`}
                disabled={loading}
                onClick={() => setKind(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="lh-link"
            disabled={loading}
            onClick={() => void load(Boolean(data))}
          >
            {loading ? "Loading…" : data ? "Refresh" : "Load all"}
          </button>
        </div>
      </div>

      {error ? <p className="lh-error">{error}</p> : null}

      {!data && !loading && !error ? (
        <p className="lh-card-note">
          Loads email-attributed conversions from every GHL-linked Lifecycle
          account. Same honesty rules as Email wins — confirmation-only paths
          stay out. First run can take a few minutes.
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
          <p className="lh-an-accuracy">
            Only conversions with a real outbound marketing email on the contact
            within {data.attributionDays} days. Source is the credited campaign
            or flow send — not landing-page URL or HDYHAU (Campaign Desk does not
            store those).
          </p>

          <div className="lh-an-band">
            <h4 className="lh-an-band-label">Totals</h4>
            <div className="lh-an-metrics" aria-label="Conversion totals">
              <div className="lh-an-metric">
                <span>Booked</span>
                <strong>{fmt(data.totals.appointments)}</strong>
                <em>Email → booked</em>
              </div>
              <div className="lh-an-metric">
                <span>Forms</span>
                <strong>{fmt(data.totals.formFills)}</strong>
                <em>Email → form</em>
              </div>
              <div className="lh-an-metric">
                <span>Showing</span>
                <strong>{fmt(rows.length)}</strong>
                <em>
                  {query.trim()
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
              placeholder="Filter by account, contact, send…"
              disabled={loading}
            />
          </div>

          {rows.length === 0 ? (
            <p className="lh-empty">
              No email-attributed conversions in this window
              {query.trim() ? " match that filter" : ""}.
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
                    <th>Source</th>
                    <th>Subject</th>
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
                        <span className="lh-an-name">{row.sendName}</span>
                        <div className="lh-an-meta">
                          {row.sendChannel === "flow" ? "Flow" : "Campaign"}
                          {row.emailTouchDay
                            ? ` · touch ${prettyDay(row.emailTouchDay)}`
                            : row.sendOn
                              ? ` · sent ${prettyDay(row.sendOn)}`
                              : ""}
                        </div>
                      </td>
                      <td>
                        <span className="lh-clog-subject">
                          {row.subject || "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.errors.length > 0 ? (
            <details className="lh-clog-errors">
              <summary>
                {fmt(data.errors.length)} account
                {data.errors.length === 1 ? "" : "s"} failed to load
              </summary>
              <ul>
                {data.errors.map((err) => (
                  <li key={err.clientId}>
                    <strong>{err.clientName}</strong> — {err.error}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
