"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand } from "@/components/Brand";
import { NavMenu } from "@/components/NavMenu";
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
type StatusFilter = "all" | "draft" | "in_review" | "needs_changes" | "approved";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "in_review", label: "In review" },
  { value: "needs_changes", label: "Needs changes" },
  { value: "approved", label: "Approved" },
];

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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  const visible =
    statusFilter === "all"
      ? campaigns
      : campaigns.filter((c) => c.status === statusFilter);

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

  async function load(nextFilter: "active" | "archived" = filter, opts?: { silent?: boolean }) {
    if (!opts?.silent) setLoading(true);
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
    load(filter, { silent: true });
  }

  useEffect(() => {
    load(filter);
  }, [filter]);

  // Honor a ?status= deep link (e.g. from the home dashboard tiles).
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("status");
    if (s && STATUS_FILTERS.some((sf) => sf.value === s)) {
      setStatusFilter(s as StatusFilter);
    }
  }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand href="/admin" />
        <div className="row">
          <Link className="btn" href="/admin/new">
            New campaign
          </Link>
          <NavMenu current="/admin/campaigns" />
        </div>
      </header>

      <main className="container container-wide stack">
        <div className="page-hero">
          <h1 className="h1">Campaigns</h1>
        </div>

        {error ? <p className="error">{error}</p> : null}

        <div className="tabs">
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
          <span className="tab-divider" aria-hidden="true" />
          {STATUS_FILTERS.map((sf) => {
            const count =
              sf.value === "all"
                ? campaigns.length
                : campaigns.filter((c) => c.status === sf.value).length;
            return (
              <button
                key={sf.value}
                className={`tab ${statusFilter === sf.value ? "active" : ""}`}
                onClick={() => setStatusFilter(sf.value)}
              >
                {sf.label}
                <span className="tab-count">{count}</span>
              </button>
            );
          })}
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
            ) : visible.length === 0 ? (
              <div className="empty">
                <p>
                  No{" "}
                  {STATUS_FILTERS.find((sf) => sf.value === statusFilter)?.label.toLowerCase()}{" "}
                  campaigns.
                </p>
              </div>
            ) : view === "all" ? (
              <div className="campaign-list">
                {visible.map((c) => (
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
                    ? monthGroups(visible)
                    : clientGroups(visible);
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
