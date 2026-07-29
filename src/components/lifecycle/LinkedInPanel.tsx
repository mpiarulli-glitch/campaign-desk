"use client";

import { useState } from "react";
import type { ClientRef, LinkedInCampaignRow, LinkedInSection } from "./types";

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function severityChip(row: LinkedInCampaignRow) {
  if (row.verdict.muted) return <span className="lc-chip lc-chip-muted">Muted</span>;
  switch (row.verdict.severity) {
    case "off":
      return <span className="lc-chip lc-chip-muted">Off</span>;
    case "blocked":
      return <span className="lc-chip lc-chip-bad">Seat blocked</span>;
    case "refresh":
      return <span className="lc-chip lc-chip-bad">Needs refresh</span>;
    case "watch":
      return <span className="lc-chip lc-chip-warn">Watch</span>;
    default:
      return <span className="lc-chip lc-chip-ok">Healthy</span>;
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

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetch(`/api/lifecycle/campaigns/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`lc-camp lc-camp-${row.verdict.severity}`}>
      <div className="lc-camp-top">
        <div className="lc-camp-id">
          <button className="lc-camp-name" onClick={() => setOpen((v) => !v)}>
            {row.name}
          </button>
          <div className="lc-camp-sub">
            {row.seatName}
            {row.clientName ? ` · ${row.clientName}` : " · unassigned"}
            {row.isActive ? "" : " · paused"}
          </div>
        </div>
        {severityChip(row)}
      </div>

      <div className="lc-stats">
        <div><b>{row.acceptanceRate ? pct(row.acceptanceRate) : "—"}</b><span>accepted</span></div>
        <div><b>{row.responseRate ? pct(row.responseRate) : "—"}</b><span>replied</span></div>
        <div><b>{row.connectionsRequested.toLocaleString()}</b><span>requests</span></div>
        <div><b>{row.replies.toLocaleString()}</b><span>replies</span></div>
        <div><b>{row.remainingLeads.toLocaleString()}</b><span>leads left</span></div>
      </div>

      {row.verdict.reasons.length > 0 ? (
        <ul className="lc-reasons">
          {row.verdict.reasons.map((r) => (
            <li key={r.code} className={`lc-reason lc-reason-${r.severity}`}>
              <b>{r.label}.</b> {r.detail}
            </li>
          ))}
        </ul>
      ) : null}

      {open ? (
        <div className="lc-camp-edit">
          <label className="field">
            <span>Client</span>
            <select
              value={row.clientId ?? ""}
              disabled={busy}
              onChange={(e) => patch({ clientId: e.target.value || null })}
            >
              <option value="">Unassigned</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Refresh every (days)</span>
            <input
              type="number"
              min={1}
              max={3650}
              defaultValue={row.verdict.daysSinceActivity !== null ? undefined : undefined}
              placeholder="Use the global default"
              disabled={busy}
              onBlur={(e) => {
                const raw = e.target.value.trim();
                patch({ refreshIntervalDays: raw === "" ? null : Number(raw) });
              }}
            />
          </label>

          <div className="lc-camp-actions">
            <button className="btn btn-sm" disabled={busy} onClick={() => patch({ markRefreshed: true })}>
              Mark refreshed
            </button>
            <button
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => patch({ muted: !row.verdict.muted })}
            >
              {row.verdict.muted ? "Unmute" : "Mute alerts"}
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
  // Switched-off campaigns are hidden by default. Most of the account is off
  // at any time, and showing them buries the live ones.
  const [showOff, setShowOff] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(false);

  if (!data.configured) {
    return (
      <div className="card card-pad">
        <h3>Skylead is not connected yet</h3>
        <p className="muted">
          Set <code>SKYLEAD_API_KEY</code> in your environment and in Railway, then reload.
          Grab a key at <a href="https://app.multilead.co/settings/api" target="_blank" rel="noreferrer">app.multilead.co/settings/api</a>.
        </p>
      </div>
    );
  }

  if (data.error) {
    return (
      <div className="card card-pad lc-error">
        <h3>Could not reach Skylead</h3>
        <p className="muted">{data.error}</p>
      </div>
    );
  }

  const broken = data.seats.filter((s) => !s.connected);

  return (
    <div className="stack" style={{ gap: 16 }}>
      {broken.length > 0 ? (
        <div className="card card-pad lc-error">
          <h3 style={{ marginTop: 0 }}>
            {broken.length} of {data.seats.length} seats are not sending
          </h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            Campaigns on these seats look active but nothing goes out until the seat is fixed.
          </p>
          <div style={{ marginTop: 8 }}>
            {broken.map(({ seat, campaigns }) => (
              <div key={seat.id} className="lc-line">
                <span>{seat.fullName}</span>
                <span className="muted">
                  {seat.statusLabel}
                  {campaigns.length > 0 ? ` · ${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"} stalled` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label className="lc-toggle">
          <input
            type="checkbox"
            checked={onlyProblems}
            onChange={(e) => setOnlyProblems(e.target.checked)}
          />
          Only show campaigns that need attention
        </label>
        <label className="lc-toggle">
          <input
            type="checkbox"
            checked={showOff}
            onChange={(e) => setShowOff(e.target.checked)}
          />
          Include switched-off campaigns
        </label>
        {data.fetchedAt ? (
          <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>
            Synced {new Date(data.fetchedAt).toLocaleString()}
          </span>
        ) : null}
      </div>

      {data.seats.length === 0 ? (
        <p className="muted">No LinkedIn seats found on this Skylead account.</p>
      ) : null}

      {data.seats.map(({ seat, connected, error, liveCampaigns, campaigns }) => {
        const visible = showOff
          ? campaigns
          : campaigns.filter((c) => c.verdict.severity !== "off");
        const shown = onlyProblems
          ? visible.filter((c) => c.verdict.severity === "refresh" || c.verdict.severity === "watch")
          : visible;
        const offCount = campaigns.length - campaigns.filter((c) => c.verdict.severity !== "off").length;

        return (
          <div key={seat.id} className="ops-panel">
            <div className="lc-seat-head">
              <div>
                <h3 style={{ margin: 0 }}>{seat.fullName}</h3>
                <span className="muted" style={{ fontSize: 12 }}>
                  {liveCampaigns} live of {campaigns.length}
                  {offCount > 0 && !showOff ? ` · ${offCount} off, hidden` : ""}
                </span>
              </div>
              <span className={`lc-chip ${connected ? "lc-chip-ok" : "lc-chip-bad"}`}>
                {connected ? "Sending" : seat.statusLabel || "Not sending"}
              </span>
            </div>

            {error ? <p className="lc-error-line">{error}</p> : null}

            {shown.length === 0 ? (
              <p className="muted" style={{ marginTop: 8 }}>
                {onlyProblems
                  ? "Nothing needs attention on this seat."
                  : campaigns.length > 0
                    ? "Every campaign on this seat is switched off."
                    : "No campaigns on this seat."}
              </p>
            ) : (
              <div className="lc-camp-list">
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
