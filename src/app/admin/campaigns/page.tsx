"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { ActivitySidebar } from "@/components/ActivitySidebar";
import {
  OPERATOR_STATUS_OPTIONS,
  matchesCampaignStatusFilter,
  type OperatorCampaignStatus,
} from "@/lib/campaign-status";
import {
  ASSET_KINDS,
  isAssetKind,
  packageItemCountLabel,
  type AssetKind,
} from "@/lib/asset-kinds";

type CampaignRow = {
  id: string;
  title: string;
  client_name: string;
  status: string;
  approved_channel?: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  open_comments: number;
  email_count?: number;
  email_kinds?: AssetKind[];
  magic_token: string;
  archived_at?: string | null;
  presentation?: string;
  basecamp_followup_count?: number;
};

const MONTH_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

type View = "all" | "folders";
type GroupBy = "client" | "month";
type StatusFilter = "all" | OperatorCampaignStatus;
type KindFilter = "all" | AssetKind;
type DatePreset = "any" | "7d" | "30d" | "90d" | "month" | "custom";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  ...OPERATOR_STATUS_OPTIONS,
];

const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All kinds" },
  ...ASSET_KINDS.map((k) => ({
    value: k.kind,
    label: k.kind === "linkedin" ? "LinkedIn" : k.label,
  })),
];

function campaignMatchesKind(c: CampaignRow, kind: KindFilter): boolean {
  if (kind === "all") return true;
  return (c.email_kinds || []).includes(kind);
}

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "month", label: "This month" },
  { value: "custom", label: "Custom" },
];

function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function campaignUpdatedYmd(c: CampaignRow): string {
  return ymdLocal(new Date(c.updated_at));
}

