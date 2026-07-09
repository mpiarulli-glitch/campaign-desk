"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand } from "@/components/Brand";
import { StatusBadge } from "@/components/StatusBadge";

type CampaignRow = {
  id: string;
  title: string;
  client_name: string;
  status: string;
  updated_at: string;
  open_comments: number;
  email_count?: number;
  magic_token: string;
};

export default function AdminPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    const res = await fetch("/api/campaigns");
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) {
      setError("Failed to load campaigns.");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setCampaigns(data.campaigns || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    router.push("/login");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand href="/admin" />
        <div className="row">
          <Link className="btn btn-ghost btn-sm" href="/admin/activity">
            Activity
          </Link>
          <Link className="btn" href="/admin/new">
            New campaign
          </Link>
          <button className="btn btn-ghost btn-sm" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <main className="container stack">
        <div className="page-hero">
          <p className="eyebrow">Dashboard</p>
          <h1 className="h1">Campaigns</h1>
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
            Upload HTML, share a magic link, collect feedback.
          </p>
        </div>

        {error ? <p className="error">{error}</p> : null}

        {loading ? (
          <p className="muted">Loading...</p>
        ) : campaigns.length === 0 ? (
          <div className="empty">
            <p>No campaigns yet.</p>
            <Link className="btn" href="/admin/new" style={{ marginTop: 12 }}>
              Upload your first email
            </Link>
          </div>
        ) : (
          <div className="campaign-list">
            {campaigns.map((c) => (
              <Link
                key={c.id}
                href={`/admin/campaigns/${c.id}`}
                className="campaign-item"
              >
                <div>
                  <h3>{c.title}</h3>
                  <div className="meta">
                    {c.client_name ? `${c.client_name} · ` : ""}
                    {c.email_count
                      ? `${c.email_count} email${c.email_count === 1 ? "" : "s"} · `
                      : ""}
                    Updated {new Date(c.updated_at).toLocaleString()}
                    {c.open_comments > 0
                      ? ` · ${c.open_comments} open comment${
                          c.open_comments === 1 ? "" : "s"
                        }`
                      : ""}
                  </div>
                </div>
                <StatusBadge status={c.status} />
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
