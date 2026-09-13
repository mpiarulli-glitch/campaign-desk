"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AnalyticsPreset,
  ClientEmailAnalytics,
  EmailJourneyKind,
  EmailJourneyRow,
  GhlCampaignRow,
  ListGrowthStats,
} from "@/lib/ghl-email-analytics";
import {
  formatGhlCampaignStatusLabel,
  isGhlCampaignNotYetSent,
} from "@/lib/ghl-email-campaign-status";
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

/** No real mail yet — scheduled/queued, or sent volume resolved to 0. */
function isPending(c: GhlCampaignRow): boolean {
  return isGhlCampaignNotYetSent(c.status) || c.sent <= 0;
}

function statusLabel(c: GhlCampaignRow): string {
  if (c.sent <= 0 && !isGhlCampaignNotYetSent(c.status)) {
    return "Unsent";
  }
  return formatGhlCampaignStatusLabel(c.status);
}

function fmtSent(c: GhlCampaignRow): string {
  return isPending(c) ? "—" : fmt(c.sent);
}

function fmtEngagement(c: GhlCampaignRow, rate: number): string {
  return isPending(c) ? "—" : fmtPct(rate);
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
  const [journeyKind, setJourneyKind] = useState<EmailJourneyKind | null>(
    null
  );
  const [journeys, setJourneys] = useState<EmailJourneyRow[] | null>(null);
  const [journeysLoading, setJourneysLoading] = useState(false);
  const [journeysError, setJourneysError] = useState("");

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

  const scheduledCount = useMemo(() => {
    if (!data) return 0;
    return data.campaigns.filter((c) => isGhlCampaignNotYetSent(c.status)).length;
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
      const res = await fetch(
        `/api/lifecycle/hub/${clientId}/analytics?${params}`
      );
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

  const openJourneys = useCallback(
    async (kind: EmailJourneyKind) => {
      if (!canPull || !ghlLinked) return;
      setJourneyKind(kind);
      setJourneys(null);
      setJourneysError("");
      setJourneysLoading(true);
      try {
        const params = new URLSearchParams({ range: preset, kind });
        if (preset === "custom") {
          params.set("from", from);
          params.set("to", to);
        }
        if (memberIds.length) params.set("members", memberIds.join(","));
        const res = await fetch(
          `/api/lifecycle/hub/${clientId}/analytics/journeys?${params}`
        );
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          journeys?: EmailJourneyRow[];
        };
        if (!res.ok || !body.journeys) {
          setJourneysError(body.error || "Could not load journeys.");
          setJourneys([]);
          return;
        }
        setJourneys(body.journeys);
      } catch {
        setJourneysError("Could not load journeys.");
        setJourneys([]);
      } finally {
        setJourneysLoading(false);
      }
    },
    [canPull, clientId, from, ghlLinked, memberIds, preset, to]
  );

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
          <h3>Email & revenue</h3>
        </div>
        <p className="lh-card-note">
          Link GoHighLevel from Lifecycle → Tools, or connect Housecall Pro /
          HubSpot above, to pull conversion stats.
        </p>
      </section>
    );
  }

  const totals = data?.totals;
  const growth = data?.listGrowth;

  return (
    <section className="lh-card lh-analytics lh-analytics-clean">
      <div className="lh-an-toolbar">
        <div className="lh-an-title">
          <h3>Email & revenue</h3>
          {data ? (
            <p className="lh-an-sub">{prettyRange(data.start, data.end)}</p>
          ) : (
            <p className="lh-an-sub">Outcomes and send health</p>
          )}
        </div>

        <div className="lh-an-controls">
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
          <button
            type="button"
            className="lh-link"
            onClick={() => void pull()}
            disabled={loading || (preset === "custom" && (!from || !to))}
          >
            {loading ? "Refreshing…" : data ? "Refresh" : "Load"}
          </button>
        </div>
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
            {loading ? "Loading…" : "Apply"}
          </button>
        </div>
      ) : null}

      {error ? <p className="lh-error">{error}</p> : null}

      {loading && !data ? (
        <div className="lh-an-skeleton" aria-busy="true">
          <div className="lh-skel" />
          <div className="lh-skel" />
          <div className="lh-skel" />
        </div>
      ) : null}

      {data && totals ? (
        <div className="lh-an-body">
          <p className="lh-an-accuracy">
            {data.moneyMode === "commerce" ? (
              <>
                Store revenue from monthly metrics. Open and click rates use
                actually sent campaigns only
                {scheduledCount > 0
                  ? ` · ${scheduledCount} scheduled excluded`
                  : ""}
                .
              </>
            ) : (
              <>
                Forms and bookings credited to the last send within{" "}
                {data.attributionDays} days. Open and click rates use actually
                sent campaigns only
                {scheduledCount > 0
                  ? ` · ${scheduledCount} scheduled excluded`
                  : ""}
                .
              </>
            )}
          </p>

          <div className="lh-an-band">
            <h4 className="lh-an-band-label">Outcomes</h4>
            <div className="lh-an-metrics" aria-label="Outcomes">
              {data.moneyMode === "commerce" && data.commerce ? (
                <>
                  <div className="lh-an-metric">
                    <span>Store revenue</span>
                    <strong>{fmtMoney(data.commerce.revenue)}</strong>
                    <em>
                      {fmt(data.commerce.orders)} orders · AOV{" "}
                      {fmtMoney(data.commerce.aov)}
                    </em>
                  </div>
                  <div className="lh-an-metric">
                    <span>Orders</span>
                    <strong>{fmt(data.commerce.orders)}</strong>
                    <em>{data.commerce.revenueSource}</em>
                  </div>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="lh-an-metric is-clickable"
                    onClick={() => void openJourneys("form_fill")}
                    disabled={!ghlLinked || attributed.forms <= 0 || loading}
                    title={
                      attributed.forms > 0
                        ? "See who filled a form after an email"
                        : "No attributed form fills in this range"
                    }
                  >
                    <span>Email → forms</span>
                    <strong>{fmt(attributed.forms)}</strong>
                    <em>
                      {data.formFills === null
                        ? `${data.attributionDays}-day last-touch`
                        : `${fmt(attributed.forms)} of ${fmt(data.formFills)} fills`}
                      {attributed.forms > 0 ? " · View journeys" : ""}
                    </em>
                  </button>
                  <button
                    type="button"
                    className="lh-an-metric is-clickable"
                    onClick={() => void openJourneys("appointment")}
                    disabled={
                      !ghlLinked || attributed.appointments <= 0 || loading
                    }
                    title={
                      attributed.appointments > 0
                        ? "See who booked after an email"
                        : "No attributed bookings in this range"
                    }
                  >
                    <span>Email → booked</span>
                    <strong>{fmt(attributed.appointments)}</strong>
                    <em>
                      {data.appointments === null
                        ? data.abandonedRecovery &&
                          !data.abandonedRecovery.error
                          ? `${fmt(data.abandonedRecovery.recoveredInWindow)} recovered · ${fmt(data.abandonedRecovery.stillAbandoned)} open`
                          : "Attributed bookings"
                        : `${fmt(attributed.appointments)} of ${fmt(data.appointments)} after a send`}
                      {attributed.appointments > 0 ? " · View journeys" : ""}
                    </em>
                  </button>
                </>
              )}
              <div className="lh-an-metric">
                <span>List net</span>
                <strong
                  className={
                    growth
                      ? growth.net >= 0
                        ? "is-up"
                        : "is-down"
                      : undefined
                  }
                >
                  {growth ? signedNet(growth.net) : "—"}
                </strong>
                <em>
                  {growth
                    ? `${fmt(growth.contactsAdded)} joined · ${fmt(growth.unsubscribed)} unsubbed`
                    : ghlLinked
                      ? "No growth in this pull"
                      : "Connect GHL for list growth"}
                </em>
              </div>
            </div>
          </div>

          <div className="lh-an-band">
            <h4 className="lh-an-band-label">Send health</h4>
            <div className="lh-an-metrics" aria-label="Send health">
              <div className="lh-an-metric">
                <span>Delivered</span>
                <strong>{fmt(totals.delivered || totals.sent)}</strong>
                <em>{fmt(totals.sent)} sent</em>
              </div>
              <div className="lh-an-metric">
                <span>Open rate</span>
                <strong>{fmtPct(totals.openRate)}</strong>
                <em>Sent campaigns only</em>
              </div>
              <div className="lh-an-metric">
                <span>Click rate</span>
                <strong>{fmtPct(totals.clickRate)}</strong>
                <em>{fmt(totals.unsubscribed)} unsubs</em>
              </div>
            </div>
          </div>

          {growth ? <GrowthChart growth={growth} /> : null}

          {data.moneyMode !== "commerce" &&
          data.abandonedRecovery &&
          !data.abandonedRecovery.error ? (
            <div className="lh-an-inline">
              <span className="lh-an-band-label">Abandoned recovery</span>
              <div className="lh-an-inline-stats">
                <span>
                  <strong>{fmt(data.abandonedRecovery.abandoned)}</strong> tagged
                </span>
                <span>
                  <strong>
                    {fmt(data.abandonedRecovery.recoveredInWindow)}
                  </strong>{" "}
                  recovered
                </span>
                <span>
                  <strong>
                    {fmt(data.abandonedRecovery.stillAbandoned)}
                  </strong>{" "}
                  still open
                </span>
                <span>
                  <strong>
                    {fmtPct(data.abandonedRecovery.recoveryRate)}
                  </strong>{" "}
                  rate
                </span>
              </div>
            </div>
          ) : null}

          <div className="lh-an-split">
            <div className="lh-an-main">
              <header className="lh-an-section-head">
                <h4>Flows</h4>
                <span className="lh-an-count">{rankedFlows.length}</span>
              </header>
              {rankedFlows.length === 0 ? (
                <p className="lh-card-note">
                  {data.flowsError
                    ? `Could not load flows: ${data.flowsError}`
                    : "No flows in this location yet."}
                </p>
              ) : (
                <div className="lh-an-flow-list">
                  {rankedFlows.slice(0, 8).map((flow, index) => (
                    <FlowRow
                      key={flow.id || flow.name}
                      flow={flow}
                      rank={index + 1}
                    />
                  ))}
                </div>
              )}

              <header className="lh-an-section-head lh-an-section-spaced">
                <div>
                  <h4>Campaigns</h4>
                  <p className="lh-card-note">
                    Scheduled rows stay visible with — metrics and stay out of
                    averages until they send.
                  </p>
                </div>
              </header>
              {data.campaigns.length === 0 ? (
                <p className="lh-card-note">No campaigns in this window.</p>
              ) : (
                <div className="lh-an-table-wrap">
                  <table className="lh-an-table">
                    <thead>
                      <tr>
                        <th>Campaign</th>
                        <th>Status</th>
                        <th>Sent</th>
                        <th>Open</th>
                        <th>Click</th>
                        <th>Forms</th>
                        <th>Booked</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.campaigns.map((c) => {
                        const pending = isPending(c);
                        return (
                          <tr
                            key={c.id || c.bulkRequestId || c.name}
                            className={pending ? "is-pending" : undefined}
                          >
                            <td>
                              <div className="lh-an-name">{c.name}</div>
                              <div className="lh-an-meta">
                                {c.subject?.trim() || "—"}
                                {c.sentOn ? ` · ${c.sentOn}` : ""}
                              </div>
                            </td>
                            <td>
                              <span
                                className={`lh-an-badge${
                                  pending ? " is-scheduled" : " is-sent"
                                }`}
                              >
                                {statusLabel(c)}
                              </span>
                            </td>
                            <td>{fmtSent(c)}</td>
                            <td>{fmtEngagement(c, c.openRate)}</td>
                            <td>{fmtEngagement(c, c.clickRate)}</td>
                            <td>{pending ? "—" : fmt(c.formFills)}</td>
                            <td>
                              {pending ? "—" : fmt(c.attributedAppointments)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {tips.length > 0 ? (
              <aside className="lh-an-side">
                <h4>Next moves</h4>
                <ul className="lh-an-tips">
                  {tips.slice(0, 4).map((tip) => (
                    <li key={tip.id} className={`is-${tip.tone}`}>
                      <strong>{tip.title}</strong>
                      <span>{tip.detail}</span>
                    </li>
                  ))}
                </ul>
              </aside>
            ) : null}
          </div>

          {data.formFillsError ? (
            <p className="lh-card-note">Form fills: {data.formFillsError}</p>
          ) : null}
          {data.appointmentsError ? (
            <p className="lh-card-note">
              Appointments: {data.appointmentsError}
            </p>
          ) : null}
          {growth?.error ? (
            <p className="lh-card-note">List growth: {growth.error}</p>
          ) : null}

          {journeyKind ? (
            <JourneyPanel
              kind={journeyKind}
              loading={journeysLoading}
              error={journeysError}
              journeys={journeys}
              onClose={() => {
                setJourneyKind(null);
                setJourneys(null);
                setJourneysError("");
              }}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function prettyDay(value: string | null | undefined): string {
  if (!value) return "—";
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString(
    "en-US",
    opts
  );
}

function contactLabel(row: EmailJourneyRow): string {
  if (row.contactName?.trim()) return row.contactName.trim();
  if (row.contactEmail?.trim()) return row.contactEmail.trim();
  if (row.contactId) return `Contact ${row.contactId.slice(0, 8)}`;
  return "Unknown contact";
}

function JourneyPanel({
  kind,
  loading,
  error,
  journeys,
  onClose,
}: {
  kind: EmailJourneyKind;
  loading: boolean;
  error: string;
  journeys: EmailJourneyRow[] | null;
  onClose: () => void;
}) {
  const title =
    kind === "appointment"
      ? "Email → booked journeys"
      : "Email → form journeys";

  return (
    <section className="lh-an-journeys" aria-label={title}>
      <header className="lh-an-section-head">
        <div>
          <h4>{title}</h4>
          <p className="lh-card-note">
            Last email before the{" "}
            {kind === "appointment" ? "booking" : "form fill"}, plus who it was.
          </p>
        </div>
        <button type="button" className="lh-link" onClick={onClose}>
          Close
        </button>
      </header>

      {loading ? <p className="lh-card-note">Loading journeys…</p> : null}
      {error ? <p className="lh-error">{error}</p> : null}

      {!loading && !error && journeys && journeys.length === 0 ? (
        <p className="lh-card-note">No journeys found in this range.</p>
      ) : null}

      {!loading && journeys && journeys.length > 0 ? (
        <ul className="lh-an-journey-list">
          {journeys.map((row) => (
            <li
              key={`${row.kind}:${row.contactId || "x"}:${row.conversionAt}:${row.sendId}`}
              className="lh-an-journey"
            >
              <div className="lh-an-journey-who">
                <strong>{contactLabel(row)}</strong>
                {row.contactEmail && row.contactName ? (
                  <span className="lh-an-meta">{row.contactEmail}</span>
                ) : null}
              </div>
              <ol className="lh-an-journey-steps">
                <li>
                  <em>Email</em>
                  <strong>
                    {prettyDay(row.emailTouchDay || row.sendOn)}
                  </strong>
                  <span className="lh-an-meta">
                    {row.subject || row.sendName}
                    {row.sendChannel === "flow" ? " · flow" : ""}
                    {!row.emailTouchDay && row.sendOn
                      ? " · credited send"
                      : ""}
                  </span>
                </li>
                {kind === "appointment" && row.formFilledAt ? (
                  <li>
                    <em>Form</em>
                    <strong>{prettyDay(row.formFilledAt)}</strong>
                  </li>
                ) : null}
                <li>
                  <em>{kind === "appointment" ? "Booked" : "Form"}</em>
                  <strong>{prettyDay(row.conversionAt)}</strong>
                </li>
              </ol>
            </li>
          ))}
        </ul>
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
    <section className="lh-an-growth" aria-label="List growth versus unsubscribes">
      <header className="lh-an-section-head">
        <h4>List growth</h4>
        <div className="lh-growth-legend" aria-hidden="true">
          <span className="is-join">Joined</span>
          <span className="is-leave">Unsubscribed</span>
        </div>
      </header>
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

function FlowRow({ flow, rank }: { flow: GhlCampaignRow; rank: number }) {
  return (
    <article className="lh-an-flow">
      <span className="lh-an-flow-rank">{rank}</span>
      <div className="lh-an-flow-body">
        <strong>{flow.name}</strong>
        <span className="lh-an-meta">
          {flow.abandonedRecovery ? "Recovery · " : ""}
          {flow.sentOn || "—"}
        </span>
      </div>
      <div className="lh-an-flow-stats">
        <span>
          <em>Booked</em>
          <strong>{fmt(flow.attributedAppointments)}</strong>
        </span>
        <span>
          <em>Forms</em>
          <strong>{fmt(flow.formFills)}</strong>
        </span>
        <span>
          <em>Click</em>
          <strong>{fmtPct(flow.clickRate)}</strong>
        </span>
      </div>
    </article>
  );
}
