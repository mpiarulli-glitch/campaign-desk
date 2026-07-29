"use client";

import { useState } from "react";
import { PLATFORM_LABELS, type Automation, type ClientRef, type GhlSection } from "./types";

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

/**
 * Workflows read live out of GoHighLevel. Read-only on purpose: GHL owns
 * these, so copying them into our own table would just let the two drift.
 */
function GhlWorkflows({ ghl }: { ghl: GhlSection }) {
  const [showDrafts, setShowDrafts] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);
  const [search, setSearch] = useState("");

  if (!ghl.configured) {
    return (
      <div className="hud-panel">
        <div className="hud-panel-head">
          <h2 className="hud-panel-title">GoHighLevel not connected</h2>
        </div>
        <p className="hud-empty">
          Set GHL_CLIENT_ID, GHL_CLIENT_SECRET, GHL_COMPANY_ID and GHL_REFRESH_TOKEN to read
          workflows across every subaccount.
        </p>
      </div>
    );
  }

  if (ghl.error) {
    return (
      <div className="hud-alert">
        <h3>GoHighLevel link failed</h3>
        <p className="hud-err">{ghl.error}</p>
      </div>
    );
  }

  const t = ghl.totals;
  const query = search.trim().toLowerCase();

  // 150+ accounts is too many to dump at once. Default to the ones with
  // something switched on, and let the filters open it up from there.
  const accounts = ghl.accounts
    .filter((a) => (showEmpty ? true : a.workflows.length > 0))
    .filter((a) => (showDrafts ? true : a.live > 0 || a.workflows.length === 0))
    .filter((a) =>
      query
        ? a.name.toLowerCase().includes(query) ||
          a.workflows.some((w) => w.name.toLowerCase().includes(query))
        : true
    );

  return (
    <div className="hud-stack">
      <div className="hud-readouts">
        <div className="hud-readout live">
          <b>{t.live}</b>
          <span>Live workflows</span>
        </div>
        <div className="hud-readout">
          <b>{t.workflows}</b>
          <span>Total built</span>
        </div>
        <div className="hud-readout">
          <b>{t.accountsWithLive}</b>
          <span>Accounts running</span>
        </div>
        <div className="hud-readout">
          <b>{t.accounts}</b>
          <span>Accounts scanned</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search accounts or workflows…"
          style={{ flex: 1, minWidth: 220 }}
        />
        <label className="hud-check">
          <input
            type="checkbox"
            checked={showDrafts}
            onChange={(e) => setShowDrafts(e.target.checked)}
          />
          Include drafts
        </label>
        <label className="hud-check">
          <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />
          Include accounts with none
        </label>
      </div>

      {ghl.fetchedAt ? (
        <div className="hud-eyebrow">
          Synced {new Date(ghl.fetchedAt).toLocaleString()} · showing {accounts.length} of{" "}
          {t.accounts} accounts
        </div>
      ) : null}

      {accounts.length === 0 ? (
        <p className="hud-empty">Nothing matches those filters.</p>
      ) : (
        accounts.map((a) => {
          const rows = showDrafts ? a.workflows : a.workflows.filter((w) => w.live);
          return (
            <div key={a.locationId} className="hud-panel">
              <div className="hud-panel-head" style={{ marginBottom: 10 }}>
                <div>
                  <h2 className="hud-panel-title">{a.name}</h2>
                  <div className="hud-camp-sub">
                    {a.live} live of {a.workflows.length}
                    {a.clientId ? " · linked client" : " · not mapped in Campaign Desk"}
                  </div>
                </div>
                <span className={`hud-chip ${a.live > 0 ? "hud-chip-ok" : "hud-chip-idle"}`}>
                  {a.live > 0 ? `${a.live} on` : "Nothing on"}
                </span>
              </div>

              {a.error ? <p className="hud-err">{a.error.slice(0, 140)}</p> : null}

              {rows.length === 0 ? (
                <p className="hud-empty">
                  {a.workflows.length > 0
                    ? `${a.workflows.length} built, none published.`
                    : "No workflows built."}
                </p>
              ) : (
                rows.map((w) => (
                  <div key={w.id} className="hud-row">
                    <span>{w.name}</span>
                    <span className="hud-row-meta">
                      <span className={`hud-chip ${w.live ? "hud-chip-ok" : "hud-chip-idle"}`}>
                        {w.status}
                      </span>
                    </span>
                  </div>
                ))
              )}
            </div>
          );
        })
      )}

      {ghl.failures.length > 0 ? (
        <div className="hud-alert">
          <h3>{ghl.failures.length} accounts could not be read</h3>
          {ghl.failures.map((f) => (
            <div key={f.name} className="hud-row">
              <span>{f.name}</span>
              <span className="hud-row-meta">{f.error.slice(0, 90)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AutomationsPanel({
  automations,
  ghl,
  clients,
  onChanged,
}: {
  automations: Automation[];
  ghl: GhlSection;
  clients: ClientRef[];
  onChanged: () => void;
}) {
  const [source, setSource] = useState<"ghl" | "manual">("ghl");
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
      {/* GHL is the source of truth for anything we actually built there. The
          manual register is for platforms with no API into them. */}
      <div className="hud-channels" style={{ marginBottom: 0 }}>
        <button
          className={`hud-channel ${source === "ghl" ? "on" : ""}`}
          onClick={() => setSource("ghl")}
        >
          GoHighLevel
          {ghl.totals.live > 0 ? <span className="hud-channel-count">{ghl.totals.live}</span> : null}
        </button>
        <button
          className={`hud-channel ${source === "manual" ? "on" : ""}`}
          onClick={() => setSource("manual")}
        >
          Logged by hand
          {automations.length > 0 ? (
            <span className="hud-channel-count">{automations.length}</span>
          ) : null}
        </button>
      </div>

      {source === "ghl" ? <GhlWorkflows ghl={ghl} /> : null}

      {source === "manual" ? (
        <>
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
        </>
      ) : null}
    </div>
  );
}
