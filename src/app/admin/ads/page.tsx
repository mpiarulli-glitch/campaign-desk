"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ADS_CHANNELS,
  ADS_STATUSES,
  LEAD_MAGNETS,
  NURTURE_STATUSES,
  adsBoardLane,
  adsDashboardCounts,
  adsPassSummary,
  adsStatusLabel,
  canMarkReviewedOnRow,
  cycleTracking,
  formatSpend,
  landingHost,
  landingHref,
  reviewSignal,
  reviewSignalLabel,
  sortAdsRows,
  trackingItemLabel,
  trackingPlan,
  type AdsBoardLane,
  type AdsChannel,
  type AdsClientRow,
  type AdsDashboard,
  type AdsStatus,
  type LeadMagnet,
  type NurtureStatus,
  type TrackingKey,
} from "@/lib/ads";

type Filter =
  | "attention"
  | "block"
  | "watch"
  | "all"
  | "ready"
  | "active"
  | "paused"
  | "off"
  | "unknown";

const EMPTY_ROWS: AdsClientRow[] = [];

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

const LANE_COPY: Record<AdsBoardLane, { title: string; hint: string }> = {
  block: {
    title: "Blocking",
    hint: "Ads on with a hole — landing page, spend cap, campaign type, or required tracking.",
  },
  watch: {
    title: "Watch",
    hint: "Stale review, not filled in, or a funnel piece still unknown.",
  },
  ok: {
    title: "Clear",
    hint: "No gaps on the board. Still mark reviewed when you do the weekly pass.",
  },
};

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

