"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand } from "@/components/Brand";
import { NavMenu } from "@/components/NavMenu";

type Client = {
  id: string;
  name: string;
  account_manager: string;
  tier: string;
  active: number;
};

const TIER_OPTIONS = [
  { value: "", label: "No tier" },
  { value: "tier1", label: "Tier 1" },
  { value: "tier2", label: "Tier 2" },
  { value: "tier3", label: "Tier 3" },
];

export default function AllClientsPage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
  }, []);

  async function changeTier(id: string, tier: string) {
    setClients((cs) => cs.map((c) => (c.id === id ? { ...c, tier } : c)));
    await fetch(`/api/revenue/clients/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier }),
    });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand href="/admin" />
        <NavMenu current="/admin/clients" />
      </header>

      <main className="container stack">
        <div>
          <h1 className="h1" style={{ marginBottom: 4 }}>All clients</h1>
          <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
            {clients.length} client{clients.length === 1 ? "" : "s"}
          </p>
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
                  <th>Tier</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id} className="client-row" onClick={() => router.push(`/admin/clients/${c.id}`)}>
                    <td><strong>{c.name}</strong></td>
                    <td>
                      <span className={`manager-tag ${c.account_manager ? "" : "is-unassigned"}`}>
                        {c.account_manager || "Unassigned"}
                      </span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <select
                        className={`select-clean badge-select ${c.tier ? `is-${c.tier}` : ""}`}
                        value={c.tier}
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
