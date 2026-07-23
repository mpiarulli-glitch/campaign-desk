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
  { value: "", label: "Not set" },
  { value: "standard", label: "Standard" },
  { value: "premium", label: "Premium" },
  { value: "vip", label: "VIP" },
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
        <h1 className="h1">All clients</h1>

        {loading ? (
          <p className="muted">Loading…</p>
        ) : error ? (
          <p className="error">{error}</p>
        ) : clients.length === 0 ? (
          <div className="empty"><p>No clients yet.</p></div>
        ) : (
          <div className="card card-pad" style={{ overflowX: "auto" }}>
            <table className="rev-table">
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
                  <tr key={c.id} className="rev-row" onClick={() => router.push(`/admin/clients/${c.id}`)}>
                    <td><strong>{c.name}</strong></td>
                    <td>{c.account_manager || <span className="muted">Unassigned</span>}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <select
                        className="select-clean badge-select"
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
