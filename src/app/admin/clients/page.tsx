"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Sentiment = "healthy" | "watch" | "at_risk" | "unknown";

type Client = {
  id: string;
  name: string;
  account_manager: string;
  tier: string;
  active: number;
  website: string;
  logo_url: string | null;
  sentiment: Sentiment;
  sentiment_auto: Sentiment;
  sentiment_override: string;
};

const TIER_OPTIONS = [
  { value: "", label: "No tier" },
  { value: "tier1", label: "Tier 1" },
  { value: "tier2", label: "Tier 2" },
  { value: "tier3", label: "Tier 3" },
];

const SENTIMENT_LABEL: Record<Sentiment, string> = {
  healthy: "Healthy",
  watch: "Watch",
  at_risk: "At risk",
  unknown: "No data",
};

// Deterministic accent for the initials fallback so a client keeps the same
// color across reloads (no logo needed).
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

function ClientAvatar({ client }: { client: Client }) {
  const [failed, setFailed] = useState(false);
  const showImage = client.logo_url && !failed;
  const color = useMemo(() => {
    let sum = 0;
    for (let i = 0; i < client.name.length; i++) sum += client.name.charCodeAt(i);
    return AVATAR_COLORS[sum % AVATAR_COLORS.length];
  }, [client.name]);

  if (showImage) {
    return (
      <span className="client-avatar">
        <img
          src={client.logo_url as string}
          alt=""
          width={22}
          height={22}
          onError={() => setFailed(true)}
        />
      </span>
    );
  }
  return (
    <span
      className="client-avatar is-initials"
      style={{ background: color }}
      aria-hidden="true"
    >
      {initials(client.name)}
    </span>
  );
}

export default function AllClientsPage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flags, setFlags] = useState<Record<string, { status: string; counts: { red: number; yellow: number; green: number } }>>({});

  async function load() {
    setLoading(true);
    const res = await fetch("/api/revenue/clients");
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) {
      setError("Failed to load.");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setClients(data.clients || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    fetch("/api/flags")
      .then((r) => (r.ok ? r.json() : { summary: {} }))
      .then((d) => setFlags(d.summary || {}));
  }, []);

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/revenue/clients/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function changeTier(id: string, tier: string) {
    setClients((cs) => cs.map((c) => (c.id === id ? { ...c, tier } : c)));
    patch(id, { tier });
  }

  function changeSentiment(id: string, sentimentOverride: string) {
    setClients((cs) =>
      cs.map((c) =>
        c.id === id
          ? {
              ...c,
              sentiment_override: sentimentOverride,
              sentiment: (sentimentOverride || c.sentiment_auto) as Sentiment,
            }
          : c
      )
    );
    patch(id, { sentimentOverride });
  }

  function editWebsite(c: Client) {
    const next = window.prompt(
      `Website for ${c.name} (used to pull the logo)`,
      c.website || ""
    );
    if (next === null || next.trim() === c.website) return;
    const website = next.trim();
    // Force the avatar to re-fetch by clearing then reloading from the server.
    setClients((cs) =>
      cs.map((x) => (x.id === c.id ? { ...x, website, logo_url: null } : x))
    );
    patch(c.id, { website }).then(load);
  }

  const counts = useMemo(() => {
    const c = { healthy: 0, watch: 0, at_risk: 0 };
    for (const cl of clients) {
      if (cl.sentiment === "healthy") c.healthy++;
      else if (cl.sentiment === "watch") c.watch++;
      else if (cl.sentiment === "at_risk") c.at_risk++;
    }
    return c;
  }, [clients]);

  return (
    <div className="app-shell">
      <main className="container stack">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
          <div>
            <h1 className="h1" style={{ marginBottom: 4 }}>All clients</h1>
            <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
              {clients.length} client{clients.length === 1 ? "" : "s"}
            </p>
          </div>
          {!loading && !error && clients.length > 0 ? (
            <div className="health-summary">
              <span className="health-chip is-healthy">
                <span className="dot" />
                {counts.healthy} healthy
              </span>
              <span className="health-chip is-watch">
                <span className="dot" />
                {counts.watch} watch
              </span>
              <span className="health-chip is-at_risk">
                <span className="dot" />
                {counts.at_risk} at risk
              </span>
            </div>
          ) : null}
        </div>

        {loading ? (
          <p className="muted">Loading…</p>
        ) : error ? (
          <p className="error">{error}</p>
        ) : clients.length === 0 ? (
          <div className="empty"><p>No clients yet.</p></div>
        ) : (
          <div className="card card-pad" style={{ overflowX: "auto" }}>
            <table className="client-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Account manager</th>
                  <th>Flags</th>
                  <th>Sentiment</th>
                  <th>Tier</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id} className="client-row" onClick={() => router.push(`/admin/clients/${c.id}`)}>
                    <td>
                      <div className="client-cell">
                        <button
                          type="button"
                          className="avatar-btn"
                          title={c.website ? `Edit website (${c.website})` : "Add website for logo"}
                          onClick={(e) => {
                            e.stopPropagation();
                            editWebsite(c);
                          }}
                        >
                          <ClientAvatar client={c} />
                        </button>
                        <strong>{c.name}</strong>
                      </div>
                    </td>
                    <td>
                      <span className={`manager-tag ${c.account_manager ? "" : "is-unassigned"}`}>
                        {c.account_manager || "Unassigned"}
                      </span>
                    </td>
                    <td>
                      {flags[c.id] ? (
                        <span className={`flag-cell flag-${flags[c.id].status}`} title="Active flags">
                          <span className="flag-dot" />
                          <span className="cnt">
                            {flags[c.id].counts.red ? `${flags[c.id].counts.red}🔴 ` : ""}
                            {flags[c.id].counts.yellow ? `${flags[c.id].counts.yellow}🟡 ` : ""}
                            {flags[c.id].counts.green ? `${flags[c.id].counts.green}🟢` : ""}
                          </span>
                        </span>
                      ) : (
                        <span className="flag-clear">—</span>
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <select
                        className={`select-clean badge-select sentiment-select is-${c.sentiment}`}
                        value={c.sentiment_override || ""}
                        onChange={(e) => changeSentiment(c.id, e.target.value)}
                        title={
                          c.sentiment_override
                            ? "Manual override"
                            : `Auto from performance (${SENTIMENT_LABEL[c.sentiment_auto]})`
                        }
                      >
                        <option value="">
                          Auto · {SENTIMENT_LABEL[c.sentiment_auto]}
                        </option>
                        <option value="healthy">Healthy</option>
                        <option value="watch">Watch</option>
                        <option value="at_risk">At risk</option>
                      </select>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <select
                        className={`select-clean badge-select ${c.tier ? `is-${c.tier}` : ""}`}
                        value={c.tier}
                        aria-label="Account tier"
                        onChange={(e) => changeTier(c.id, e.target.value)}
                      >
                        {TIER_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => router.push(`/admin/clients/${c.id}`)}
                      >
                        Hub →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
