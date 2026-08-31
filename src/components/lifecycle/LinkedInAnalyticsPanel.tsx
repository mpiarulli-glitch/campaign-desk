"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  ClientLinkedInAnalytics,
  LinkedInPreset,
} from "@/lib/skylead-client-analytics";

const PRESETS: Array<{ id: LinkedInPreset; label: string }> = [
  { id: "30d", label: "30 days" },
  { id: "60d", label: "60 days" },
  { id: "90d", label: "90 days" },
  { id: "all", label: "All time" },
];

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function prettyRange(start: string | null, end: string, days: number | null): string {
  if (!start || days == null) return "Lifetime totals from Skylead";
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  const a = new Date(`${start}T12:00:00`).toLocaleDateString("en-US", opts);
  const b = new Date(`${end}T12:00:00`).toLocaleDateString("en-US", opts);
  return `${a} – ${b}`;
}

export function LinkedInAnalyticsPanel({
  clientId,
  memberIds = [],
}: {
  clientId: string;
  memberIds?: string[];
}) {
  const [preset, setPreset] = useState<LinkedInPreset>("30d");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<ClientLinkedInAnalytics | null>(null);

  const pull = useCallback(
    async (force = false) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ range: preset });
        if (memberIds.length) params.set("members", memberIds.join(","));
        if (force) params.set("force", "1");
        const res = await fetch(
          `/api/lifecycle/hub/${clientId}/linkedin?${params}`
        );
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          analytics?: ClientLinkedInAnalytics;
        };
        if (!res.ok || !body.analytics) {
          setError(body.error || "Could not pull LinkedIn data.");
          setData(null);
          return;
        }
        setData(body.analytics);
      } catch {
        setError("Could not reach Skylead.");
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [clientId, memberIds, preset]
  );

  useEffect(() => {
    setData(null);
    setError("");
    void pull();
  }, [clientId, preset]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = data?.totals;

  return (
    <section className="lh-card lh-linkedin">
      <div className="lh-card-head">
        <h3>LinkedIn</h3>
        <button
          type="button"
          className="lh-link"
          onClick={() => void pull(true)}
          disabled={loading}
        >
          {loading ? "Refreshing…" : data ? "Refresh" : "Pull from Skylead"}
        </button>
      </div>

      <div className="lh-range" role="group" aria-label="LinkedIn range">
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

      {error ? <p className="lh-error">{error}</p> : null}

      {loading && !data ? (
        <p className="lh-card-note">Pulling LinkedIn campaigns from Skylead…</p>
      ) : null}

      {data && !data.configured ? (
        <p className="lh-card-note">
          Skylead is not connected on this environment. Set SKYLEAD_API_KEY to
          pull campaign stats.
        </p>
      ) : null}

      {data && data.configured && data.assigned === 0 ? (
        <p className="lh-card-note">
          No Skylead campaigns are assigned to this account yet. Assign them from
          Lifecycle → LinkedIn.
        </p>
      ) : null}

      {data && data.configured && data.assigned > 0 && totals ? (
        <div className="lh-analytics-body">
          <div className="lh-analytics-main">
            <p className="lh-analytics-window">
              {prettyRange(data.start, data.end, data.days)}
              {data.preset !== "all" && !data.windowComplete
                ? " · some campaigns still on lifetime (not enough daily history yet)"
                : ""}
            </p>
            <div className="lh-metrics">
              <div className="lh-metric">
                <b>{data.live}</b>
                <span>running</span>
              </div>
              <div className="lh-metric">
                <b>{fmt(totals.connectionsRequested)}</b>
                <span>requests</span>
              </div>
              <div className="lh-metric">
                <b>{fmt(totals.accepted)}</b>
                <span>accepted</span>
              </div>
              <div className="lh-metric">
                <b>{fmtPct(totals.acceptanceRate)}</b>
                <span>accept rate</span>
              </div>
              <div className="lh-metric">
                <b>{fmt(totals.replies)}</b>
                <span>replies</span>
              </div>
              <div className="lh-metric">
                <b>{fmtPct(totals.responseRate)}</b>
                <span>reply rate</span>
              </div>
            </div>

            <div className="lh-analytics-table-wrap">
              <table className="lh-analytics-table lh-linkedin-table">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Seat</th>
                    <th>Status</th>
                    <th>Requests</th>
                    <th>Accepted</th>
                    <th>Replies</th>
                    <th>Accept %</th>
                    <th>Reply %</th>
                    <th>Leads left</th>
                  </tr>
                </thead>
                <tbody>
                  {data.campaigns.map((c) => (
                    <tr key={c.id} className={c.isActive ? "" : "is-off"}>
                      <td>
                        <div className="lh-analytics-name">{c.name}</div>
                        {!c.windowComplete && data.preset !== "all" ? (
                          <div className="lh-analytics-meta">lifetime until daily history builds</div>
                        ) : null}
                      </td>
                      <td>{c.seatName}</td>
                      <td>
                        <span
                          className={`lh-li-status is-${c.statusLabel
                            .toLowerCase()
                            .replace(/\s+/g, "-")}`}
                        >
                          {c.statusLabel}
                        </span>
                      </td>
                      <td>{fmt(c.connectionsRequested)}</td>
                      <td>{fmt(c.accepted)}</td>
                      <td>{fmt(c.replies)}</td>
                      <td>{fmtPct(c.acceptanceRate)}</td>
                      <td>{fmtPct(c.responseRate)}</td>
                      <td>{fmt(c.remainingLeads)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="lh-recs" aria-label="LinkedIn status">
            <h4>Status</h4>
            <ul className="lh-recs-list">
                              <li className="lh-rec is-keep">
                <strong>
                  {data.live} of {data.assigned} running
                </strong>
                <span>Live Skylead campaigns assigned to this account.</span>
              </li>
              {data.needsRefresh > 0 ? (
                <li className="lh-rec is-watch">
                  <strong>{data.needsRefresh} need a refresh</strong>
                  <span>
                    Check acceptance, replies, or lead count on Lifecycle → LinkedIn.
                  </span>
                </li>
              ) : (
                <li className="lh-rec is-keep">
                  <strong>None flagged</strong>
                  <span>No campaigns on this account need a refresh right now.</span>
                </li>
              )}
              {data.preset !== "all" ? (
                <li className="lh-rec is-focus">
                  <strong>Window from daily snapshots</strong>
                  <span>
                    Skylead only exposes lifetime totals; we subtract earlier
                    snapshots for 30/60/90. New assigns show lifetime until history builds.
                  </span>
                </li>
              ) : (
                <li className="lh-rec is-focus">
                  <strong>Lifetime totals</strong>
                  <span>All-time figures straight from Skylead for each campaign.</span>
                </li>
              )}
            </ul>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
