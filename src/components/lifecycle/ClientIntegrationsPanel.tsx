"use client";

import { useCallback, useEffect, useState } from "react";
import type { ClientIntegration, IntegrationProvider } from "@/lib/client-integrations";

type ProviderMeta = {
  id: IntegrationProvider;
  label: string;
  tracks: string;
  credentialLabel: string;
  credentialHint: string;
  integration: ClientIntegration | null;
};

type IntegrationsPayload = {
  clientId: string;
  clientName: string;
  providers: ProviderMeta[];
};

export function ClientIntegrationsPanel({
  clientId,
  onChange,
}: {
  clientId: string;
  /** Fired after load/link/unlink with whether any CRM is linked. */
  onChange?: (linked: boolean) => void;
}) {
  const [providers, setProviders] = useState<ProviderMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<IntegrationProvider | null>(null);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Partial<Record<IntegrationProvider, string>>>({});
  const [openForm, setOpenForm] = useState<IntegrationProvider | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/lifecycle/hub/${clientId}/integrations`);
      const body = (await res.json().catch(() => ({}))) as
        | IntegrationsPayload
        | { error?: string };
      if (!res.ok || !("providers" in body)) {
        setError(
          "error" in body && typeof body.error === "string"
            ? body.error
            : "Could not load CRM connections."
        );
        setProviders([]);
        onChange?.(false);
        return;
      }
      setProviders(body.providers);
      onChange?.(body.providers.some((p) => Boolean(p.integration?.linked)));
    } catch {
      setError("Could not load CRM connections.");
      setProviders([]);
      onChange?.(false);
    } finally {
      setLoading(false);
    }
  }, [clientId, onChange]);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect(provider: IntegrationProvider) {
    const credential = (drafts[provider] || "").trim();
    if (!credential) {
      setError("Paste an API credential first.");
      return;
    }
    setBusy(provider);
    setError("");
    try {
      const res = await fetch(`/api/lifecycle/hub/${clientId}/integrations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, credential }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error || "Could not connect.");
        return;
      }
      setDrafts((prev) => ({ ...prev, [provider]: "" }));
      setOpenForm(null);
      await load();
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(provider: IntegrationProvider) {
    setBusy(provider);
    setError("");
    try {
      const res = await fetch(
        `/api/lifecycle/hub/${clientId}/integrations?provider=${provider}`,
        { method: "DELETE" }
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error || "Could not disconnect.");
        return;
      }
      await load();
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="lh-card lh-integrations">
      <div className="lh-card-head">
        <h3>CRM connections</h3>
      </div>
      <p className="lh-card-note">
        Optional. Use when this client tracks jobs or leads outside GoHighLevel —
        Housecall Pro for home service, HubSpot for forms and deals.
      </p>

      {error ? <p className="lh-error">{error}</p> : null}

      {loading ? (
        <p className="lh-card-note">Loading connections…</p>
      ) : (
        <ul className="lh-integrations-list">
          {providers.map((p) => {
            const linked = Boolean(p.integration?.linked);
            const showingForm = openForm === p.id || (!linked && openForm === p.id);
            return (
              <li key={p.id} className="lh-integration-row">
                <div className="lh-integration-main">
                  <div className="lh-integration-title">
                    <strong>{p.label}</strong>
                    <span className="lh-integration-tracks">{p.tracks}</span>
                  </div>
                  {linked ? (
                    <p className="lh-integration-status">
                      Linked
                      {p.integration?.label ? ` · ${p.integration.label}` : ""}
                      {p.integration?.credentialHint
                        ? ` · ${p.integration.credentialHint}`
                        : ""}
                    </p>
                  ) : p.integration?.status === "error" && p.integration.last_error ? (
                    <p className="lh-integration-status is-error">
                      {p.integration.last_error}
                    </p>
                  ) : (
                    <p className="lh-integration-status">Not connected</p>
                  )}
                </div>

                <div className="lh-integration-actions">
                  {linked ? (
                    <button
                      type="button"
                      className="lh-link"
                      disabled={busy === p.id}
                      onClick={() => void disconnect(p.id)}
                    >
                      {busy === p.id ? "Removing…" : "Disconnect"}
                    </button>
                  ) : showingForm ? null : (
                    <button
                      type="button"
                      className="lh-link"
                      onClick={() => {
                        setOpenForm(p.id);
                        setError("");
                      }}
                    >
                      Connect
                    </button>
                  )}
                </div>

                {!linked && openForm === p.id ? (
                  <div className="lh-integration-form">
                    <label className="lh-field">
                      <span>{p.credentialLabel}</span>
                      <input
                        type="password"
                        autoComplete="off"
                        value={drafts[p.id] || ""}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))
                        }
                        placeholder={p.credentialLabel}
                        aria-label={`${p.label} ${p.credentialLabel}`}
                      />
                    </label>
                    <p className="lh-card-note">{p.credentialHint}</p>
                    <div className="lh-integration-form-actions">
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busy === p.id}
                        onClick={() => void connect(p.id)}
                      >
                        {busy === p.id ? "Verifying…" : "Save & verify"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy === p.id}
                        onClick={() => {
                          setOpenForm(null);
                          setDrafts((prev) => ({ ...prev, [p.id]: "" }));
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
