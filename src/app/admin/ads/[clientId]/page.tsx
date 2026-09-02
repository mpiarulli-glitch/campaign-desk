"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ADS_CHANNELS,
  ADS_STATUSES,
  LEAD_MAGNETS,
  NURTURE_STATUSES,
  TRACKING_ITEMS,
  adsAnalyticsRates,
  adsSetupSteps,
  adsStatusLabel,
  currentAdsPeriod,
  cycleTracking,
  emptyAdsAnalytics,
  formatAdsRate,
  formatSpend,
  landingHref,
  reviewSignal,
  reviewSignalLabel,
  type AdsAnalyticsMonth,
  type AdsChannel,
  type AdsClientRow,
  type AdsStatus,
  type LeadMagnet,
  type NurtureStatus,
  type TrackingKey,
} from "@/lib/ads";
import { metricPeriodLabel } from "@/lib/metric-period";

const AVATAR_COLORS = [
  "#d98b2b",
  "#3b82f6",
  "#10b981",
  "#8b5cf6",
  "#ef4444",
  "#0ea5e9",
  "#f59e0b",
  "#ec4899",
];

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function avatarColor(name: string): string {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

function ClientMark({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  if (logoUrl && !failed) {
    return (
      <span className="ads-avatar">
        <img src={logoUrl} alt="" width={22} height={22} onError={() => setFailed(true)} />
      </span>
    );
  }
  return (
    <span className="ads-avatar is-initials" style={{ background: avatarColor(name) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export default function AdsClientPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const router = useRouter();
  const [row, setRow] = useState<AdsClientRow | null>(null);
  const [analytics, setAnalytics] = useState<AdsAnalyticsMonth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/ads/${clientId}`);
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (res.status === 404) {
      setError("Client not found.");
      setLoading(false);
      return;
    }
    if (!res.ok) {
      setError("Failed to load.");
      setLoading(false);
      return;
    }
    const json = (await res.json()) as { row: AdsClientRow; analytics: AdsAnalyticsMonth[] };
    setRow(json.row);
    setAnalytics(json.analytics || []);
    setError("");
    setLoading(false);
  }, [clientId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(body: Record<string, unknown>) {
    if (!clientId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/ads/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return;
      const json = (await res.json()) as { row: AdsClientRow };
      if (json.row) setRow(json.row);
    } finally {
      setSaving(false);
    }
  }

  async function saveAnalytics(body: Record<string, unknown>) {
    if (!clientId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/ads/${clientId}/analytics`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return;
      const json = (await res.json()) as { month: AdsAnalyticsMonth };
      if (!json.month) return;
      setAnalytics((prev) => {
        const rest = prev.filter((m) => m.period !== json.month.period);
        return [json.month, ...rest].sort((a, b) => b.period.localeCompare(a.period));
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="ops-page ads-page">
        <p className="muted">Loading…</p>
      </div>
    );
  }
  if (error || !row) {
    return (
      <div className="ops-page ads-page">
        <p className="error">{error || "Client not found."}</p>
        <Link href="/admin/ads" className="btn btn-secondary btn-sm">
          Back to ads
        </Link>
      </div>
    );
  }

  const href = landingHref(row.landingPageUrl);
  const signal = reviewSignal(row.lastReviewedAt);
  const steps = adsSetupSteps(row);
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className="ops-page ads-page ads-client-page">
      <div className="ops-page-head">
        <div>
          <p className="ops-eyebrow">
            <Link href="/admin/ads">Weekly ads pass</Link>
            {" / "}
            Setup
          </p>
          <h1 className="ops-title ads-client-title">
            <ClientMark name={row.name} logoUrl={row.logoUrl} />
            {row.name}
          </h1>
          <p className="ops-sub">
            {row.accountManager || "No AM"}
            {" · "}
            <span className={`ads-status is-${row.status}`}>{adsStatusLabel(row.status)}</span>
            {" · "}
            {doneCount}/{steps.length} setup steps done
            {saving ? " · Saving…" : ""}
          </p>
        </div>
        <div className="ads-pass-actions">
          <span className={`ads-review is-${signal.kind}`}>{reviewSignalLabel(signal)}</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={saving}
            onClick={() => void patch({ markReviewed: true })}
          >
            Mark reviewed
          </button>
          <Link className="btn btn-ghost btn-sm" href={`/admin/clients/${row.clientId}`}>
            Open client
          </Link>
        </div>
      </div>

      {row.gaps.length ? (
        <div className="ads-gaps ads-pass-gaps">
          {row.gaps.map((g) => (
            <span key={g.key} className={`ads-gap is-${g.severity}`}>
              {g.label}
            </span>
          ))}
        </div>
      ) : row.ready ? (
        <div className="ads-gaps ads-pass-gaps">
          <span className="ads-gap is-ready">Funnel ready</span>
        </div>
      ) : null}

      <section className="ads-detail-section">
        <header className="ads-detail-head">
          <h2>Setup steps</h2>
          <p>The same checklist as the original ads editor, as a pass you can walk through.</p>
        </header>
        <SetupSteps row={row} href={href} onPatch={(body) => void patch(body)} />
      </section>

      <section className="ads-detail-section">
        <header className="ads-detail-head">
          <h2>Analytics</h2>
          <p>
            Typed in for the weekly pass — Campaign Desk does not pull live Google Ads numbers.
          </p>
        </header>
        <AnalyticsPanel months={analytics} spendLimit={row.monthlySpendLimit} saving={saving} onSave={(body) => void saveAnalytics(body)} />
      </section>
    </div>
  );
}

function SetupSteps({
  row,
  href,
  onPatch,
}: {
  row: AdsClientRow;
  href: string | null;
  onPatch: (body: Record<string, unknown>) => void;
}) {
  const steps = adsSetupSteps(row);
  const [cid, setCid] = useState(row.googleCustomerId);
  const [landingLabel, setLandingLabel] = useState(row.landingPageLabel);
  const [magnetNotes, setMagnetNotes] = useState(row.leadMagnetNotes);
  const [nurtureNotes, setNurtureNotes] = useState(row.nurtureNotes);
  const [conversion, setConversion] = useState(row.conversionAction);
  const [offer, setOffer] = useState(row.offer);
  const [notes, setNotes] = useState(row.notes);

  useEffect(() => {
    setCid(row.googleCustomerId);
    setLandingLabel(row.landingPageLabel);
    setMagnetNotes(row.leadMagnetNotes);
    setNurtureNotes(row.nurtureNotes);
    setConversion(row.conversionAction);
    setOffer(row.offer);
    setNotes(row.notes);
  }, [row.clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleChannel(channel: AdsChannel) {
    const next = row.channels.includes(channel)
      ? row.channels.filter((c) => c !== channel)
      : [...row.channels, channel];
    onPatch({ channels: next });
  }

  return (
    <ol className="ads-setup">
      <SetupStep step={steps[0]} index={1}>
        <div className="ads-seg">
          {ADS_STATUSES.map((s) => (
            <button
              key={s.value}
              type="button"
              className={row.status === s.value ? "on" : ""}
              aria-pressed={row.status === s.value}
              onClick={() => onPatch({ status: s.value as AdsStatus })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </SetupStep>
      <SetupStep step={steps[1]} index={2}>
        <div className="ads-editor-grid">
          <div className="field">
            <label htmlFor="ads-spend">Monthly spend limit</label>
            <SpendInput id="ads-spend" value={row.monthlySpendLimit} onCommit={(next) => onPatch({ monthlySpendLimit: next })} />
          </div>
          <label className="field">
            Google Ads customer ID
            <input
              value={cid}
              onChange={(e) => setCid(e.target.value)}
              onBlur={() => {
                if (cid.trim() === row.googleCustomerId) return;
                onPatch({ googleCustomerId: cid });
              }}
              placeholder="123-456-7890"
            />
          </label>
        </div>
      </SetupStep>
      <SetupStep step={steps[2]} index={3}>
        <div className="ads-channel-toggles">
          {ADS_CHANNELS.map((c) => (
            <button
              key={c.value}
              type="button"
              className={row.channels.includes(c.value) ? "on" : ""}
              aria-pressed={row.channels.includes(c.value)}
              onClick={() => toggleChannel(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </SetupStep>
      <SetupStep step={steps[3]} index={4}>
        <div className="ads-editor-grid">
          <label className="field">
            Landing page URL
            <span className="ads-landing-edit">
              <LandingInput value={row.landingPageUrl} onCommit={(next) => onPatch({ landingPageUrl: next })} />
              {href ? (
                <a className="ads-link" href={href} target="_blank" rel="noreferrer">
                  Open
                </a>
              ) : null}
            </span>
          </label>
          <label className="field">
            Landing page name
            <input
              value={landingLabel}
              onChange={(e) => setLandingLabel(e.target.value)}
              onBlur={() => {
                if (landingLabel.trim() === row.landingPageLabel) return;
                onPatch({ landingPageLabel: landingLabel });
              }}
              placeholder="Quote form, offer page…"
            />
          </label>
        </div>
      </SetupStep>
      <SetupStep step={steps[4]} index={5}>
        <p className="ads-hint" style={{ marginTop: 0 }}>
          Tracking {row.trackingDone}/{row.trackingTotal}. Click to cycle Not set → Yes → No.
        </p>
        <div className="ads-track-grid">
          {TRACKING_ITEMS.map((item) => {
            const state = row.tracking[item.key];
            return (
              <button
                key={item.key}
                type="button"
                className={`ads-track-item is-${state}`}
                aria-pressed={state === "yes"}
                onClick={() =>
                  onPatch({
                    tracking: { [item.key]: cycleTracking(state) } as Record<TrackingKey, string>,
                  })
                }
              >
                <span className="ads-track-mark" aria-hidden="true">
                  {state === "yes" ? "✓" : state === "no" ? "×" : "·"}
                </span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </SetupStep>
      <SetupStep step={steps[5]} index={6}>
        <div className="ads-editor-grid">
          <div className="field">
            <label htmlFor="ads-magnet">Lead magnet</label>
            <select
              id="ads-magnet"
              value={row.leadMagnet}
              onChange={(e) => onPatch({ leadMagnet: e.target.value as LeadMagnet })}
            >
              {LEAD_MAGNETS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <input
              value={magnetNotes}
              onChange={(e) => setMagnetNotes(e.target.value)}
              onBlur={() => {
                if (magnetNotes.trim() === row.leadMagnetNotes) return;
                onPatch({ leadMagnetNotes: magnetNotes });
              }}
              placeholder="Notes"
              style={{ marginTop: 8 }}
            />
          </div>
          <div className="field">
            <label htmlFor="ads-nurture">Nurture series</label>
            <select
              id="ads-nurture"
              value={row.nurtureStatus}
              onChange={(e) => onPatch({ nurtureStatus: e.target.value as NurtureStatus })}
            >
              {NURTURE_STATUSES.map((n) => (
                <option key={n.value} value={n.value}>
                  {n.label}
                </option>
              ))}
            </select>
            {row.nurtureSource === "detected" && row.nurtureDetectedLabel ? (
              <span className="ads-hint">Found: {row.nurtureDetectedLabel}</span>
            ) : null}
            <input
              value={nurtureNotes}
              onChange={(e) => setNurtureNotes(e.target.value)}
              onBlur={() => {
                if (nurtureNotes.trim() === row.nurtureNotes) return;
                onPatch({ nurtureNotes: nurtureNotes });
              }}
              placeholder="Notes"
              style={{ marginTop: 8 }}
            />
          </div>
        </div>
      </SetupStep>
      <SetupStep step={steps[6]} index={7}>
        <div className="ads-editor-grid">
          <label className="field">
            Conversion action
            <input
              value={conversion}
              onChange={(e) => setConversion(e.target.value)}
              onBlur={() => {
                if (conversion.trim() === row.conversionAction) return;
                onPatch({ conversionAction: conversion });
              }}
              placeholder="Form submit, booked call…"
            />
          </label>
          <label className="field">
            Offer
            <input
              value={offer}
              onChange={(e) => setOffer(e.target.value)}
              onBlur={() => {
                if (offer.trim() === row.offer) return;
                onPatch({ offer: offer });
              }}
              placeholder="Free estimate, $50 off…"
            />
          </label>
        </div>
        <label className="field" style={{ marginTop: 12 }}>
          Notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if (notes.trim() === row.notes) return;
              onPatch({ notes });
            }}
            rows={3}
          />
        </label>
      </SetupStep>
    </ol>
  );
}

function SetupStep({
  step,
  index,
  children,
}: {
  step: { title: string; hint: string; done: boolean };
  index: number;
  children: React.ReactNode;
}) {
  return (
    <li className={`ads-setup-step ${step.done ? "is-done" : ""}`}>
      <header>
        <span className="ads-setup-num" aria-hidden="true">
          {step.done ? "✓" : index}
        </span>
        <div>
          <h3>{step.title}</h3>
          <p>{step.hint}</p>
        </div>
      </header>
      <div className="ads-setup-body">{children}</div>
    </li>
  );
}

function AnalyticsPanel({
  months,
  spendLimit,
  saving,
  onSave,
}: {
  months: AdsAnalyticsMonth[];
  spendLimit: number | null;
  saving: boolean;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const thisPeriod = currentAdsPeriod();
  const current = months.find((m) => m.period === thisPeriod) ?? emptyAdsAnalytics(thisPeriod);
  const rates = adsAnalyticsRates(current);
  const history = months.filter((m) => m.period !== thisPeriod);
  const [form, setForm] = useState({
    spend: current.spend == null ? "" : String(current.spend),
    impressions: current.impressions == null ? "" : String(current.impressions),
    clicks: current.clicks == null ? "" : String(current.clicks),
    conversions: current.conversions == null ? "" : String(current.conversions),
    leads: current.leads == null ? "" : String(current.leads),
    notes: current.notes,
  });

  useEffect(() => {
    setForm({
      spend: current.spend == null ? "" : String(current.spend),
      impressions: current.impressions == null ? "" : String(current.impressions),
      clicks: current.clicks == null ? "" : String(current.clicks),
      conversions: current.conversions == null ? "" : String(current.conversions),
      leads: current.leads == null ? "" : String(current.leads),
      notes: current.notes,
    });
  }, [current.period, current.spend, current.impressions, current.clicks, current.conversions, current.leads, current.notes]);

  function commit(partial: Record<string, unknown>) {
    onSave({ period: thisPeriod, ...partial });
  }

  const overCap = spendLimit != null && current.spend != null && current.spend > spendLimit;

  return (
    <div className="ads-analytics">
      <p className="ads-analytics-month">{metricPeriodLabel(thisPeriod)}</p>
      <div className="ops-stats ads-stats">
        <div className="ops-stat">
          <span className="n">{current.spend != null ? formatSpend(current.spend).replace("/mo", "") : "—"}</span>
          <span className="l">Spend{overCap ? " · over cap" : ""}</span>
        </div>
        <div className="ops-stat">
          <span className="n">{current.clicks != null ? current.clicks.toLocaleString() : "—"}</span>
          <span className="l">Clicks</span>
        </div>
        <div className="ops-stat">
          <span className="n">{current.leads != null ? current.leads.toLocaleString() : "—"}</span>
          <span className="l">Leads</span>
        </div>
        <div className="ops-stat">
          <span className="n">{formatAdsRate(rates.cpl, "money")}</span>
          <span className="l">Cost per lead</span>
        </div>
        <div className="ops-stat">
          <span className="n">{formatAdsRate(rates.ctr, "pct")}</span>
          <span className="l">CTR</span>
        </div>
        <div className="ops-stat">
          <span className="n">{formatAdsRate(rates.convRate, "pct")}</span>
          <span className="l">Conv. rate</span>
        </div>
      </div>
      <div className="ads-editor-grid">
        <label className="field">
          Spend
          <input
            type="number"
            min={0}
            step={10}
            value={form.spend}
            onChange={(e) => setForm((f) => ({ ...f, spend: e.target.value }))}
            onBlur={() => commit({ spend: form.spend === "" ? null : Number(form.spend) })}
          />
        </label>
        <label className="field">
          Impressions
          <input
            type="number"
            min={0}
            step={1}
            value={form.impressions}
            onChange={(e) => setForm((f) => ({ ...f, impressions: e.target.value }))}
            onBlur={() => commit({ impressions: form.impressions === "" ? null : Number(form.impressions) })}
          />
        </label>
        <label className="field">
          Clicks
          <input
            type="number"
            min={0}
            step={1}
            value={form.clicks}
            onChange={(e) => setForm((f) => ({ ...f, clicks: e.target.value }))}
            onBlur={() => commit({ clicks: form.clicks === "" ? null : Number(form.clicks) })}
          />
        </label>
        <label className="field">
          Conversions
          <input
            type="number"
            min={0}
            step={1}
            value={form.conversions}
            onChange={(e) => setForm((f) => ({ ...f, conversions: e.target.value }))}
            onBlur={() => commit({ conversions: form.conversions === "" ? null : Number(form.conversions) })}
          />
        </label>
        <label className="field">
          Leads
          <input
            type="number"
            min={0}
            step={1}
            value={form.leads}
            onChange={(e) => setForm((f) => ({ ...f, leads: e.target.value }))}
            onBlur={() => commit({ leads: form.leads === "" ? null : Number(form.leads) })}
          />
        </label>
        <label className="field">
          Notes
          <input
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            onBlur={() => {
              if (form.notes.trim() === current.notes) return;
              commit({ notes: form.notes });
            }}
            placeholder="What moved this month"
          />
        </label>
      </div>
      <p className="ads-hint">{saving ? "Saving…" : "Numbers save when you leave a field."}</p>
      {history.length ? (
        <table className="client-table ads-table ads-analytics-history">
          <thead>
            <tr>
              <th>Month</th>
              <th>Spend</th>
              <th>Clicks</th>
              <th>Leads</th>
              <th>CPL</th>
              <th>CTR</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {history.map((m) => {
              const r = adsAnalyticsRates(m);
              return (
                <tr key={m.period}>
                  <td>{metricPeriodLabel(m.period)}</td>
                  <td>{m.spend != null ? formatSpend(m.spend).replace("/mo", "") : "—"}</td>
                  <td>{m.clicks != null ? m.clicks.toLocaleString() : "—"}</td>
                  <td>{m.leads != null ? m.leads.toLocaleString() : "—"}</td>
                  <td>{formatAdsRate(r.cpl, "money")}</td>
                  <td>{formatAdsRate(r.ctr, "pct")}</td>
                  <td>{m.notes || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function SpendInput({
  id,
  value,
  onCommit,
}: {
  id?: string;
  value: number | null;
  onCommit: (next: number | null) => void;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => {
    setText(value == null ? "" : String(value));
  }, [value]);
  return (
    <input
      id={id}
      type="number"
      min={0}
      step={50}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const next = text.trim() === "" ? null : Number(text);
        if (next === value) return;
        if (next != null && !Number.isFinite(next)) return;
        onCommit(next);
      }}
      placeholder="e.g. 2500"
    />
  );
}

function LandingInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (next: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => {
    setText(value);
  }, [value]);
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text.trim() === value) return;
        onCommit(text);
      }}
      placeholder="https://"
    />
  );
}
