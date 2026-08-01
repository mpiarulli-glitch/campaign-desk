"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type ReportMeta = {
  type: string;
  label: string;
  blurb: string;
  ranged: boolean;
};

type Stat = { label: string; value: string; hint?: string };

type Section = {
  title: string;
  stats?: Stat[];
  columns?: string[];
  rows?: string[][];
  numeric?: number[];
  empty?: string;
  rowLinks?: Array<string | null>;
  linkColumn?: number;
};

type Report = {
  type: string;
  title: string;
  subtitle: string;
  range: { start: string; end: string } | null;
  generatedAt: string;
  sections: Section[];
};

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// Sensible starting range: the last full quarter of activity is usually what
// someone means by "run the report", and it is wide enough that a new account
// still shows something.
function defaultRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - 3);
  return { start: ymd(start), end: ymd(end) };
}

const PRESETS: Array<{ label: string; months: number }> = [
  { label: "30 days", months: 1 },
  { label: "3 months", months: 3 },
  { label: "6 months", months: 6 },
  { label: "12 months", months: 12 },
];

function prettyRange(range: { start: string; end: string }): string {
  const fmt = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  };
  return `${fmt(range.start)} to ${fmt(range.end)}`;
}

export default function ReportsPage() {
  const router = useRouter();
  const [metas, setMetas] = useState<ReportMeta[]>([]);
  const [type, setType] = useState<string>("time_tracking");
  const [range, setRange] = useState(defaultRange);
  const [report, setReport] = useState<Report | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.authenticated) router.push("/login");
      })
      .catch(() => {});
    fetch("/api/reports")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.reports) setMetas(d.reports);
      })
      .catch(() => setError("Could not load the report list."));
  }, [router]);

  const meta = metas.find((m) => m.type === type);

  const run = useCallback(async () => {
    setRunning(true);
    setError("");
    try {
      const qs = `type=${type}&start=${range.start}&end=${range.end}`;
      const res = await fetch(`/api/reports?${qs}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not run that report.");
        setReport(null);
      } else {
        setReport(data.report);
      }
    } catch {
      setError("Could not reach the server.");
    }
    setRunning(false);
  }, [type, range]);

  function applyPreset(months: number) {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - months);
    setRange({ start: ymd(start), end: ymd(end) });
  }

  const csvHref = `/api/reports?type=${type}&start=${range.start}&end=${range.end}&format=csv`;

  return (
    <div className="ops-scope">
      <div className="ops-page rpt-page">
        {/* Screen-only controls. The print stylesheet hides this whole block so
            the PDF starts at the report itself. */}
        <div className="rpt-setup">
          <div className="ops-page-head">
            <div>
              <p className="ops-eyebrow">Reporting</p>
              <h1 className="ops-title">Run a report.</h1>
              <p className="ops-sub">
                Pick what you want to see and the period it covers. Results show
                below, and print to a formatted PDF.
              </p>
            </div>
          </div>

          <div className="ops-panel rpt-picker">
            <div className="rpt-types">
              {metas.map((m) => (
                <button
                  key={m.type}
                  type="button"
                  className={`rpt-type ${type === m.type ? "is-on" : ""}`}
                  onClick={() => {
                    setType(m.type);
                    setReport(null);
                  }}
                >
                  <span className="rpt-type-label">{m.label}</span>
                  <span className="rpt-type-blurb">{m.blurb}</span>
                </button>
              ))}
            </div>

            <div className="rpt-controls">
              {/* Hidden rather than removed for an unranged report, so the row
                  does not jump as you switch between report types. */}
              <div
                className="rpt-dates"
                style={{ visibility: meta && !meta.ranged ? "hidden" : "visible" }}
              >
                <label htmlFor="rpt-start">From</label>
                <input
                  id="rpt-start"
                  type="date"
                  value={range.start}
                  max={range.end}
                  onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))}
                />
                <label htmlFor="rpt-end">To</label>
                <input
                  id="rpt-end"
                  type="date"
                  value={range.end}
                  min={range.start}
                  onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))}
                />
                <div className="rpt-presets">
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => applyPreset(p.months)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rpt-actions">
                <button className="btn" onClick={run} disabled={running}>
                  {running ? "Running…" : "Run report"}
                </button>
                {report ? (
                  <>
                    <button
                      className="btn btn-secondary"
                      onClick={() => window.print()}
                    >
                      Download PDF
                    </button>
                    <a className="btn btn-ghost" href={csvHref}>
                      Export CSV
                    </a>
                  </>
                ) : null}
              </div>
            </div>

            {meta && !meta.ranged ? (
              <p className="muted rpt-note">
                {meta.label} describes where things stand right now, so it is not
                limited to a date range.
              </p>
            ) : null}
            {error ? <p className="error" style={{ margin: "10px 0 0" }}>{error}</p> : null}
          </div>
        </div>

        {report ? (
          // The printed document. Everything inside .rpt-doc is what lands in
          // the PDF, in this order, which is why the letterhead lives here
          // rather than in the controls above.
          <article className="rpt-doc">
            <header className="rpt-letterhead">
              <div>
                <p className="rpt-org">Marketing Empire Group</p>
                <h2 className="rpt-title">{report.title}</h2>
                <p className="rpt-meta">
                  {report.range ? prettyRange(report.range) : "Current state"}
                </p>
              </div>
              <div className="rpt-stamp">
                <span className="rpt-stamp-label">Generated</span>
                <span className="rpt-stamp-value">
                  {new Date(report.generatedAt).toLocaleString("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
              </div>
            </header>

            <p className="rpt-subtitle">{report.subtitle}</p>

            {report.sections.map((section) => (
              <section key={section.title} className="rpt-section">
                <h3 className="rpt-section-title">{section.title}</h3>

                {section.stats ? (
                  <div className="rpt-stats">
                    {section.stats.map((s) => (
                      <div key={s.label} className="rpt-stat">
                        <span className="rpt-stat-value">{s.value}</span>
                        <span className="rpt-stat-label">{s.label}</span>
                        {s.hint ? <span className="rpt-stat-hint">{s.hint}</span> : null}
                      </div>
                    ))}
                  </div>
                ) : null}

                {section.columns ? (
                  section.rows && section.rows.length ? (
                    <div className="rpt-table-wrap">
                      <table className="rpt-table">
                        <thead>
                          <tr>
                            {section.columns.map((c, i) => (
                              <th
                                key={c}
                                className={section.numeric?.includes(i) ? "num" : ""}
                              >
                                {c}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {section.rows.map((row, ri) => {
                            const href = section.rowLinks?.[ri];
                            const linkCol = section.linkColumn ?? 0;
                            return (
                              <tr key={ri}>
                                {row.map((cell, ci) => (
                                  <td
                                    key={ci}
                                    className={section.numeric?.includes(ci) ? "num" : ""}
                                  >
                                    {href && ci === linkCol ? (
                                      <a href={href} target="_blank" rel="noreferrer">
                                        {cell}
                                      </a>
                                    ) : (
                                      cell
                                    )}
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="muted rpt-empty">{section.empty || "Nothing to show."}</p>
                  )
                ) : null}
              </section>
            ))}

            <footer className="rpt-foot">
              Marketing Empire Group · {report.title}
              {report.range ? ` · ${prettyRange(report.range)}` : ""}
            </footer>
          </article>
        ) : (
          <div className="ops-panel rpt-blank">
            <p className="muted" style={{ margin: 0 }}>
              {meta ? meta.blurb : "Pick a report to get started."}
            </p>
            <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
              Nothing has been run yet.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
