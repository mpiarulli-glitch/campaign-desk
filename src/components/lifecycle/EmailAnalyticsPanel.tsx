"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AnalyticsPreset,
  ClientEmailAnalytics,
  GhlCampaignRow,
  ListGrowthStats,
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

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function signedNet(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US");
  if (n > 0) return `+${abs}`;
  if (n < 0) return `−${abs}`;
  return "0";
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

function flowScore(row: GhlCampaignRow): number {
  return row.attributedAppointments * 100 + row.formFills * 10 + row.clicked;
}

export function EmailAnalyticsPanel({
  clientId,
  memberIds = [],
  ghlLinked,
  crmLinked = false,
  businessModel = "home_service",
}: {
  clientId: string;
  memberIds?: string[];
  ghlLinked: boolean;
  /** True when Housecall Pro and/or HubSpot is linked for this client. */
  crmLinked?: boolean;
  businessModel?: "ecomm" | "b2b" | "home_service";
}) {
  const commerceClient = businessModel === "ecomm";
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

  const rankedFlows = useMemo(() => {
    if (!data) return [];
    return [...data.flows].sort((a, b) => flowScore(b) - flowScore(a));
  }, [data]);

  const attributed = useMemo(() => {
    if (!data) return { forms: 0, appointments: 0 };
    const rows = [...data.campaigns, ...data.flows];
    return {
      forms: rows.reduce((n, row) => n + (row.formFills || 0), 0),
      appointments: rows.reduce(
        (n, row) => n + (row.attributedAppointments || 0),
        0
      ),
    };
  }, [data]);

  const canPull = ghlLinked || commerceClient || crmLinked;

  const pull = useCallback(async () => {
    if (!canPull) return;
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
        warning?: string;
        analytics?: ClientEmailAnalytics;
      };
      if (!res.ok || !body.analytics) {
        setError(body.error || "Could not pull analytics.");
        setData(null);
        return;
      }
      setData(body.analytics);
      if (body.warning) setError(body.warning);
    } catch {
      setError("Could not pull analytics.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [canPull, clientId, from, memberIds, preset, to]);

  useEffect(() => {
    if (!canPull) return;
    if (preset === "custom") return;
    void pull();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPull, preset]);

  if (!canPull) {
    return (
      <section className="lh-card lh-analytics">
        <div className="lh-card-head">
          <h3>Email analytics</h3>
        </div>
        <p className="lh-card-note">
          Link GoHighLevel from Lifecycle → Tools, or connect Housecall Pro /
          HubSpot in CRM connections above, to pull conversion stats.
        </p>
      </section>
    );
  }

  const totals = data?.totals;
  const growth = data?.listGrowth;
  const maxFlow = Math.max(1, ...rankedFlows.map(flowScore));

  return (
    <section className="lh-card lh-analytics lh-analytics-dash">
      <div className="lh-analytics-toolbar">
        <div className="lh-analytics-hero">
          <div>
            <p className="lh-analytics-kicker">Performance studio</p>
            <h3>Email command center</h3>
            <p className="lh-card-note lh-analytics-lead">
              Attribution, per-flow health, and list growth — last-touch within your window.
            </p>
          </div>
          <button
            type="button"
            className="lh-link lh-analytics-refresh"
            onClick={() => void pull()}
            disabled={loading || (preset === "custom" && (!from || !to))}
          >
            {loading
              ? "Pulling…"
              : data
                ? "Refresh"
                : commerceClient
                  ? "Pull analytics"
                  : crmLinked && !ghlLinked
                    ? "Pull from CRM"
                    : "Pull from GHL"}
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
      </div>

      {error ? <p className="lh-error">{error}</p> : null}

      {loading && !data ? (
        <div className="lh-analytics-skeleton" aria-busy="true">
          <div className="lh-skel" />
          <div className="lh-skel" />
          <div className="lh-skel" />
          <div className="lh-skel is-wide" />
        </div>
      ) : null}

      {data && totals ? (
        <div className="lh-dash">
          <p className="lh-analytics-window">{prettyRange(data.start, data.end)}</p>
          <p className="lh-card-note">
            {data.moneyMode === "commerce" ? (
              <>
                DTC money is store <strong>orders</strong> and{" "}
                <strong>revenue</strong> from monthly metrics in this window.
                Email engagement still comes from GHL when linked.
              </>
            ) : (
              <>
                Form fills and bookings are credited to the most recent campaign
                or automation send in the prior {data.attributionDays} days.
                Abandoned recovery uses GHL tags (
                <code>abandoned booking</code> → <code>meeting booked</code>).
              </>
            )}
          </p>

          <div className="lh-kpi-grid" aria-label="Key outcomes">
            {data.moneyMode === "commerce" && data.commerce ? (
              <>
                <article className="lh-kpi is-teal">
                  <span className="lh-kpi-label">Store revenue</span>
                  <strong className="lh-kpi-value">{fmtMoney(data.commerce.revenue)}</strong>
                  <span className="lh-kpi-hint">
                    {fmt(data.commerce.orders)} orders · AOV {fmtMoney(data.commerce.aov)}
                  </span>
                </article>
                <article className="lh-kpi is-cyan">
                  <span className="lh-kpi-label">Months logged</span>
                  <strong className="lh-kpi-value">{fmt(data.commerce.months)}</strong>
                  <span className="lh-kpi-hint">Source: {data.commerce.revenueSource}</span>
                </article>
              </>
            ) : (
              <>
                <article className="lh-kpi is-teal">
                  <span className="lh-kpi-label">Email → forms</span>
                  <strong className="lh-kpi-value">{fmt(attributed.forms)}</strong>
                  <span className="lh-kpi-hint">
                    {data.formFills === null
                      ? `Last-touch · ${data.attributionDays}-day window`
                      : `${fmt(attributed.forms)} of ${fmt(data.formFills)} fills credited · ${data.attributionDays}-day window`}
                  </span>
                </article>
                <article className="lh-kpi is-cyan">
                  <span className="lh-kpi-label">Email → booked</span>
                  <strong className="lh-kpi-value">{fmt(attributed.appointments)}</strong>
                  <span className="lh-kpi-hint">
                    {data.appointments === null
                      ? data.abandonedRecovery && !data.abandonedRecovery.error
                        ? `${fmt(data.abandonedRecovery.recoveredInWindow)} recovered · ${fmt(data.abandonedRecovery.stillAbandoned)} still open`
                        : "Attributed bookings"
                      : `${fmt(attributed.appointments)} of ${fmt(data.appointments)} booked after a send`}
                  </span>
                </article>
              </>
            )}
            <article className="lh-kpi is-blue">
              <span className="lh-kpi-label">Engagement</span>
              <strong className="lh-kpi-value">{fmtPct(totals.openRate)}</strong>
              <span className="lh-kpi-hint">
                {fmt(totals.sent)} sent · {fmtPct(totals.clickRate)} click
              </span>
            </article>
            <article
              className={`lh-kpi ${growth && growth.net < 0 ? "is-rose" : "is-mint"}`}
            >
              <span className="lh-kpi-label">List growth</span>
              <strong
                className={`lh-kpi-value${
                  growth ? (growth.net >= 0 ? " is-up" : " is-down") : ""
                }`}
              >
                {growth ? signedNet(growth.net) : "—"}
              </strong>
              <span className="lh-kpi-hint">
                {growth
                  ? `${fmt(growth.contactsAdded)} joined · ${fmt(growth.unsubscribed)} unsubbed`
                  : ghlLinked
                    ? "No growth data in this pull"
                    : "Connect GHL to track joins vs leaves"}
              </span>
            </article>
          </div>

          {growth ? <GrowthChart growth={growth} /> : null}

          <div className="lh-dash-split">
            <div className="lh-dash-main">
              <header className="lh-dash-head">
                <div>
                  <h4>Flows</h4>
                  <p className="lh-card-note">
                    Ranked by attributed appointments, then forms, then clicks.
                  </p>
                </div>
                <span className="lh-dash-chip">{rankedFlows.length}</span>
              </header>
              {rankedFlows.length === 0 ? (
                <p className="lh-card-note">
                  {data.flowsError
                    ? `Could not load GHL flows: ${data.flowsError}`
                    : "No GHL flows found for this location yet."}
                </p>
              ) : (
                <div className="lh-flow-grid lh-flow-rail">
                  {rankedFlows.map((flow, index) => (
                    <FlowCard
                      key={flow.id || flow.name}
                      flow={flow}
                      rank={index + 1}
                      maxScore={maxFlow}
                    />
                  ))}
                </div>
              )}

              <header className="lh-dash-head lh-dash-head-spaced">
                <div>
                  <h4>Campaigns</h4>
                  <p className="lh-card-note">
                    Broadcast performance with {data.attributionDays}-day attribution.
                  </p>
                </div>
              </header>
              {data.campaigns.length === 0 ? (
                <p className="lh-card-note">No GHL campaigns found in that window.</p>
              ) : (
                <>
                  <div className="lh-campaign-cards" aria-label="Campaigns">
                    {data.campaigns.map((c) => (
                      <article
                        key={`m-${c.id || c.bulkRequestId || c.name}`}
                        className="lh-campaign-card"
                      >
                        <div className="lh-campaign-card-top">
                          <strong>{c.name}</strong>
                          <span>
                            {c.sentOn || "—"}
                            {c.statsAvailable ? "" : " · no stats yet"}
                          </span>
                        </div>
                        <p className="lh-campaign-subject">
                          {c.subject?.trim() || "—"}
                        </p>
                        <div className="lh-campaign-metrics">
                          <div>
                            <span>Sent</span>
                            <strong>{fmt(c.sent)}</strong>
                          </div>
                          <div>
                            <span>Open</span>
                            <strong>{fmtPct(c.openRate)}</strong>
                          </div>
                          <div>
                            <span>Click</span>
                            <strong>{fmtPct(c.clickRate)}</strong>
                          </div>
                          <div>
                            <span>Forms</span>
                            <strong>{fmt(c.formFills)}</strong>
                          </div>
                          <div>
                            <span>Booked</span>
                            <strong>{fmt(c.attributedAppointments)}</strong>
                          </div>
                          <div>
                            <span>Unsubs</span>
                            <strong>{fmt(c.unsubscribed)}</strong>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                  <div className="lh-analytics-table-wrap lh-campaign-table">
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
                          <th>Unsubs</th>
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
                            <td>{fmt(c.unsubscribed)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            <aside className="lh-dash-side">
              {data.moneyMode !== "commerce" && data.abandonedRecovery ? (
                <div className="lh-side-card">
                  <h4>Abandoned recovery</h4>
                  <p className="lh-card-note">
                    {data.attributionDays}-day window after abandon tag.
                  </p>
                  {data.abandonedRecovery.error ? (
                    <p className="lh-card-note">{data.abandonedRecovery.error}</p>
                  ) : (
                    <div className="lh-side-metrics">
                      <div>
                        <span>Tagged</span>
                        <strong>{fmt(data.abandonedRecovery.abandoned)}</strong>
                      </div>
                      <div>
                        <span>Recovered</span>
                        <strong className="is-up">
                          {fmt(data.abandonedRecovery.recoveredInWindow)}
                        </strong>
                      </div>
                      <div>
                        <span>Still open</span>
                        <strong className="is-down">
                          {fmt(data.abandonedRecovery.stillAbandoned)}
                        </strong>
                      </div>
                      <div>
                        <span>Rate</span>
                        <strong>{fmtPct(data.abandonedRecovery.recoveryRate)}</strong>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              <div className="lh-side-card">
                <h4>Engagement rollup</h4>
                <p className="lh-card-note">Campaigns and flows in this window.</p>
                <div className="lh-side-metrics">
                  <div>
                    <span>Delivered</span>
                    <strong>{fmt(totals.delivered || totals.sent)}</strong>
                  </div>
                  <div>
                    <span>Opens</span>
                    <strong>{fmtPct(totals.openRate)}</strong>
                  </div>
                  <div>
                    <span>Clicks</span>
                    <strong>{fmtPct(totals.clickRate)}</strong>
                  </div>
                  <div>
                    <span>Unsubs</span>
                    <strong>{fmt(totals.unsubscribed)}</strong>
                  </div>
                </div>
              </div>

              {tips.length > 0 ? (
                <div className="lh-side-card lh-tips-card">
                  <h4>What to do next</h4>
                  <ul className="lh-recs-list">
                    {tips.map((tip) => (
                      <li key={tip.id} className={`lh-rec is-${tip.tone}`}>
                        <strong>{tip.title}</strong>
                        <span>{tip.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </aside>
          </div>

          {data.formFillsError ? (
            <p className="lh-card-note">Form fills: {data.formFillsError}</p>
          ) : null}
          {data.appointmentsError ? (
            <p className="lh-card-note">Appointments: {data.appointmentsError}</p>
          ) : null}
          {growth?.error ? (
            <p className="lh-card-note">List growth: {growth.error}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function GrowthChart({ growth }: { growth: ListGrowthStats }) {
  const max = Math.max(
    1,
    ...growth.series.map((b) => Math.max(b.contactsAdded, b.unsubscribed))
  );

  return (
    <section className="lh-growth" aria-label="List growth versus unsubscribes">
      <header className="lh-dash-head">
        <div>
          <h4>List growth vs unsubscribes</h4>
          <p className="lh-card-note">
            New GHL contacts versus email unsubscribes from campaigns and flows.
          </p>
        </div>
        <div className="lh-growth-legend" aria-hidden="true">
          <span className="is-join">Joined</span>
          <span className="is-leave">Unsubscribed</span>
        </div>
      </header>
      <div className="lh-growth-summary">
        <div>
          <span>Joined</span>
          <strong>{fmt(growth.contactsAdded)}</strong>
        </div>
        <div>
          <span>Unsubscribed</span>
          <strong>{fmt(growth.unsubscribed)}</strong>
        </div>
        <div>
          <span>Net</span>
          <strong className={growth.net >= 0 ? "is-up" : "is-down"}>
            {signedNet(growth.net)}
          </strong>
        </div>
        <div>
          <span>Unsub rate</span>
          <strong>{fmtPct(growth.unsubscribeRate)}</strong>
        </div>
      </div>
      {growth.series.length === 0 ? (
        <p className="lh-card-note">No weekly growth data in this range.</p>
      ) : (
        <div
          className="lh-growth-chart"
          role="img"
          aria-label="Weekly list growth versus unsubscribes"
        >
          {growth.series.map((bucket) => (
            <div key={bucket.weekStart} className="lh-growth-col">
              <div className="lh-growth-bars">
                <div
                  className="lh-growth-bar is-join"
                  style={{
                    height: `${Math.max(
                      bucket.contactsAdded > 0 ? 8 : 3,
                      (bucket.contactsAdded / max) * 100
                    )}%`,
                  }}
                  title={`${bucket.contactsAdded} joined`}
                />
                <div
                  className="lh-growth-bar is-leave"
                  style={{
                    height: `${Math.max(
                      bucket.unsubscribed > 0 ? 8 : 3,
                      (bucket.unsubscribed / max) * 100
                    )}%`,
                  }}
                  title={`${bucket.unsubscribed} unsubscribed`}
                />
              </div>
              <span className="lh-growth-label">{bucket.label}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function FlowCard({
  flow,
  rank,
  maxScore,
}: {
  flow: GhlCampaignRow;
  rank: number;
  maxScore: number;
}) {
  const score = flowScore(flow);
  const heat = Math.round((score / maxScore) * 100);

  return (
    <article className="lh-flow-card">
      <div className="lh-flow-card-top">
        <span className="lh-flow-rank">#{rank}</span>
        <div className="lh-flow-heat" aria-hidden="true">
          <span style={{ width: `${heat}%` }} />
        </div>
      </div>
      <h5>{flow.name}</h5>
      <p className="lh-analytics-meta">
        {flow.abandonedRecovery ? "Abandoned booking recovery · " : ""}
        {flow.sentOn || "—"}
        {flow.statsAvailable ? "" : " · no stats yet"}
      </p>
      <div className="lh-flow-stats">
        <div>
          <span>Sent</span>
          <strong>{fmt(flow.sent)}</strong>
        </div>
        <div>
          <span>Open</span>
          <strong>{fmtPct(flow.openRate)}</strong>
        </div>
        <div>
          <span>Click</span>
          <strong>{fmtPct(flow.clickRate)}</strong>
        </div>
        <div>
          <span>Forms</span>
          <strong>{fmt(flow.formFills)}</strong>
        </div>
        <div>
          <span>Appts</span>
          <strong>{fmt(flow.attributedAppointments)}</strong>
        </div>
        <div>
          <span>Unsubs</span>
          <strong>{fmt(flow.unsubscribed)}</strong>
        </div>
      </div>
    </article>
  );
}
