"use client";

import { useState } from "react";
import { PLATFORM_LABELS, type Automation, type ClientRef } from "./types";

const PLATFORMS = ["ghl", "klaviyo", "skylead", "appfront", "boulevard", "other"];
const STATUSES = ["live", "paused", "draft"];

const EMPTY = {
  name: "",
  clientId: "",
  platform: "ghl",
  kind: "",
  status: "live",
  accountRef: "",
  description: "",
  link: "",
};

export function AutomationsPanel({
  automations,
  clients,
  onChanged,
}: {
  automations: Automation[];
  clients: ClientRef[];
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState({ ...EMPTY });
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [platformFilter, setPlatformFilter] = useState("");

  const clientName = (id: string | null) =>
    id ? (clients.find((c) => c.id === id)?.name ?? "Unknown client") : "No client";

  async function save() {
    if (!draft.name.trim()) {
      setError("Give the automation a name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/lifecycle/automations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, clientId: draft.clientId || null }),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error || "Could not save that.");
        return;
      }
      setDraft({ ...EMPTY });
      setAdding(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/lifecycle/automations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    onChanged();
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete the automation "${name}"? This cannot be undone.`)) return;
    await fetch(`/api/lifecycle/automations/${id}`, { method: "DELETE" });
    onChanged();
  }

  const shown = platformFilter
    ? automations.filter((a) => a.platform === platformFilter)
    : automations;

  return (
    <div className="hud-stack">
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}>
          <option value="">All platforms</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
          ))}
        </select>
        <button className="hud-btn" style={{ marginLeft: "auto" }} onClick={() => setAdding((v) => !v)}>
          {adding ? "Cancel" : "Add automation"}
        </button>
      </div>

      {adding ? (
        <div className="hud-panel" style={{ display: "grid", gap: 12 }}>
          <div className="hud-camp-edit" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
            <label className="hud-field">
              <span>Name</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Post-service review request"
              />
            </label>
            <label className="hud-field">
              <span>Client</span>
              <select value={draft.clientId} onChange={(e) => setDraft({ ...draft, clientId: e.target.value })}>
                <option value="">No client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="hud-field">
              <span>Platform</span>
              <select value={draft.platform} onChange={(e) => setDraft({ ...draft, platform: e.target.value })}>
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
                ))}
              </select>
            </label>
            <label className="hud-field">
              <span>Status</span>
              <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="hud-field">
              <span>Type</span>
              <input
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
                placeholder="Welcome, reactivation, abandoned cart…"
              />
            </label>
            <label className="hud-field">
              <span>Account / location ref</span>
              <input
                value={draft.accountRef}
                onChange={(e) => setDraft({ ...draft, accountRef: e.target.value })}
                placeholder="GHL location ID, Klaviyo account…"
              />
            </label>
          </div>
          <label className="hud-field">
            <span>Link</span>
            <input
              value={draft.link}
              onChange={(e) => setDraft({ ...draft, link: e.target.value })}
              placeholder="https://app.gohighlevel.com/…"
            />
          </label>
          <label className="hud-field">
            <span>What it does</span>
            <textarea
              rows={2}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </label>
          {error ? <p className="hud-err">{error}</p> : null}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="hud-btn hud-btn-quiet" onClick={() => { setAdding(false); setError(""); }}>Cancel</button>
            <button className="hud-btn" disabled={busy} onClick={save}>Save</button>
          </div>
        </div>
      ) : null}

      {shown.length === 0 ? (
        <p className="hud-empty">
          Nothing logged yet. Add the automations you run in GHL, Klaviyo and elsewhere so you can
          see them all in one place.
        </p>
      ) : (
        <div className="hud-stack" style={{ gap: 10 }}>
          {shown.map((a) => (
            <div key={a.id} className={`hud-camp ${a.status === "live" ? "sev-ok" : "sev-off"}`}>
              <div className="hud-camp-top">
                <div>
                  <div className="hud-q-name">
                    {a.link ? (
                      <a href={a.link} target="_blank" rel="noreferrer">{a.name}</a>
                    ) : (
                      a.name
                    )}
                  </div>
                  <div className="hud-camp-sub">
                    {PLATFORM_LABELS[a.platform] ?? a.platform} · {clientName(a.client_id)}
                    {a.kind ? ` · ${a.kind}` : ""}
                    {a.account_ref ? ` · ${a.account_ref}` : ""}
                  </div>
                  {a.description ? <p className="hud-note-body">{a.description}</p> : null}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                  <select value={a.status} onChange={(e) => patch(a.id, { status: e.target.value })}>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <button className="hud-btn hud-btn-quiet" onClick={() => remove(a.id, a.name)}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
