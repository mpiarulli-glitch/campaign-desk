"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand } from "@/components/Brand";
import { StatusBadge } from "@/components/StatusBadge";
import { ActivitySidebar } from "@/components/ActivitySidebar";

type CampaignRow = {
  id: string;
  title: string;
  client_name: string;
  status: string;
  updated_at: string;
  approved_at: string | null;
  open_comments: number;
  email_count?: number;
  magic_token: string;
};

const MONTH_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

type View = "all" | "approvals";
type GroupBy = "client" | "month";

function monthGroups(rows: CampaignRow[]) {
  const map = new Map<string, { label: string; items: CampaignRow[] }>();
  for (const c of rows) {
    if (!c.approved_at) continue;
    const d = new Date(c.approved_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!map.has(key)) map.set(key, { label: MONTH_FORMAT.format(d), items: [] });
    map.get(key)!.items.push(c);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, v]) => ({ key, label: v.label, items: v.items }));
}

function clientGroups(rows: CampaignRow[]) {
  const map = new Map<string, CampaignRow[]>();
  for (const c of rows) {
    const key = c.client_name.trim() || "No client";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(c);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, items]) => ({ key, label: key, items }));
}

function CampaignCard({ c }: { c: CampaignRow }) {
  return (
    <Link href={`/admin/campaigns/${c.id}`} className="campaign-item">
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
  );
}

export default function AdminPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("month");

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

      <main className="container container-wide stack">
        <div className="page-hero">
          <p className="eyebrow">Dashboard</p>
          <h1 className="h1">Campaigns</h1>
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
            Upload HTML, share a magic link, collect feedback.
          </p>
        </div>

        {error ? <p className="error">{error}</p> : null}

        <div className="dashboard-grid">
          <div className="stack" style={{ gap: 12 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="row" style={{ gap: 6 }}>
                <button
                  type="button"
                  className={`preview-device-btn ${view === "all" ? "active" : ""}`}
                  onClick={() => setView("all")}
                >
                  All campaigns
                </button>
                <button
                  type="button"
                  className={`preview-device-btn ${view === "approvals" ? "active" : ""}`}
                  onClick={() => setView("approvals")}
                >
                  Approvals
                </button>
              </div>
              {view === "approvals" ? (
                <div className="row" style={{ gap: 6 }}>
                  <button
                    type="button"
                    className={`preview-device-btn ${groupBy === "month" ? "active" : ""}`}
                    onClick={() => setGroupBy("month")}
                  >
                    By month
                  </button>
                  <button
                    type="button"
                    className={`preview-device-btn ${groupBy === "client" ? "active" : ""}`}
                    onClick={() => setGroupBy("client")}
                  >
                    By client
                  </button>
                </div>
              ) : null}
            </div>

            {loading ? (
              <p className="muted">Loading...</p>
            ) : campaigns.length === 0 ? (
              <div className="empty">
                <p>No campaigns yet.</p>
                <Link
                  className="btn"
                  href="/admin/new"
                  style={{ marginTop: 12 }}
                >
                  Upload your first email
                </Link>
              </div>
            ) : view === "all" ? (
              <div className="campaign-list">
                {campaigns.map((c) => (
                  <CampaignCard key={c.id} c={c} />
                ))}
              </div>
            ) : (
              (() => {
                const approved = campaigns.filter((c) => c.status === "approved");
                if (approved.length === 0) {
                  return <div className="empty">No approvals yet.</div>;
                }
                const groups =
                  groupBy === "month" ? monthGroups(approved) : clientGroups(approved);
                return (
                  <div className="stack" style={{ gap: 20 }}>
                    {groups.map((g) => (
                      <div key={g.key} className="folder-group">
                        <div className="folder-header">
                          <span aria-hidden="true">📁</span>
                          {g.label}
                          <span className="muted" style={{ fontWeight: 400 }}>
                            {g.items.length}
                          </span>
                        </div>
                        <div className="campaign-list">
                          {g.items.map((c) => (
                            <CampaignCard key={c.id} c={c} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()
            )}
          </div>

          <ActivitySidebar />
        </div>
      </main>
    </div>
  );
}
