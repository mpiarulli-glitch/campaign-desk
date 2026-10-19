"use client";

import { useEffect, useState } from "react";
import type { CatalogMetric, KlaviyoRevenueAccount, MetricChoice, MetricDetection } from "@/lib/klaviyo-revenue/types";

type ListedAccount = KlaviyoRevenueAccount & { suggestions?: MetricDetection };

type MetricField = "bookingMetricId" | "formMetricId" | "conversionMetricId" | "smsMetricId";

const FIELDS: Array<{ key: MetricField; nameKey: keyof KlaviyoRevenueAccount; label: string; hint: string }> = [
  {
    key: "bookingMetricId",
    nameKey: "bookingMetricName",
    label: "Booked appointment",
    hint: "The event that means someone booked. Leave untracked if this account has no appointment metric.",
  },
  {
    key: "formMetricId",
    nameKey: "formMetricName",
    label: "Form fill",
    hint: "One metric only. Submitted Form and Form submitted by profile usually count the same people twice.",
  },
  {
    key: "conversionMetricId",
    nameKey: "conversionMetricName",
    label: "Email conversion",
    hint: "What email revenue is measured against. Placed Order when the account sells. Otherwise the booking metric.",
  },
  {
    key: "smsMetricId",
    nameKey: "smsMetricName",
    label: "Text received",
    hint: "Received SMS or Received Text Message. Sent Text Message is the send, not proof they got the recovery text.",
  },
];

export function AccountsDialog({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const [accounts, setAccounts] = useState<ListedAccount[]>([]);
  const [metrics, setMetrics] = useState<Record<string, CatalogMetric[]>>({});
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function reload() {
    const res = await fetch("/api/klaviyo-revenue/accounts");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error || "Could not load accounts.");
      return;
    }
    setAccounts(body.accounts || []);
  }

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function loadMetrics(id: string, refresh = false) {
    const res = await fetch(`/api/klaviyo-revenue/accounts/${id}/metrics${refresh ? "?refresh=1" : ""}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error || "Could not load metrics.");
      return;
    }
    setMetrics((current) => ({ ...current, [id]: body.metrics || [] }));
    if (body.suggestions) {
      setAccounts((current) =>
        current.map((account) => (account.id === id ? { ...account, suggestions: body.suggestions } : account))
      );
    }
  }

  async function addAccount(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/klaviyo-revenue/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, apiKey }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "Could not connect that account.");
        return;
      }
      setName("");
      setApiKey("");
      await reload();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function saveMetric(account: ListedAccount, key: MetricField, value: string) {
    setError("");
    const res = await fetch(`/api/klaviyo-revenue/accounts/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error || "Could not save that metric.");
      return;
    }
    setAccounts((current) => current.map((row) => (row.id === account.id ? { ...row, ...body.account } : row)));
    onChanged();
  }

  async function rename(account: ListedAccount, next: string) {
    if (!next.trim() || next.trim() === account.name) return;
    const res = await fetch(`/api/klaviyo-revenue/accounts/${account.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: next }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error || "Could not rename that account.");
      return;
    }
    setAccounts((current) => current.map((row) => (row.id === account.id ? { ...row, ...body.account } : row)));
    onChanged();
  }

  async function remove(id: string) {
    setError("");
    const res = await fetch(`/api/klaviyo-revenue/accounts/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || "Could not remove that account.");
      return;
    }
    setConfirmId(null);
    await reload();
    onChanged();
  }

  return (
    <div className="kr-drawer-back" onMouseDown={onClose}>
      <aside
        className="kr-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kr-accounts-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="kr-inline" style={{ justifyContent: "space-between" }}>
          <h2 id="kr-accounts-title">Klaviyo accounts</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <p>
          Paste a private API key from Klaviyo → Settings → API keys. It is encrypted before it is stored, and it never
          comes back to the browser. A full-access key works. A scoped key needs read access to accounts, metrics,
          events, campaigns, and flows.
        </p>
        <form onSubmit={addAccount}>
          <label className="kr-field">
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Optional. We'll use the Klaviyo account name." />
          </label>
          <label className="kr-field">
            Private API key
            <input
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="pk_…"
              autoComplete="off"
              spellCheck={false}
              type="password"
              required
            />
          </label>
          <div className="kr-inline" style={{ marginTop: 12 }}>
            <button className="btn" type="submit" disabled={busy}>
              {busy ? "Checking key…" : "Add account"}
            </button>
          </div>
        </form>
        {error ? <p className="kr-error">{error}</p> : null}
        {accounts.map((account) => (
          <section key={account.id} className="kr-account">
            <h3>{account.name}</h3>
            <p className="kr-meta">
              {account.keyHint} · {account.timezone} · {account.currency}
            </p>
            <label className="kr-field">
              Display name
              <input
                defaultValue={account.name}
                onBlur={(event) => void rename(account, event.target.value)}
              />
            </label>
            {FIELDS.map((field) => {
              const current = String(account[field.key] ?? "");
              const currentName = String(account[field.nameKey] ?? "");
              const options = metrics[account.id] ?? [];
              const suggestion = suggestionFor(account.suggestions, field.key);
              return (
                <label key={field.key} className="kr-field">
                  {field.label}
                  <select
                    value={current}
                    onFocus={() => {
                      if (!metrics[account.id]) void loadMetrics(account.id);
                    }}
                    onChange={(event) => void saveMetric(account, field.key, event.target.value)}
                  >
                    <option value="">Not tracked</option>
                    {current && !options.some((metric) => metric.id === current) ? (
                      <option value={current}>{currentName || current}</option>
                    ) : null}
                    {options.map((metric) => (
                      <option key={metric.id} value={metric.id}>
                        {metric.name}
                      </option>
                    ))}
                  </select>
                  <span className="kr-suggest">{field.hint}</span>
                  {suggestion && suggestion.id !== current ? (
                    <span className="kr-suggest">
                      Detected {suggestion.name}.{" "}
                      <button type="button" className="kr-text-btn" onClick={() => void saveMetric(account, field.key, suggestion.id)}>
                        Use it
                      </button>
                    </span>
                  ) : null}
                </label>
              );
            })}
            <div className="kr-inline" style={{ marginTop: 12 }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadMetrics(account.id, true)}>
                Reload metrics
              </button>
              {confirmId === account.id ? (
                <button type="button" className="btn btn-danger btn-sm" onClick={() => void remove(account.id)}>
                  Confirm remove
                </button>
              ) : (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmId(account.id)}>
                  Remove
                </button>
              )}
            </div>
          </section>
        ))}
        {!accounts.length ? <p>No accounts yet.</p> : null}
      </aside>
    </div>
  );
}

function suggestionFor(detection: MetricDetection | undefined, key: MetricField): MetricChoice | null {
  if (!detection) return null;
  if (key === "bookingMetricId") return detection.booking ?? detection.bookingSuggestions[0] ?? null;
  if (key === "formMetricId") return detection.form ?? detection.formSuggestions[0] ?? null;
  if (key === "conversionMetricId") return detection.conversion;
  return detection.sms ?? detection.smsSuggestions[0] ?? null;
}
