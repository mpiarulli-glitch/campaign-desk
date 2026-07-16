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
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  open_comments: number;
  email_count?: number;
  magic_token: string;
  archived_at?: string | null;
};

const MONTH_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

type View = "all" | "folders";
type GroupBy = "client" | "month";

// Grouped by the month the campaign was created/sent, not by approval date,
// so pending and in-review campaigns land in a folder too.
function monthGroups(rows: CampaignRow[]) {
  const map = new Map<string, { label: string; items: CampaignRow[] }>();
  for (const c of rows) {
    const d = new Date(c.created_at);
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

function CampaignCard({
  c,
  filter,
  busyId,
  onArchive,
}: {
  c: CampaignRow;
  filter: "active" | "archived";
  busyId: string | null;
  onArchive: (id: string, archived: boolean) => void;
}) {
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
      <div className="row" style={{ alignItems: "center", gap: 8 }}>
        <StatusBadge status={c.status} />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busyId === c.id}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onArchive(c.id, filter === "active");
          }}
        >
          {busyId === c.id
            ? "..."
            : filter === "active"
              ? "Archive"
              : "Restore"}
        </button>
      </div>
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
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"active" | "archived">("active");
  const [busyId, setBusyId] = useState<string | null>(null);

  function toggleFolder(key: string) {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function load(nextFilter: "active" | "archived" = filter) {
    setLoading(true);
    setError("");
    const res = await fetch(
      `/api/campaigns${nextFilter === "archived" ? "?archived=1" : ""}`
    );
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

  async function setArchived(id: string, archived: boolean) {
    setBusyId(id);
    const res = await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    });
    setBusyId(null);
    if (!res.ok) {
      setError(archived ? "Could not archive." : "Could not restore.");
      return;
    }
    load();
  }

  useEffect(() => {
    load(filter);
  }, [filter]);

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
          <Link className="btn btn-ghost btn-sm" href="/admin/calendar">
            Calendar
          </Link>
          <Link className="btn btn-ghost btn-sm" href="/admin/snapshot">
            Snapshots
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

        <div className="tabs" style={{ marginBottom: 4 }}>
          <button
            className={`tab ${filter === "active" ? "active" : ""}`}
            onClick={() => setFilter("active")}
          >
            Active
          </button>
          <button
            className={`tab ${filter === "archived" ? "active" : ""}`}
            onClick={() => setFilter("archived")}
          >
            Archived
          </button>
        </div>

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
                  className={`preview-device-btn ${view === "folders" ? "active" : ""}`}
                  onClick={() => setView("folders")}
                >
                  Folders
                </button>
              </div>
              {view === "folders" ? (
                <div className="row" style={{ gap: 6 }}>
                  <button
                    type="button"
                    className={`preview-device-btn ${groupBy === "month" ? "active" : ""}`}
                    onClick={() => {
                      setGroupBy("month");
                      setOpenFolders(new Set());
                    }}
                  >
                    By month
                  </button>
                  <button
                    type="button"
                    className={`preview-device-btn ${groupBy === "client" ? "active" : ""}`}
                    onClick={() => {
                      setGroupBy("client");
                      setOpenFolders(new Set());
                    }}
                  >
                    By client
                  </button>
                </div>
              ) : null}
            </div>

            {loading ? (
              <p className="muted">Loading...</p>
            ) : campaigns.length === 0 ? (
              filter === "archived" ? (
                <div className="empty">
                  <p>No archived campaigns.</p>
                </div>
              ) : (
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
              )
            ) : view === "all" ? (
              <div className="campaign-list">
                {campaigns.map((c) => (
                  <CampaignCard
                    key={c.id}
                    c={c}
                    filter={filter}
                    busyId={busyId}
                    onArchive={setArchived}
                  />
                ))}
              </div>
            ) : (
              (() => {
                const groups =
                  groupBy === "month"
                    ? monthGroups(campaigns)
                    : clientGroups(campaigns);
                return (
                  <div className="stack" style={{ gap: 12 }}>
                    {groups.map((g) => {
                      const isOpen = openFolders.has(g.key);
                      return (
                        <div key={g.key} className="folder-group">
                          <button
                            type="button"
                            className="folder-header"
                            onClick={() => toggleFolder(g.key)}
                            aria-expanded={isOpen}
                          >
                            <span aria-hidden="true">{isOpen ? "📂" : "📁"}</span>
                            {g.label}
                            <span className="muted" style={{ fontWeight: 400 }}>
                              {g.items.length}
                            </span>
                            <span className="folder-chevron" aria-hidden="true">
                              {isOpen ? "▾" : "▸"}
                            </span>
                          </button>
                          {isOpen ? (
                            <div className="campaign-list">
                              {g.items.map((c) => (
                                <CampaignCard
                                  key={c.id}
                                  c={c}
                                  filter={filter}
                                  busyId={busyId}
                                  onArchive={setArchived}
                                />
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
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