/** Inclusive YYYY-MM-DD bounds for the date filter. Null means unbounded. */
function resolveDateBounds(
  preset: DatePreset,
  from: string,
  to: string,
  now = new Date()
): { start: string | null; end: string | null } {
  const end = ymdLocal(now);
  if (preset === "any") return { start: null, end: null };
  if (preset === "custom") {
    const start = from.trim() || null;
    const customEnd = to.trim() || null;
    if (!start && !customEnd) return { start: null, end: null };
    return { start, end: customEnd };
  }
  if (preset === "month") {
    return { start: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`, end };
  }
  const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
  const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  return { start: ymdLocal(startDate), end };
}

function matchesDateFilter(
  c: CampaignRow,
  bounds: { start: string | null; end: string | null }
): boolean {
  if (!bounds.start && !bounds.end) return true;
  const day = campaignUpdatedYmd(c);
  if (bounds.start && day < bounds.start) return false;
  if (bounds.end && day > bounds.end) return false;
  return true;
}

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
  onRename,
}: {
  c: CampaignRow;
  filter: "active" | "archived";
  busyId: string | null;
  onArchive: (id: string, archived: boolean) => void;
  onRename: (id: string, title: string) => Promise<void>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(c.title);
  const [saving, setSaving] = useState(false);

  // The whole row is a link to the campaign, so anything interactive inside it
  // has to stop the click from navigating.
  function swallow(e: React.MouseEvent | React.KeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  async function save() {
    const next = draft.trim();
    if (!next || next === c.title) {
      setRenaming(false);
      setDraft(c.title);
      return;
    }
    setSaving(true);
    await onRename(c.id, next);
    setSaving(false);
    setRenaming(false);
  }

  return (
    <Link href={`/admin/campaigns/${c.id}`} className="campaign-item">
      <div style={{ minWidth: 0, flex: 1 }}>
        {renaming ? (
          <div className="row" style={{ gap: 6, alignItems: "center" }} onClick={swallow}>
            <input
              autoFocus
              value={draft}
              disabled={saving}
              onChange={(e) => setDraft(e.target.value)}
              onClick={swallow}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  swallow(e);
                  void save();
                } else if (e.key === "Escape") {
                  swallow(e);
                  setDraft(c.title);
                  setRenaming(false);
                }
              }}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button
              type="button"
              className="btn btn-sm"
              disabled={saving}
              onClick={(e) => {
                swallow(e);
                void save();
              }}
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={saving}
              onClick={(e) => {
                swallow(e);
                setDraft(c.title);
                setRenaming(false);
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <h3>{c.title}</h3>
        )}
        <div className="meta">
          {c.presentation === "automation" ? "Automation · " : ""}
          {c.client_name ? `${c.client_name} · ` : ""}
          {c.email_count
            ? `${packageItemCountLabel(
                c.email_kinds?.length
                  ? c.email_kinds
                  : Array.from({ length: c.email_count }, () => "email" as AssetKind),
                { automation: c.presentation === "automation" }
              )} · `
            : ""}
          Updated {new Date(c.updated_at).toLocaleString()}
          {c.open_comments > 0
            ? ` · ${c.open_comments} open comment${
                c.open_comments === 1 ? "" : "s"
              }`
            : ""}
          {(c.basecamp_followup_count || 0) > 0
            ? ` · Followed up ${c.basecamp_followup_count}×`
            : ""}
        </div>
      </div>
      <div className="row" style={{ alignItems: "center", gap: 8 }}>
        <StatusBadge status={c.status} approvedChannel={c.approved_channel} />
        {!renaming ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={(e) => {
              swallow(e);
              setDraft(c.title);
              setRenaming(true);
            }}
          >
            Rename
          </button>
        ) : null}
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
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("any");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const dateBounds = resolveDateBounds(datePreset, dateFrom, dateTo);
  const dated = campaigns.filter((c) => matchesDateFilter(c, dateBounds));
  const kinded = dated.filter((c) => campaignMatchesKind(c, kindFilter));
  const visible =
    statusFilter === "all"
      ? kinded
      : kinded.filter((c) => matchesCampaignStatusFilter(c, statusFilter));
  const dateActive = Boolean(dateBounds.start || dateBounds.end);
  const kindsInList = new Set(
    campaigns.flatMap((c) => c.email_kinds || [])
  );

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

  async function renameCampaign(id: string, title: string) {
    const res = await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      setError("Could not rename that campaign.");
      return;
    }
    setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
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

  // Honor ?status= and ?kind= deep links (home tiles, LinkedIn campaign pages).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const s = params.get("status");
    if (s && STATUS_FILTERS.some((sf) => sf.value === s)) {
      setStatusFilter(s as StatusFilter);
    }
    const k = params.get("kind");
    if (k === "all" || isAssetKind(k)) setKindFilter(k);
  }, []);

  return (
    <div className="app-shell">
      <div className="page-actions">
        <Link className="btn" href="/admin/new">
          New campaign
        </Link>
      </div>

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
                ? kinded.length
                : kinded.filter((c) =>
                    matchesCampaignStatusFilter(c, sf.value)
                  ).length;
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

        <div className="tabs" role="tablist" aria-label="Campaign kind">
          {KIND_FILTERS.filter(
            (kf) =>
              kf.value === "all" ||
              kf.value === "linkedin" ||
              kindsInList.has(kf.value)
          ).map((kf) => {
            const count =
              kf.value === "all"
                ? dated.length
                : dated.filter((c) => campaignMatchesKind(c, kf.value)).length;
            return (
              <button
                key={kf.value}
                role="tab"
                aria-selected={kindFilter === kf.value}
                className={`tab ${kindFilter === kf.value ? "active" : ""}`}
                onClick={() => {
                  setKindFilter(kf.value);
                  const url = new URL(window.location.href);
                  if (kf.value === "all") url.searchParams.delete("kind");
                  else url.searchParams.set("kind", kf.value);
                  window.history.replaceState(null, "", url);
                }}
              >
                {kf.label}
                <span className="tab-count">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="campaign-date-filter">
          <span className="campaign-date-label">Updated</span>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {DATE_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                className={`preview-device-btn ${datePreset === p.value ? "active" : ""}`}
                onClick={() => setDatePreset(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {datePreset === "custom" ? (
            <div className="campaign-date-custom">
              <label>
                <span>From</span>
                <input
                  type="date"
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </label>
              <label>
                <span>To</span>
                <input
                  type="date"
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </label>
            </div>
          ) : null}
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
                  campaigns
                  {dateActive ? " in that date range" : ""}.
                </p>
                {dateActive ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ marginTop: 12 }}
                    onClick={() => {
                      setDatePreset("any");
                      setDateFrom("");
                      setDateTo("");
                    }}
                  >
                    Clear date filter
                  </button>
                ) : null}
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
                    onRename={renameCampaign}
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
                                  onRename={renameCampaign}
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