export default function AdsDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<AdsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [filter, setFilter] = useState<Filter>("attention");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/ads");
    if (res.status === 401) {
      setDenied(true);
      return;
    }
    if (!res.ok) {
      setError("Failed to load.");
      setLoading(false);
      return;
    }
    setData(await res.json());
    setError("");
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (denied) router.push("/login");
  }, [denied, router]);

  const replaceRow = useCallback((row: AdsClientRow) => {
    setData((prev) => {
      if (!prev) return prev;
      const rows = sortAdsRows(prev.rows.map((r) => (r.clientId === row.clientId ? row : r)));
      return { rows, counts: adsDashboardCounts(rows) };
    });
  }, []);

  async function patch(clientId: string, body: Record<string, unknown>) {
    setSavingId(clientId);
    try {
      const res = await fetch(`/api/ads/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return;
      const json = (await res.json()) as { row: AdsClientRow };
      if (json.row) replaceRow(json.row);
    } finally {
      setSavingId(null);
    }
  }

  const rows = data?.rows ?? EMPTY_ROWS;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "attention" && r.gaps.length === 0) return false;
      if (filter === "block" && adsBoardLane(r.gaps) !== "block") return false;
      if (filter === "watch" && adsBoardLane(r.gaps) !== "watch") return false;
      if (filter === "ready" && !r.ready) return false;
      if (filter === "active" && r.status !== "active") return false;
      if (filter === "paused" && r.status !== "paused") return false;
      if (filter === "off" && r.status !== "off") return false;
      if (filter === "unknown" && r.status !== "unknown") return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, filter, query]);

  const groups = useMemo(() => {
    const lanes: Record<AdsBoardLane, AdsClientRow[]> = { block: [], watch: [], ok: [] };
    for (const row of visible) lanes[adsBoardLane(row.gaps)].push(row);
    return (["block", "watch", "ok"] as AdsBoardLane[])
      .map((lane) => ({ lane, rows: lanes[lane] }))
      .filter((g) => g.rows.length > 0);
  }, [visible]);

  const counts = data?.counts;
  const passLine = counts ? adsPassSummary(counts) : "";

  return (
    <div className="ops-page ads-page">
      <div className="ops-page-head">
        <div>
          <p className="ops-eyebrow">Paid media</p>
          <h1 className="ops-title">Weekly ads pass</h1>
          <p className="ops-sub">
            A checklist of what’s missing: ads on with no landing page, spend cap, conversion tag, or nurture.
            This is a snapshot you keep current — not live Google Ads numbers.
          </p>
        </div>
        <label className="ads-search">
          <span className="ads-search-label">Search</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clients"
            aria-label="Search clients"
          />
        </label>
      </div>

      {counts ? (
        <div className={`ads-pass-banner ${counts.attention === 0 ? "is-clear" : "is-work"}`}>
          <p className="ads-pass-banner-line">{passLine}</p>
          <p className="ads-pass-banner-hint">
            {counts.attention === 0
              ? "Open All clients if you want to browse funnel-ready accounts or mark reviews."
              : "Work top to bottom. Blocking first, then watch. Mark reviewed when an account is already complete."}
          </p>
        </div>
      ) : null}

      {counts ? (
        <div className="ops-stats ads-stats">
          <StatButton
            n={counts.attention}
            label="Needs attention"
            on={filter === "attention"}
            onClick={() => setFilter("attention")}
          />
          <StatButton
            n={counts.blocking}
            label="Blocking"
            on={filter === "block"}
            onClick={() => setFilter("block")}
          />
          <StatButton
            n={counts.watch}
            label="Watch"
            on={filter === "watch"}
            onClick={() => setFilter("watch")}
          />
          <StatButton
            n={counts.total}
            label="All clients"
            on={filter === "all"}
            onClick={() => setFilter("all")}
          />
          <StatButton
            n={counts.ready}
            label="Funnel ready"
            on={filter === "ready"}
            onClick={() => setFilter("ready")}
          />
          <StatButton
            n={counts.unknown}
            label="Not filled in"
            on={filter === "unknown"}
            onClick={() => setFilter("unknown")}
          />
        </div>
      ) : null}

      <div className="ads-pass-pills" role="group" aria-label="Status filters">
        <StatusPill label="Active" n={counts?.active ?? 0} on={filter === "active"} onClick={() => setFilter("active")} />
        <StatusPill label="Paused" n={counts?.paused ?? 0} on={filter === "paused"} onClick={() => setFilter("paused")} />
        <StatusPill label="Off" n={counts?.off ?? 0} on={filter === "off"} onClick={() => setFilter("off")} />
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : error ? (
        <p className="error">{error}</p>
      ) : visible.length === 0 ? (
        <div className="empty ads-empty">
          {rows.length === 0 ? (
            <p>No active clients yet.</p>
          ) : filter === "attention" && !query ? (
            <>
              <p>You’re clear. Nothing on the weekly list.</p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFilter("all")}>
                View all clients
              </button>
            </>
          ) : (
            <p>No clients match.</p>
          )}
        </div>
      ) : (
        <div className="ads-pass">
          {groups.map((group) => (
            <section key={group.lane} className={`ads-pass-lane is-${group.lane}`}>
              <header className="ads-pass-lane-head">
                <h2>
                  {LANE_COPY[group.lane].title}{" "}
                  <span className="ads-pass-lane-count">{group.rows.length}</span>
                </h2>
                <p>{LANE_COPY[group.lane].hint}</p>
              </header>
              <div className="ads-pass-list">
                {group.rows.map((row) => (
                  <PassRow
                    key={row.clientId}
                    row={row}
                    lane={group.lane}
                    open={openId === row.clientId}
                    saving={savingId === row.clientId}
                    onToggle={() => setOpenId(openId === row.clientId ? null : row.clientId)}
                    onPatch={(body) => void patch(row.clientId, body)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function StatButton({
  n,
  label,
  on,
  onClick,
}: {
  n: number;
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`ops-stat ads-stat ${on ? "on" : ""}`} onClick={onClick}>
      <span className="n">{n}</span>
      <span className="l">{label}</span>
    </button>
  );
}

function StatusPill({
  label,
  n,
  on,
  onClick,
}: {
  label: string;
  n: number;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`ads-pass-pill ${on ? "on" : ""}`} onClick={onClick}>
      {label} <span>{n}</span>
    </button>
  );
}

function PassRow({
  row,
  lane,
  open,
  saving,
  onToggle,
  onPatch,
}: {
  row: AdsClientRow;
  lane: AdsBoardLane;
  open: boolean;
  saving: boolean;
  onToggle: () => void;
  onPatch: (body: Record<string, unknown>) => void;
}) {
  const href = landingHref(row.landingPageUrl);
  const host = landingHost(row.landingPageUrl);
  const signal = reviewSignal(row.lastReviewedAt);
  const running = row.status === "active" || row.status === "paused";
  const showQuick = lane !== "ok" || open;
  const showDetails = running || open;
  const checkIn = canMarkReviewedOnRow(row.gaps);
  const shownGaps = row.gaps.slice(0, 4);
  const extra = row.gaps.length - shownGaps.length;

  return (
    <article className={`ads-pass-row is-${lane} ${open ? "is-open" : ""} ${saving ? "is-saving" : ""}`}>
      <div className="ads-pass-top">
        <div className="ads-pass-who">
          <ClientMark name={row.name} logoUrl={row.logoUrl} />
          <div>
            <div className="ads-pass-name-row">
              <span className="ads-client-name">{row.name}</span>
              <span className={`ads-status is-${row.status}`}>{adsStatusLabel(row.status)}</span>
            </div>
            <span className="ads-client-meta">
              {row.accountManager || "No AM"}
              {lane === "ok" ? (
                <>
                  {" · "}
                  {formatSpend(row.monthlySpendLimit)}
                  {host ? ` · ${row.landingPageLabel || host}` : ""}
                </>
              ) : null}
            </span>
          </div>
        </div>
        <div className="ads-pass-actions">
          <span className={`ads-review is-${signal.kind}`}>{reviewSignalLabel(signal)}</span>
          {checkIn ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={saving}
              onClick={() => onPatch({ markReviewed: true })}
            >
              Mark reviewed
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onToggle} aria-expanded={open}>
            {open ? "Less" : lane === "ok" ? "Edit" : "More"}
          </button>
        </div>
      </div>

      {row.ready && lane !== "ok" ? <span className="ads-gap is-ready">Funnel ready · review due</span> : null}

      {shownGaps.length ? (
        <div className="ads-gaps ads-pass-gaps">
          {shownGaps.map((g) => (
            <span key={g.key} className={`ads-gap is-${g.severity}`}>
              {g.label}
            </span>
          ))}
          {extra > 0 ? <span className="ads-gap is-more">+{extra}</span> : null}
        </div>
      ) : row.ready ? (
        <div className="ads-gaps ads-pass-gaps">
          <span className="ads-gap is-ready">Ready</span>
        </div>
      ) : null}

      {showQuick ? (
        <QuickFields row={row} href={href} showDetails={showDetails} onPatch={onPatch} />
      ) : null}

      {open ? <ExtraEditor row={row} saving={saving} href={href} onPatch={onPatch} /> : null}
    </article>
  );
}

function QuickFields({
  row,
  href,
  showDetails,
  onPatch,
}: {
  row: AdsClientRow;
  href: string | null;
  showDetails: boolean;
  onPatch: (body: Record<string, unknown>) => void;
}) {
  const plan = trackingPlan(row.channels);
  const trackKeys = [...plan.required, ...plan.recommended.filter((key) => row.tracking[key] !== "yes")];

  function toggleChannel(channel: AdsChannel) {
    const next = row.channels.includes(channel)
      ? row.channels.filter((c) => c !== channel)
      : [...row.channels, channel];
    onPatch({ channels: next });
  }

  return (
    <div className={`ads-quick ${showDetails ? "" : "is-status-only"}`}>
      <div className="field ads-status-field">
        <label>Ads status</label>
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
      </div>
      {!showDetails ? (
        <p className="ads-hint ads-quick-span">
          Set Active or Paused to fill spend, landing page, and tracking on this row. Off takes them off the weekly list.
        </p>
      ) : null}
      {showDetails ? (
        <>
          <div className="field">
            <label htmlFor={`ads-spend-${row.clientId}`}>Spend limit</label>
            <SpendInput
              id={`ads-spend-${row.clientId}`}
              value={row.monthlySpendLimit}
              onCommit={(next) => onPatch({ monthlySpendLimit: next })}
            />
          </div>
      <div className="field ads-quick-landing">
        <label htmlFor={`ads-landing-${row.clientId}`}>Landing page</label>
        <span className="ads-landing-edit">
          <LandingInput
            id={`ads-landing-${row.clientId}`}
            value={row.landingPageUrl}
            onCommit={(next) => onPatch({ landingPageUrl: next })}
          />
          {href ? (
            <a className="ads-link" href={href} target="_blank" rel="noreferrer">
              Open
            </a>
          ) : null}
        </span>
      </div>

      <div className="field ads-quick-span">
        <label>Campaign types</label>
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
      </div>

      <div className="ads-quick-pair">
        <div className="field">
          <label htmlFor={`ads-magnet-${row.clientId}`}>Lead magnet</label>
          <select
            id={`ads-magnet-${row.clientId}`}
            value={row.leadMagnet}
            onChange={(e) => onPatch({ leadMagnet: e.target.value as LeadMagnet })}
          >
            {LEAD_MAGNETS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`ads-nurture-${row.clientId}`}>Nurture</label>
          <select
            id={`ads-nurture-${row.clientId}`}
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
        </div>
      </div>
      <div className="field ads-quick-span">
        <label>
          Tracking {row.trackingDone}/{row.trackingTotal}
        </label>
        <div className="ads-quick-track">
          {trackKeys.map((key) => {
            const state = row.tracking[key];
            const required = plan.required.includes(key);
            return (
              <button
                key={key}
                type="button"
                className={`ads-track-item is-${state} ${required ? "is-required" : ""}`}
                aria-pressed={state === "yes"}
                aria-label={`${trackingItemLabel(key)}: ${state === "yes" ? "yes" : state === "no" ? "no" : "not set"}`}
                onClick={() =>
                  onPatch({
                    tracking: { [key]: cycleTracking(state) } as Record<TrackingKey, string>,
                  })
                }
              >
                <span className="ads-track-mark" aria-hidden="true">
                  {state === "yes" ? "✓" : state === "no" ? "×" : "·"}
                </span>
                <span>{trackingItemLabel(key, true)}</span>
              </button>
            );
          })}
        </div>
        <p className="ads-hint">Click to cycle Not set → Yes → No. Required tags are outlined until they are Yes.</p>
      </div>
        </>
      ) : null}
    </div>
  );
}

function ExtraEditor({
  row,
  saving,
  href,
  onPatch,
}: {
  row: AdsClientRow;
  saving: boolean;
  href: string | null;
  onPatch: (body: Record<string, unknown>) => void;
}) {
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

  const plan = trackingPlan(row.channels);
  const extraTrack = plan.recommended.filter((key) => row.tracking[key] === "yes");

  return (
    <div className="ads-editor">
      <div className="ads-editor-head">
        <Link className="ads-client-link" href={`/admin/clients/${row.clientId}`}>
          Open client
        </Link>
        {href ? (
          <a className="ads-client-link" href={href} target="_blank" rel="noreferrer">
            Open landing page
          </a>
        ) : null}
        <span className="muted">{saving ? "Saving…" : row.saved ? "Saved snapshot" : "Not saved yet"}</span>
        {!canMarkReviewedOnRow(row.gaps) ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onPatch({ markReviewed: true })}>
            Mark reviewed
          </button>
        ) : null}
      </div>

      <div className="ads-editor-grid">
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
        <label className="field">
          Lead magnet notes
          <input
            value={magnetNotes}
            onChange={(e) => setMagnetNotes(e.target.value)}
            onBlur={() => {
              if (magnetNotes.trim() === row.leadMagnetNotes) return;
              onPatch({ leadMagnetNotes: magnetNotes });
            }}
          />
        </label>
        <label className="field">
          Nurture notes
          <input
            value={nurtureNotes}
            onChange={(e) => setNurtureNotes(e.target.value)}
            onBlur={() => {
              if (nurtureNotes.trim() === row.nurtureNotes) return;
              onPatch({ nurtureNotes: nurtureNotes });
            }}
          />
        </label>
      </div>

      {extraTrack.length ? (
        <div className="field">
          <label>Recommended tracking (on)</label>
          <div className="ads-quick-track">
            {extraTrack.map((key) => (
              <button
                key={key}
                type="button"
                className={`ads-track-item is-${row.tracking[key]}`}
                onClick={() =>
                  onPatch({
                    tracking: { [key]: cycleTracking(row.tracking[key]) } as Record<TrackingKey, string>,
                  })
                }
              >
                <span className="ads-track-mark" aria-hidden="true">
                  ✓
                </span>
                <span>{trackingItemLabel(key, true)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <label className="field">
        Notes
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes.trim() === row.notes) return;
            onPatch({ notes });
          }}
          rows={2}
        />
      </label>
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
  id,
  value,
  onCommit,
}: {
  id?: string;
  value: string;
  onCommit: (next: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => {
    setText(value);
  }, [value]);
  return (
    <input
      id={id}
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
