"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  adsBoardLane,
  adsDashboardCounts,
  adsPassSummary,
  adsStatusLabel,
  canMarkReviewedOnRow,
  formatSpend,
  landingHost,
  reviewSignal,
  reviewSignalLabel,
  sortAdsRows,
  type AdsBoardLane,
  type AdsClientRow,
  type AdsDashboard,
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
                    saving={savingId === row.clientId}
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
  saving,
  onPatch,
}: {
  row: AdsClientRow;
  lane: AdsBoardLane;
  saving: boolean;
  onPatch: (body: Record<string, unknown>) => void;
}) {
  const host = landingHost(row.landingPageUrl);
  const signal = reviewSignal(row.lastReviewedAt);
  const checkIn = canMarkReviewedOnRow(row.gaps);
  const shownGaps = row.gaps.slice(0, 4);
  const extra = row.gaps.length - shownGaps.length;

  return (
    <article className={`ads-pass-row is-${lane} ${saving ? "is-saving" : ""}`}>
      <Link href={`/admin/ads/${row.clientId}`} className="ads-pass-card">
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
          <span className={`ads-review is-${signal.kind}`}>{reviewSignalLabel(signal)}</span>
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
      </Link>
      <div className="ads-pass-actions ads-pass-card-actions">
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
        <Link href={`/admin/ads/${row.clientId}`} className="btn btn-ghost btn-sm">
          Open
        </Link>
      </div>
    </article>
  );
}
