"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Brand } from "@/components/Brand";

type Account = { id: string; name: string; deliverable_count: number };

export default function SnapshotAccountsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/snapshot/accounts");
    if (res.status === 401) return router.push("/login");
    if (!res.ok) { setError("Failed to load."); setLoading(false); return; }
    setAccounts((await res.json()).accounts || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function addAccount(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    // Same "add client" flow the revenue page uses, so a client only ever
    // gets created once (see /api/revenue/clients).
    const res = await fetch("/api/revenue/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setSaving(false);
    if (!res.ok) { setError("Could not add account."); return; }
    const data = await res.json();
    router.push(`/admin/snapshot/${data.client.id}`);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand href="/admin" />
        <div className="row">
          <Link className="btn btn-ghost btn-sm" href="/admin/campaigns">Campaigns</Link>
          <Link className="btn btn-ghost btn-sm" href="/admin/calendar">Calendar</Link>
          <Link className="btn btn-ghost btn-sm" href="/admin/snapshot/behind">Behind report</Link>
          <button className="btn btn-sm" onClick={() => setAdding((v) => !v)}>
            {adding ? "Cancel" : "Add account"}
          </button>
        </div>
      </header>

      <main className="container stack">
        <div className="page-hero">
          <p className="eyebrow">Client reporting</p>
          <h1 className="h1">Account snapshots</h1>
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
            Log weekly work against each account&apos;s deliverables and share a
            clean, read-only view with the client.
          </p>
        </div>

        {error ? <p className="error">{error}</p> : null}

        {adding ? (
          <form className="card card-pad row" onSubmit={addAccount} style={{ gap: 8 }}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Account name"
              autoFocus
              style={{ flex: 1 }}
            />
            <button className="btn" type="submit" disabled={saving}>
              {saving ? "Adding..." : "Create"}
            </button>
          </form>
        ) : null}

        {loading ? (
          <p className="muted">Loading...</p>
        ) : accounts.length === 0 ? (
          <div className="empty"><p>No accounts yet. Add one to start.</p></div>
        ) : (
          <div className="campaign-list">
            {accounts.map((a) => (
              <Link key={a.id} href={`/admin/snapshot/${a.id}`} className="campaign-item">
                <div>
                  <h3>{a.name}</h3>
                  <div className="meta">
                    {a.deliverable_count} deliverable{a.deliverable_count === 1 ? "" : "s"}
                  </div>
                </div>
                <span className="btn btn-secondary btn-sm">Open</span>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
