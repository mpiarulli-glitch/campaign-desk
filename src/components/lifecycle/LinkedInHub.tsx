"use client";

import { useState } from "react";
import { LinkedInPanel } from "./LinkedInPanel";
import { SeatArray } from "./SeatArray";
import type { ClientRef, LifecycleDashboard, LinkedInSection, RefreshSettings } from "./types";

type SubTab = "overview" | "campaigns" | "settings";

const SUB_TABS: Array<{ id: SubTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "campaigns", label: "Campaigns" },
  { id: "settings", label: "Refresh rules" },
];

function SettingsForm({
  settings,
  onChanged,
}: {
  settings: RefreshSettings;
  onChanged: () => void;
}) {
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      await fetch("/api/lifecycle/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setSaved(true);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hud-panel" style={{ display: "grid", gap: 14, maxWidth: 480 }}>
      <div className="hud-panel-head">
        <h2 className="hud-panel-title">When does a campaign need a refresh?</h2>
      </div>
      <p className="hud-camp-sub" style={{ margin: 0 }}>
        These thresholds drive the &ldquo;Needs work&rdquo; and &ldquo;Watch&rdquo; verdicts across every seat.
        Per-campaign overrides (set from a campaign&apos;s own settings) win over the defaults here.
      </p>

      <label className="hud-field">
        <span>Stale after (days without activity)</span>
        <input
          type="number"
          min={1}
          value={form.staleDays}
          onChange={(e) => setForm((f) => ({ ...f, staleDays: Number(e.target.value) }))}
        />
      </label>
      <label className="hud-field">
        <span>Minimum acceptance rate (%)</span>
        <input
          type="number"
          min={0}
          max={100}
          value={form.minAcceptanceRate}
          onChange={(e) => setForm((f) => ({ ...f, minAcceptanceRate: Number(e.target.value) }))}
        />
      </label>
      <label className="hud-field">
        <span>Minimum reply rate (%)</span>
        <input
          type="number"
          min={0}
          max={100}
          value={form.minResponseRate}
          onChange={(e) => setForm((f) => ({ ...f, minResponseRate: Number(e.target.value) }))}
        />
      </label>
      <label className="hud-field">
        <span>Minimum volume before rate floors apply</span>
        <input
          type="number"
          min={0}
          value={form.minVolume}
          onChange={(e) => setForm((f) => ({ ...f, minVolume: Number(e.target.value) }))}
        />
      </label>
      <label className="hud-field">
        <span>Decay drop vs trailing average (%)</span>
        <input
          type="number"
          min={0}
          max={100}
          value={form.decayDropPercent}
          onChange={(e) => setForm((f) => ({ ...f, decayDropPercent: Number(e.target.value) }))}
        />
      </label>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button className="hud-btn" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save rules"}
        </button>
        {saved ? <span className="hud-camp-sub">Saved.</span> : null}
      </div>
    </div>
  );
}

export function LinkedInHub({
  data,
  clients,
  counts,
  refreshSettings,
  onChanged,
}: {
  data: LinkedInSection;
  clients: ClientRef[];
  counts: LifecycleDashboard["counts"];
  refreshSettings: RefreshSettings;
  onChanged: () => void;
}) {
  const [subTab, setSubTab] = useState<SubTab>("overview");

  const seatsTotal = data.seats.length;
  const seatsLive = seatsTotal - data.brokenSeats;
  // Only campaigns that would otherwise be running are "stranded". Counting
  // switched-off ones here would inflate the number and make the alert lie.
  const stranded = data.campaigns.filter((c) => c.verdict.severity === "blocked").length;

  return (
    <div className="hud-stack" style={{ gap: 14 }}>
      <nav className="hud-subtabs">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            className={`hud-subtab ${subTab === t.id ? "on" : ""}`}
            onClick={() => setSubTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {subTab === "overview" ? (
        <div className="hud-stack">
          {seatsTotal > 0 ? (
            <div className="hud-panel hud-array-panel">
              <div className="hud-panel-head">
                <div>
                  <div className="hud-eyebrow">Network integrity</div>
                  <h2 className="hud-panel-title" style={{ marginTop: 6 }}>
                    LinkedIn seat array
                  </h2>
                </div>
                <div className={`hud-integrity ${data.brokenSeats > 0 ? "degraded" : ""}`}>
                  {seatsLive}
                  <small> / {seatsTotal}</small>
                </div>
              </div>

              <SeatArray seats={data.seats} />

              <div className="hud-array-legend">
                <span>
                  <b>{seatsLive}</b> sending
                </span>
                <span className={data.brokenSeats > 0 ? "crit" : ""}>
                  <b>{data.brokenSeats}</b> faulted
                </span>
                {stranded > 0 ? (
                  <span className="crit">
                    <b>{stranded}</b> campaigns stranded on faulted seats
                  </span>
                ) : null}
                {data.hiddenSeats > 0 ? (
                  <span>
                    <b>{data.hiddenSeats}</b> cancelled{" "}
                    {data.hiddenSeats === 1 ? "seat" : "seats"} hidden
                  </span>
                ) : null}
                <span style={{ marginLeft: "auto" }}>bar height = campaign load</span>
              </div>
            </div>
          ) : null}

          <div className="hud-readouts">
            <div className={`hud-readout ${counts.campaignsNeedingRefresh > 0 ? "alert" : ""}`}>
              <b>{String(counts.campaignsNeedingRefresh).padStart(2, "0")}</b>
              <span>Need work</span>
            </div>
            <div className="hud-readout live">
              <b>{String(counts.linkedInLive).padStart(2, "0")}</b>
              <span>Live outreach</span>
            </div>
            <div className={`hud-readout ${data.brokenSeats > 0 ? "alert" : ""}`}>
              <b>{String(data.brokenSeats).padStart(2, "0")}</b>
              <span>Broken seats</span>
            </div>
          </div>

          {data.needsRefresh.length > 0 ? (
            <div className="hud-panel">
              <div className="hud-panel-head">
                <h2 className="hud-panel-title">Priority queue</h2>
                <span className="hud-eyebrow">Worst first</span>
              </div>
              <div className="hud-queue">
                {data.needsRefresh.slice(0, 10).map((row, i) => (
                  <div key={row.id} className="hud-q">
                    <span className="hud-q-rank hud-num">{String(i + 1).padStart(2, "0")}</span>
                    <div>
                      <div className="hud-q-name">{row.name}</div>
                      <div className="hud-q-meta">
                        {row.seatName}
                        {row.clientName ? ` · ${row.clientName}` : ""}
                      </div>
                    </div>
                    <div className="hud-q-faults">
                      {row.verdict.reasons.map((r) => (
                        <span
                          key={r.code}
                          className={`hud-chip hud-chip-${r.severity === "refresh" ? "crit" : "warn"}`}
                        >
                          {r.label}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {data.needsRefresh.length > 10 ? (
                <button
                  className="hud-link"
                  style={{ marginTop: 12 }}
                  onClick={() => setSubTab("campaigns")}
                >
                  Open all {data.needsRefresh.length} in Campaigns
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {subTab === "campaigns" ? (
        <LinkedInPanel data={data} clients={clients} onChanged={onChanged} />
      ) : null}

      {subTab === "settings" ? (
        <SettingsForm settings={refreshSettings} onChanged={onChanged} />
      ) : null}
    </div>
  );
}
