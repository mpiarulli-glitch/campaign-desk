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
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}>
          <option value="">All platforms</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
          ))}
        </select>
        <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => setAdding((v) => !v)}>
          {adding ? "Cancel" : "Add automation"}
        </button>
      </div>

      {adding ? (
        <div className="card card-pad stack" style={{ gap: 10 }}>
          <div className="lc-form-grid">
            <label className="field">
              <span>Name</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Post-service review request"
              />
            </label>
            <label className="field">
              <span>Client</span>
              <select value={draft.clientId} onChange={(e) => setDraft({ ...draft, clientId: e.target.value })}>
                <option value="">No client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Platform</span>
              <select value={draft.platform} onChange={(e) => setDraft({ ...draft, platform: e.target.value })}>
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Status</span>
              <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Type</span>
              <input
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
                placeholder="Welcome, reactivation, abandoned cart…"
              />
            </label>
            <label className="field">
              <span>Account / location ref</span>
              <input
                value={draft.accountRef}
                onChange={(e) => setDraft({ ...draft, accountRef: e.target.value })}
                placeholder="GHL location ID, Klaviyo account…"
              />
            </label>
          </div>
          <label className="field">
            <span>Link</span>
            <input
              value={draft.link}
              onChange={(e) => setDraft({ ...draft, link: e.target.value })}
              placeholder="https://app.gohighlevel.com/…"
            />
          </label>
          <label className="field">
            <span>What it does</span>
            <textarea
              rows={2}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </label>
          {error ? <p className="lc-error-line">{error}</p> : null}
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { setAdding(false); setError(""); }}>Cancel</button>
            <button className="btn btn-sm" disabled={busy} onClick={save}>Save</button>
          </div>
        </div>
      ) : null}

      {shown.length === 0 ? (
        <p className="muted">
          Nothing logged yet. Add the automations you run in GHL, Klaviyo and elsewhere so you can
          see them all in one place.
        </p>
      ) : (
        <div className="lc-auto-list">
          {shown.map((a) => (
            <div key={a.id} className="lc-auto">
              <div className="lc-auto-main">
                <div className="lc-auto-title">
                  {a.link ? (
                    <a href={a.link} target="_blank" rel="noreferrer">{a.name}</a>
                  ) : (
                    a.name
                  )}
                </div>
                <div className="lc-auto-sub">
                  {PLATFORM_LABELS[a.platform] ?? a.platform} · {clientName(a.client_id)}
                  {a.kind ? ` · ${a.kind}` : ""}
                  {a.account_ref ? ` · ${a.account_ref}` : ""}
                </div>
                {a.description ? <p className="lc-auto-desc">{a.description}</p> : null}
              </div>
              <div className="lc-auto-side">
                <select value={a.status} onChange={(e) => patch(a.id, { status: e.target.value })}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <button className="btn btn-ghost btn-sm" onClick={() => remove(a.id, a.name)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
