"use client";

import { useMemo, useState } from "react";
import { SequenceView } from "./SequenceView";
import type { ClientRef, LinkedInCampaignRow, LinkedInSection } from "./types";

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function statusChip(row: LinkedInCampaignRow) {
  if (row.verdict.muted) return <span className="hud-chip hud-chip-idle">Muted</span>;
  switch (row.verdict.severity) {
    case "off":
      return <span className="hud-chip hud-chip-idle">Off</span>;
    case "blocked":
      return <span className="hud-chip hud-chip-crit">Seat down</span>;
    case "refresh":
      return <span className="hud-chip hud-chip-crit">Needs work</span>;
    case "watch":
      return <span className="hud-chip hud-chip-warn">Watch</span>;
    default:
      return <span className="hud-chip hud-chip-ok">Nominal</span>;
  }
}

function CampaignCard({
  row,
  clients,
  onChanged,
}: {
  row: LinkedInCampaignRow;
  clients: ClientRef[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clientFilter, setClientFilter] = useState("");

  const clientOptions = useMemo(() => {
    const q = clientFilter.trim().toLowerCase();
    const list = q
      ? clients.filter((c) => c.name.toLowerCase().includes(q))
      : clients;
    // Keep the current assignment visible even if the filter would hide it.
    if (row.clientId && !list.some((c) => c.id === row.clientId)) {
      const current = clients.find((c) => c.id === row.clientId);
      if (current) return [current, ...list];
    }
    return list;
  }, [clientFilter, clients, row.clientId]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/lifecycle/campaigns/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          typeof data.error === "string" ? data.error : "Could not save that."
        );
        return;
      }
      onChanged();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`hud-camp sev-${row.verdict.severity}`}>
      <div className="hud-camp-top">
        <div>
          <button className="hud-camp-name" onClick={() => setOpen((v) => !v)}>
            {open ? "\u2212 " : "+ "}{row.name}
          </button>
          <div className="hud-camp-sub">
            {row.seatName}
            {row.clientName ? ` · ${row.clientName}` : " · unassigned"}
          </div>
        </div>
        {statusChip(row)}
      </div>

      <div className="hud-stats">
        <div><b>{row.acceptanceRate ? pct(row.acceptanceRate) : "—"}</b><span>Accepted</span></div>
        <div><b>{row.responseRate ? pct(row.responseRate) : "—"}</b><span>Replied</span></div>
        <div><b>{row.connectionsRequested.toLocaleString()}</b><span>Requests</span></div>
        <div><b>{row.replies.toLocaleString()}</b><span>Replies</span></div>
        <div><b>{row.remainingLeads.toLocaleString()}</b><span>Leads left</span></div>
      </div>

      {row.verdict.reasons.length > 0 ? (
        <ul className="hud-faults">
          {row.verdict.reasons.map((r) => (
            <li key={r.code} className={`hud-fault ${r.severity}`}>
              <b>{r.label}.</b> {r.detail}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="hud-camp-assign">
        <label className="hud-field">
          <span>Business</span>
          <input
            type="search"
            value={clientFilter}
            disabled={busy}
            placeholder="Filter businesses…"
            onChange={(e) => setClientFilter(e.target.value)}
            aria-label="Filter businesses"
          />
        </label>
        <label className="hud-field">
          <span>Assign to</span>
          <select
            value={row.clientId ?? ""}
            disabled={busy}
            onChange={(e) => void patch({ clientId: e.target.value || null })}
          >
            <option value="">Unassigned</option>
            {clientOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? <p className="hud-err">{error}</p> : null}

      {open ? <SequenceView campaignId={row.id} /> : null}

      {open ? (
        <div className="hud-camp-edit">
          <label className="hud-field">
            <span>Refresh interval (days)</span>
            <input
              type="number"
              min={1}
              max={3650}
              placeholder="Global default"
              disabled={busy}
              onBlur={(e) => {
                const raw = e.target.value.trim();
                void patch({ refreshIntervalDays: raw === "" ? null : Number(raw) });
              }}
            />
          </label>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="hud-btn"
              disabled={busy}
              onClick={() => void patch({ markRefreshed: true })}
            >
              Mark refreshed
            </button>
            <button
              className="hud-btn hud-btn-quiet"
              disabled={busy}
              onClick={() => void patch({ muted: !row.verdict.muted })}
            >
              {row.verdict.muted ? "Unmute" : "Mute"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function LinkedInPanel({
  data,
  clients,
  onChanged,
}: {
  data: LinkedInSection;
  clients: ClientRef[];
  onChanged: () => void;
}) {
  // Switched-off campaigns are hidden by default. Most of the account is off at
  // any time, and showing them buries the live ones.
  const [showOff, setShowOff] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(false);

  if (!data.configured) {
    return (
      <div className="hud-panel">
        <div className="hud-panel-head">
          <h2 className="hud-panel-title">Skylead offline</h2>
        </div>
        <p className="hud-empty">
          Set SKYLEAD_API_KEY in your environment and in Railway, then resync. Keys are issued at
          app.multilead.co/settings/api.
        </p>
      </div>
    );
  }

  if (data.error) {
    return (
      <div className="hud-alert">
        <h3>Link failed</h3>
        <p className="hud-err">{data.error}</p>
      </div>
    );
  }

  const broken = data.seats.filter((s) => !s.connected);

  return (
    <div className="hud-stack">
      {broken.length > 0 ? (
        <div className="hud-alert hud-in hud-in-1">
          <h3>
            {broken.length} of {data.seats.length} seats are not sending
          </h3>
          <p className="hud-err" style={{ color: "var(--ghost)", marginBottom: 10 }}>
            Their campaigns still read as active. Nothing goes out until the seat is fixed.
          </p>
          {broken.map(({ seat, campaigns }) => (
            <div key={seat.id} className="hud-row">
              <span>{seat.fullName}</span>
              <span className="hud-row-meta">
                {seat.statusLabel}
                {campaigns.length > 0 ? ` · ${campaigns.length} stranded` : ""}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
        <label className="hud-check">
          <input
            type="checkbox"
            checked={onlyProblems}
            onChange={(e) => setOnlyProblems(e.target.checked)}
          />
          Only what needs work
        </label>
        <label className="hud-check">
          <input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} />
          Include switched-off
        </label>
      </div>

      {data.seats.length === 0 ? <p className="hud-empty">No seats on this Skylead account.</p> : null}

      {data.seats.map(({ seat, connected, error, liveCampaigns, campaigns }) => {
        const visible = showOff ? campaigns : campaigns.filter((c) => c.verdict.severity !== "off");
        const shown = onlyProblems
          ? visible.filter((c) => c.verdict.severity === "refresh" || c.verdict.severity === "watch")
          : visible;
        const offCount = campaigns.filter((c) => c.verdict.severity === "off").length;

        return (
          <div key={seat.id} className="hud-panel">
            <div className="hud-panel-head">
              <div>
                <h2 className="hud-panel-title">{seat.fullName}</h2>
                <div className="hud-camp-sub">
                  {liveCampaigns} live of {campaigns.length}
                  {offCount > 0 && !showOff ? ` · ${offCount} off, hidden` : ""}
                </div>
              </div>
              <span className={`hud-chip ${connected ? "hud-chip-ok" : "hud-chip-crit"}`}>
                {connected ? "Sending" : seat.statusLabel || "Not sending"}
              </span>
            </div>

            {error ? <p className="hud-err">{error}</p> : null}

            {shown.length === 0 ? (
              <p className="hud-empty">
                {onlyProblems
                  ? "Nothing needs work on this seat."
                  : campaigns.length > 0
                    ? "Every campaign on this seat is switched off."
                    : "No campaigns on this seat."}
              </p>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {shown.map((row) => (
                  <CampaignCard key={row.id} row={row} clients={clients} onChanged={onChanged} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
