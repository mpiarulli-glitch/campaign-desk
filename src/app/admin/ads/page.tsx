"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ADS_CHANNELS,
  ADS_STATUSES,
  LEAD_MAGNETS,
  NURTURE_STATUSES,
  TRACKING_ITEMS,
  adsChannelLabel,
  adsStatusLabel,
  cycleTracking,
  formatSpend,
  landingHost,
  landingHref,
  leadMagnetLabel,
  nurtureStatusLabel,
  type AdsChannel,
  type AdsClientRow,
  type AdsDashboard,
  type AdsStatus,
  type LeadMagnet,
  type NurtureStatus,
  type TrackingKey,
} from "@/lib/ads";

type Filter =
  | "all"
  | "active"
  | "paused"
  | "off"
  | "unknown"
  | "attention"
  | "ready";

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

function reviewedLabel(iso: string | null): string {
  if (!iso) return "Never";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "Never";
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function AdsDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<AdsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
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
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (denied) router.push("/login");
  }, [denied, router]);

  const replaceRow = useCallback((row: AdsClientRow) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rows: prev.rows.map((r) => (r.clientId === row.clientId ? row : r)),
        counts: countsFrom(prev.rows.map((r) => (r.clientId === row.clientId ? row : r))),
      };
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
      if (filter === "active" && r.status !== "active") return false;
      if (filter === "paused" && r.status !== "paused") return false;
      if (filter === "off" && r.status !== "off") return false;
      if (filter === "unknown" && r.status !== "unknown") return false;
      if (filter === "attention" && r.gaps.length === 0) return false;
      if (filter === "ready" && !r.ready) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, filter, query]);

  const counts = data?.counts;

  return (
    <div className="ops-page ads-page">
      <div className="ops-page-head">
        <div>
          <p className="ops-eyebrow">Paid media</p>
          <h1 className="ops-title">Ads</h1>
          <p className="ops-sub">
            What’s live, what it spends, where it lands, and whether tracking and nurture are actually on.
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
        <div className="ops-stats ads-stats">
          <StatButton n={counts.active} label="Active" on={filter === "active"} onClick={() => setFilter(filter === "active" ? "all" : "active")} />
          <StatButton n={counts.paused} label="Paused" on={filter === "paused"} onClick={() => setFilter(filter === "paused" ? "all" : "paused")} />
          <StatButton n={counts.off} label="Off" on={filter === "off"} onClick={() => setFilter(filter === "off" ? "all" : "off")} />
          <StatButton n={counts.unknown} label="Not set" on={filter === "unknown"} onClick={() => setFilter(filter === "unknown" ? "all" : "unknown")} />
          <StatButton n={counts.attention} label="Needs attention" on={filter === "attention"} onClick={() => setFilter(filter === "attention" ? "all" : "attention")} />
          <StatButton n={counts.ready} label="Funnel ready" on={filter === "ready"} onClick={() => setFilter(filter === "ready" ? "all" : "ready")} />
        </div>
      ) : null}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : error ? (
        <p className="error">{error}</p>
      ) : visible.length === 0 ? (
        <div className="empty">
          <p>{rows.length === 0 ? "No active clients yet." : "No clients match."}</p>
        </div>
      ) : (
        <div className="card card-pad ads-table-wrap">
          <table className="client-table ads-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Ads</th>
                <th>Spend limit</th>
                <th>Products</th>
                <th>Landing page</th>
                <th>Lead magnet</th>
                <th>Nurture</th>
                <th>Tracking</th>
                <th>Gaps</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const open = openId === row.clientId;
                const href = landingHref(row.landingPageUrl);
                const host = landingHost(row.landingPageUrl);
                return (
                  <RowBlock
                    key={row.clientId}
                    row={row}
                    open={open}
                    saving={savingId === row.clientId}
                    href={href}
                    host={host}
                    onToggle={() => setOpenId(open ? null : row.clientId)}
                    onPatch={(body) => void patch(row.clientId, body)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function countsFrom(rows: AdsClientRow[]): AdsDashboard["counts"] {
  return {
    total: rows.length,
    active: rows.filter((r) => r.status === "active").length,
    paused: rows.filter((r) => r.status === "paused").length,
    off: rows.filter((r) => r.status === "off").length,
    unknown: rows.filter((r) => r.status === "unknown").length,
    attention: rows.filter((r) => r.gaps.length > 0).length,
    ready: rows.filter((r) => r.ready).length,
  };
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

function RowBlock({
  row,
  open,
  saving,
  href,
  host,
  onToggle,
  onPatch,
}: {
  row: AdsClientRow;
  open: boolean;
  saving: boolean;
  href: string | null;
  host: string;
  onToggle: () => void;
  onPatch: (body: Record<string, unknown>) => void;
}) {
  const blocking = row.gaps.filter((g) => g.severity === "block");
  const shownGaps = (blocking.length ? blocking : row.gaps).slice(0, 3);
  const extra = row.gaps.length - shownGaps.length;

  return (
    <>
      <tr className={`ads-row ${open ? "is-open" : ""}`}>
        <td>
          <button type="button" className="ads-client" onClick={onToggle} aria-expanded={open}>
            <ClientMark name={row.name} logoUrl={row.logoUrl} />
            <span>
              <span className="ads-client-name">{row.name}</span>
              {row.accountManager ? <span className="ads-client-meta">{row.accountManager}</span> : null}
            </span>
          </button>
        </td>
        <td>
          <span className={`ads-status is-${row.status}`}>{adsStatusLabel(row.status)}</span>
        </td>
        <td className="ads-num">{formatSpend(row.monthlySpendLimit)}</td>
        <td>
          {row.channels.length ? (
            <span className="ads-chips">
              {row.channels.map((c) => (
                <span key={c} className="ads-chip">
                  {adsChannelLabel(c)}
                </span>
              ))}
            </span>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        <td>
          {href ? (
            <a className="ads-link" href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
              {row.landingPageLabel || host || "Landing page"}
            </a>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        <td>{row.leadMagnet === "unknown" ? <span className="muted">—</span> : leadMagnetLabel(row.leadMagnet)}</td>
        <td>
          {row.nurtureStatus === "unknown" ? (
            <span className="muted">—</span>
          ) : (
            <span>
              {nurtureStatusLabel(row.nurtureStatus)}
              {row.nurtureSource === "detected" ? <span className="ads-detected"> auto</span> : null}
            </span>
          )}
        </td>
        <td>
          <span className={`ads-track ${row.trackingDone === row.trackingTotal && row.trackingTotal > 0 ? "is-done" : ""}`}>
            {row.trackingDone}/{row.trackingTotal}
          </span>
        </td>
        <td>
          {row.ready ? (
            <span className="ads-gap is-ready">Ready</span>
          ) : shownGaps.length ? (
            <span className="ads-gaps">
              {shownGaps.map((g) => (
                <span key={g.key} className={`ads-gap is-${g.severity}`}>
                  {g.label}
                </span>
              ))}
              {extra > 0 ? <span className="ads-gap is-more">+{extra}</span> : null}
            </span>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
      </tr>
      {open ? (
        <tr className="ads-editor-row">
          <td colSpan={9}>
            <Editor row={row} saving={saving} onPatch={onPatch} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Editor({
  row,
  saving,
  onPatch,
}: {
  row: AdsClientRow;
  saving: boolean;
  onPatch: (body: Record<string, unknown>) => void;
}) {
  const [spend, setSpend] = useState(row.monthlySpendLimit == null ? "" : String(row.monthlySpendLimit));
  const [cid, setCid] = useState(row.googleCustomerId);
  const [landing, setLanding] = useState(row.landingPageUrl);
  const [landingLabel, setLandingLabel] = useState(row.landingPageLabel);
  const [magnetNotes, setMagnetNotes] = useState(row.leadMagnetNotes);
  const [nurtureNotes, setNurtureNotes] = useState(row.nurtureNotes);
  const [conversion, setConversion] = useState(row.conversionAction);
  const [offer, setOffer] = useState(row.offer);
  const [notes, setNotes] = useState(row.notes);

  useEffect(() => {
    setSpend(row.monthlySpendLimit == null ? "" : String(row.monthlySpendLimit));
    setCid(row.googleCustomerId);
    setLanding(row.landingPageUrl);
    setLandingLabel(row.landingPageLabel);
    setMagnetNotes(row.leadMagnetNotes);
    setNurtureNotes(row.nurtureNotes);
    setConversion(row.conversionAction);
    setOffer(row.offer);
    setNotes(row.notes);
    // Drafts stay until this client changes — a tracking save must not wipe them.
  }, [row.clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleChannel(channel: AdsChannel) {
    const next = row.channels.includes(channel)
      ? row.channels.filter((c) => c !== channel)
      : [...row.channels, channel];
    onPatch({ channels: next });
  }

  return (
    <div className="ads-editor">
      <div className="ads-editor-head">
        <Link className="ads-client-link" href={`/admin/clients/${row.clientId}`}>
          Open client
        </Link>
        <span className="muted">{saving ? "Saving…" : row.saved ? `Reviewed ${reviewedLabel(row.lastReviewedAt)}` : "Not saved yet"}</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onPatch({ markReviewed: true })}>
          Mark reviewed
        </button>
      </div>

      <div className="ads-editor-grid">
        <div className="field ads-status-field">
          <label>Ads status</label>
          <div className="ads-seg">
            {ADS_STATUSES.map((s) => (
              <button
                key={s.value}
                type="button"
                className={row.status === s.value ? "on" : ""}
                onClick={() => onPatch({ status: s.value as AdsStatus })}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          Monthly spend limit
          <input
            type="number"
            min={0}
            step={50}
            value={spend}
            onChange={(e) => setSpend(e.target.value)}
            onBlur={() => {
              const next = spend.trim() === "" ? null : Number(spend);
              if (next === row.monthlySpendLimit) return;
              if (next != null && !Number.isFinite(next)) return;
              onPatch({ monthlySpendLimit: next });
            }}
            placeholder="e.g. 2500"
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
      </div>

      <div className="field">
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

      <div className="ads-editor-grid">
        <label className="field">
          Landing page URL
          <input
            value={landing}
            onChange={(e) => setLanding(e.target.value)}
            onBlur={() => {
              if (landing.trim() === row.landingPageUrl) return;
              onPatch({ landingPageUrl: landing });
            }}
            placeholder="https://"
          />
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
        <label className="field">
          Lead magnet
          <select
            value={row.leadMagnet}
            onChange={(e) => onPatch({ leadMagnet: e.target.value as LeadMagnet })}
          >
            {LEAD_MAGNETS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Nurture series
          <select
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
      </div>

      <div className="ads-editor-grid">
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

      <div className="field">
        <label>Tracking checklist</label>
        <div className="ads-track-grid">
          {TRACKING_ITEMS.map((item) => {
            const state = row.tracking[item.key];
            return (
              <button
                key={item.key}
                type="button"
                className={`ads-track-item is-${state}`}
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
        <p className="ads-hint">Click to cycle Not set → Yes → No.</p>
      </div>

      <label className="field">
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
    </div>
  );
}
