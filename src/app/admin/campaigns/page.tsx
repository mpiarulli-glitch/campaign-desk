"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { ActivitySidebar } from "@/components/ActivitySidebar";
import {
  OPERATOR_STATUS_OPTIONS,
  STATUS_BUCKETS,
  matchesCampaignStatusFilter,
  matchesListBucket,
  operatorStatusLabel,
  statusBucketId,
  type ListBucket,
  type OperatorCampaignStatus,
} from "@/lib/campaign-status";
import {
  ASSET_KINDS,
  isAssetKind,
  packageItemCountLabel,
  type AssetKind,
} from "@/lib/asset-kinds";
import type { CampaignKindScope } from "@/lib/people";
import { isCampaignKindScope } from "@/lib/people";

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
  scheduled_send_at?: string | null;
  next_send_at?: string | null;
  next_send_upcoming?: boolean;
  owner?: string;
  owner_key?: string;
};

const SEND_ZONE = "America/Los_Angeles";

const MONTH_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: SEND_ZONE,
});

const SEND_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: SEND_ZONE,
});

const MONTH_KEY = new Intl.DateTimeFormat("en-CA", {
  timeZone: SEND_ZONE,
  year: "numeric",
  month: "2-digit",
});

type StatusFilter = "all" | OperatorCampaignStatus;
type BucketFilter = ListBucket;
type KindFilter = "all" | AssetKind;
type DatePreset = "any" | "7d" | "30d" | "90d" | "month" | "custom";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Any exact status" },
  ...OPERATOR_STATUS_OPTIONS,
];

const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "Any channel" },
  ...ASSET_KINDS.map((k) => ({
    value: k.kind,
    label: k.kind === "linkedin" ? "LinkedIn" : k.label,
  })),
];

type SavedView = {
  id: string;
  name: string;
  query: string;
  client: string;
  owner: string;
  bucket: ListBucket;
  status: StatusFilter;
  kind: KindFilter;
  month: string;
  datePreset: DatePreset;
  dateFrom: string;
  dateTo: string;
  archived: boolean;
};

const SAVED_VIEWS_KEY = "cd-campaign-saved-views";

const QUICK_FILTERS: { id: ListBucket; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "in_progress", label: "In progress" },
  { id: "waiting", label: "Waiting on client" },
  { id: "ready", label: "Ready to send" },
  { id: "sent", label: "Sent" },
  { id: "all", label: "All" },
];

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "month", label: "This month" },
  { value: "custom", label: "Custom" },
];

const NO_CLIENT = "__none__";

function setListQueryParam(key: "status" | "kind", value: string) {
  const url = new URL(window.location.href);
  if (value === "all") url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  window.history.replaceState(null, "", url);
}

function campaignMatchesKind(c: CampaignRow, kind: KindFilter): boolean {
  if (kind === "all") return true;
  return (c.email_kinds || []).includes(kind);
}

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

function campaignMonthKey(iso: string): string {
  const formatted = MONTH_KEY.format(new Date(iso));
  return formatted.slice(0, 7);
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 15, 12));
  return MONTH_FORMAT.format(d);
}

function clientKey(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed : NO_CLIENT;
}

function clientLabel(key: string): string {
  return key === NO_CLIENT ? "No client" : key;
}

function formatSend(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Not scheduled";
  return SEND_FORMAT.format(d);
}

function emailLabel(c: CampaignRow): string {
  if (!c.email_count) return "No emails";
  return packageItemCountLabel(
    c.email_kinds?.length
      ? c.email_kinds
      : Array.from({ length: c.email_count }, () => "email" as AssetKind),
    { automation: c.presentation === "automation" }
  );
}

function CampaignRowView({
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

  const notes: string[] = [];
  if (c.presentation === "automation") notes.push("Automation");
  if (c.open_comments > 0) {
    notes.push(
      `${c.open_comments} open comment${c.open_comments === 1 ? "" : "s"}`
    );
  }
  if ((c.basecamp_followup_count || 0) > 0) {
    notes.push(`Followed up ${c.basecamp_followup_count}×`);
  }

  const sendAt = c.next_send_at || c.scheduled_send_at || null;
  const upcoming = c.next_send_at ? Boolean(c.next_send_upcoming) : false;

  return (
    <Link href={`/admin/campaigns/${c.id}`} className="clist-row">
      <span className="clist-client">
        {c.client_name.trim() || "No client"}
      </span>
      <span className="clist-name-wrap">
        {renaming ? (
          <span className="clist-rename" onClick={swallow}>
            <input
              autoFocus
              value={draft}
              disabled={saving}
              aria-label="Campaign name"
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
          </span>
        ) : (
          <span className="clist-name">{c.title}</span>
        )}
        {notes.length ? <span className="clist-note">{notes.join(" · ")}</span> : null}
      </span>
      <span className="clist-status">
        <StatusBadge status={c.status} approvedChannel={c.approved_channel} />
      </span>
      <span className="clist-owner">{c.owner || "Unassigned"}</span>
      <span className="clist-send">
        {sendAt ? (
          <>
            <span className="clist-send-k">{upcoming ? "Next" : "Sent"}</span>
            {formatSend(sendAt)}
          </>
        ) : (
          <span className="clist-quiet">Not scheduled</span>
        )}
      </span>
      <span className="clist-count-cell">{emailLabel(c)}</span>
      <span className="clist-actions" onClick={swallow}>
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
            swallow(e);
            onArchive(c.id, filter === "active");
          }}
        >
          {busyId === c.id ? "..." : filter === "active" ? "Archive" : "Restore"}
        </button>
      </span>
    </Link>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"active" | "archived">("active");
  const [bucket, setBucket] = useState<BucketFilter>("open");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [kindScope, setKindScope] = useState<CampaignKindScope | "all">("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("any");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [savingView, setSavingView] = useState(false);
  const [viewName, setViewName] = useState("");

  const dateBounds = resolveDateBounds(datePreset, dateFrom, dateTo);
  const dated = campaigns.filter((c) => matchesDateFilter(c, dateBounds));
  const kinded = dated.filter((c) => campaignMatchesKind(c, kindFilter));
  const cliented =
    clientFilter === "all"
      ? kinded
      : kinded.filter((c) => clientKey(c.client_name) === clientFilter);
  const owned =
    ownerFilter === "all"
      ? cliented
      : cliented.filter((c) => (c.owner_key || "unassigned") === ownerFilter);
  const monthed =
    monthFilter === "all"
      ? owned
      : owned.filter((c) => campaignMonthKey(c.created_at) === monthFilter);
  const q = query.trim().toLowerCase();
  const searched = q
    ? monthed.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.client_name.toLowerCase().includes(q) ||
          (c.owner || "").toLowerCase().includes(q)
      )
    : monthed;
  const bucketed =
    bucket === "all"
      ? searched
      : searched.filter((c) => matchesListBucket(c, bucket));
  const visible =
    statusFilter === "all"
      ? bucketed
      : bucketed.filter((c) => matchesCampaignStatusFilter(c, statusFilter));
  const dateActive = Boolean(dateBounds.start || dateBounds.end);
  const kindsInList = new Set(campaigns.flatMap((c) => c.email_kinds || []));

  const clients = useMemo(() => {
    const keys = new Set(campaigns.map((c) => clientKey(c.client_name)));
    return Array.from(keys).sort((a, b) =>
      clientLabel(a).localeCompare(clientLabel(b))
    );
  }, [campaigns]);

  const owners = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of campaigns) {
      const key = c.owner_key || "unassigned";
      if (!map.has(key)) map.set(key, c.owner || "Unassigned");
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [campaigns]);

  const months = useMemo(() => {
    const keys = new Set(campaigns.map((c) => campaignMonthKey(c.created_at)));
    return Array.from(keys).sort((a, b) => b.localeCompare(a));
  }, [campaigns]);

  useEffect(() => {
    if (clientFilter !== "all" && !clients.includes(clientFilter)) {
      setClientFilter("all");
    }
  }, [clients, clientFilter]);

  useEffect(() => {
    if (monthFilter !== "all" && !months.includes(monthFilter)) {
      setMonthFilter("all");
    }
  }, [months, monthFilter]);

  const extraCount =
    (statusFilter !== "all" ? 1 : 0) +
    (kindFilter !== "all" ? 1 : 0) +
    (datePreset !== "any" ? 1 : 0) +
    (filter === "archived" ? 1 : 0);

  const filtersOn =
    extraCount > 0 ||
    bucket !== "open" ||
    clientFilter !== "all" ||
    monthFilter !== "all" ||
    ownerFilter !== "all" ||
    query.trim() !== "";

  function applyBucket(next: BucketFilter) {
    setBucket(next);
    if (statusFilter === "all") return;
    const parent = statusBucketId(statusFilter);
    const stillFits =
      next === "all" ||
      parent === next ||
      (next === "open" && parent != null && parent !== "sent");
    if (!stillFits) {
      setStatusFilter("all");
      setListQueryParam("status", "all");
    }
  }

  function currentView(): Omit<SavedView, "id" | "name"> {
    return {
      query,
      client: clientFilter,
      owner: ownerFilter,
      bucket,
      status: statusFilter,
      kind: kindFilter,
      month: monthFilter,
      datePreset,
      dateFrom,
      dateTo,
      archived: filter === "archived",
    };
  }

  function applySaved(view: SavedView) {
    setQuery(view.query);
    setClientFilter(view.client);
    setOwnerFilter(view.owner);
    setBucket(view.bucket);
    setStatusFilter(view.status);
    setListQueryParam("status", view.status);
    setKindFilter(view.kind);
    setListQueryParam("kind", view.kind);
    setMonthFilter(view.month);
    setDatePreset(view.datePreset);
    setDateFrom(view.dateFrom);
    setDateTo(view.dateTo);
    setFilter(view.archived ? "archived" : "active");
  }

  function persistViews(next: SavedView[]) {
    setSavedViews(next);
    try {
      localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next));
    } catch {
      // The view still applies for this visit.
    }
  }

  function clearFilters() {
    setQuery("");
    setClientFilter("all");
    setOwnerFilter("all");
    setBucket("open");
    setMonthFilter("all");
    setStatusFilter("all");
    setListQueryParam("status", "all");
    setKindFilter("all");
    setListQueryParam("kind", "all");
    setDatePreset("any");
    setDateFrom("");
    setDateTo("");
    if (filter === "archived") setFilter("active");
  }

  const load = useCallback(async (
    nextFilter: "active" | "archived",
    opts?: { silent?: boolean }
  ) => {
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
    const scope = isCampaignKindScope(data.scope) ? data.scope : "all";
    setKindScope(scope);
    if (scope === "no_blog") {
      setKindFilter((current) => (current === "blog" ? "all" : current));
    }
    setLoading(false);
  }, [router]);

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
    void load(filter);
  }, [filter, load]);

  // Honor ?status= and ?kind= deep links (home tiles, LinkedIn campaign pages).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let openMore = false;
    const s = params.get("status");
    if (s && STATUS_FILTERS.some((sf) => sf.value === s)) {
      setStatusFilter(s as StatusFilter);
      const parent = statusBucketId(s);
      if (parent) setBucket(parent);
      openMore = true;
    }
    const k = params.get("kind");
    if (k === "all" || isAssetKind(k)) {
      setKindFilter(k);
      if (k !== "all") openMore = true;
    }
    if (openMore) setMoreOpen(true);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_VIEWS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SavedView[];
      if (Array.isArray(parsed)) setSavedViews(parsed.filter((view) => view && view.name && view.id));
    } catch {
      // Ignore a bad saved-view blob.
    }
  }, []);

  const nounPlural = kindScope === "blog" ? "blog posts" : "campaigns";

  return (
    <div className="app-shell">
      <div className="page-actions">
        <Link className="btn" href="/admin/new">
          {kindScope === "blog" ? "New blog post" : "New campaign"}
        </Link>
      </div>

      <main className="container container-wide stack">
        <div className="clist">
          <div className="clist-head">
            <div>
              <p className="clist-kicker">Marketing Empire Group</p>
              <h1 className="h1">{kindScope === "blog" ? "Blog posts" : "Campaigns"}</h1>
              <p className="clist-sub">
                Open work first. Filter by client, owner, status, channel, or when it was updated.
              </p>
            </div>
            <p className="clist-total">
              <b>{loading ? "—" : visible.length}</b>
              <span>
                {loading
                  ? "loading"
                  : visible.length === campaigns.length
                    ? nounPlural
                    : `of ${campaigns.length}`}
              </span>
            </p>
          </div>

          {error ? <p className="error">{error}</p> : null}

          <div className="clist-quick" role="group" aria-label="Quick filters">
            {QUICK_FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={bucket === item.id && statusFilter === "all"}
                onClick={() => applyBucket(item.id)}
              >
                {item.label}
              </button>
            ))}
            {savedViews.map((view) => (
              <button key={view.id} type="button" onClick={() => applySaved(view)}>
                {view.name}
              </button>
            ))}
            {savingView ? (
              <form
                className="clist-save"
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = viewName.trim();
                  if (!name) return;
                  persistViews([
                    ...savedViews,
                    { ...currentView(), id: `${Date.now()}`, name },
                  ]);
                  setViewName("");
                  setSavingView(false);
                }}
              >
                <input
                  autoFocus
                  value={viewName}
                  onChange={(event) => setViewName(event.target.value)}
                  placeholder="Name this view"
                  aria-label="Saved view name"
                />
                <button type="submit" className="btn btn-sm">Save</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSavingView(false)}>
                  Cancel
                </button>
              </form>
            ) : (
              <button type="button" className="clist-save-btn" onClick={() => setSavingView(true)}>
                Save view
              </button>
            )}
          </div>

          <div className="clist-bar">
            <label className="clist-field clist-search">
              <span>Search</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={kindScope === "blog" ? "Post or client" : "Campaign or client"}
                aria-label={
                  kindScope === "blog"
                    ? "Search blog posts by name or client"
                    : "Search campaigns by name or client"
                }
              />
            </label>
            <label className="clist-field">
              <span>Client</span>
              <select
                className="campaign-filter-select"
                aria-label="Filter by client"
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
              >
                <option value="all">All clients</option>
                {clients.map((key) => (
                  <option key={key} value={key}>
                    {clientLabel(key)}
                  </option>
                ))}
              </select>
            </label>
            <label className="clist-field">
              <span>Status</span>
              <select
                className="campaign-filter-select"
                aria-label="Filter by status"
                value={bucket}
                onChange={(e) => applyBucket(e.target.value as BucketFilter)}
              >
                <option value="open">Open</option>
                <option value="all">All statuses</option>
                {STATUS_BUCKETS.map((b) => {
                  const count = searched.filter((c) =>
                    matchesListBucket(c, b.id)
                  ).length;
                  return (
                    <option key={b.id} value={b.id}>
                      {b.label} ({count})
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="clist-field">
              <span>Owner</span>
              <select
                className="campaign-filter-select"
                aria-label="Filter by owner"
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
              >
                <option value="all">Any owner</option>
                {owners.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {kindScope === "blog" || kindScope === "interactive" ? null : (
              <label className="clist-field">
                <span>Channel</span>
                <select
                  className="campaign-filter-select"
                  aria-label="Filter by channel"
                  value={kindFilter}
                  onChange={(e) => {
                    const next = e.target.value as KindFilter;
                    setKindFilter(next);
                    setListQueryParam("kind", next);
                  }}
                >
                  {KIND_FILTERS.filter(
                    (kf) =>
                      (kindScope === "no_blog" ? kf.value !== "blog" : true) &&
                      (kf.value === "all" ||
                        kf.value === "linkedin" ||
                        kindsInList.has(kf.value))
                  ).map((kf) => (
                    <option key={kf.value} value={kf.value}>
                      {kf.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="clist-field">
              <span>Month</span>
              <select
                className="campaign-filter-select"
                aria-label="Filter by month created"
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
              >
                <option value="all">Any month</option>
                {months.map((key) => (
                  <option key={key} value={key}>
                    {monthLabel(key)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={`clist-more${moreOpen ? " is-open" : ""}${extraCount ? " has-extra" : ""}`}
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((open) => !open)}
            >
              More filters
              {extraCount ? <span className="clist-more-count">{extraCount}</span> : null}
            </button>
          </div>

          <div className="clist-updated">
            <span className="clist-field-label">Updated</span>
            <div className="clist-pills" role="group" aria-label="Updated date range">
              {DATE_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  aria-pressed={datePreset === p.value}
                  className={datePreset === p.value ? "is-on" : ""}
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

          {moreOpen ? (
            <div className="clist-panel">
              <div className="clist-panel-grid">
                <label className="clist-field">
                  <span>Exact status</span>
                  <select
                    className="campaign-filter-select"
                    aria-label="Filter by exact status"
                    value={statusFilter}
                    onChange={(e) => {
                      const next = e.target.value as StatusFilter;
                      setStatusFilter(next);
                      setListQueryParam("status", next);
                      if (next !== "all") {
                        const parent = statusBucketId(next);
                        if (parent) setBucket(parent);
                      }
                    }}
                  >
                    {STATUS_FILTERS.map((sf) => (
                      <option key={sf.value} value={sf.value}>
                        {sf.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="clist-check">
                  <input
                    type="checkbox"
                    checked={filter === "archived"}
                    onChange={(e) => setFilter(e.target.checked ? "archived" : "active")}
                  />
                  <span>Show archived</span>
                </label>
              </div>
              {statusFilter !== "all" ? (
                <p className="clist-hint">
                  Narrowed to {operatorStatusLabel(statusFilter)}. Each row still shows that status.
                </p>
              ) : null}
            </div>
          ) : null}

          {filtersOn ? (
            <div className="clist-chips">
              {query.trim() ? (
                <button type="button" className="clist-chip" onClick={() => setQuery("")}>
                  Search: {query.trim()} <span aria-hidden>×</span>
                </button>
              ) : null}
              {clientFilter !== "all" ? (
                <button type="button" className="clist-chip" onClick={() => setClientFilter("all")}>
                  {clientLabel(clientFilter)} <span aria-hidden>×</span>
                </button>
              ) : null}
              {ownerFilter !== "all" ? (
                <button type="button" className="clist-chip" onClick={() => setOwnerFilter("all")}>
                  {owners.find(([key]) => key === ownerFilter)?.[1] || "Owner"} <span aria-hidden>×</span>
                </button>
              ) : null}
              {bucket !== "open" ? (
                <button type="button" className="clist-chip" onClick={() => applyBucket("open")}>
                  {QUICK_FILTERS.find((item) => item.id === bucket)?.label || "Status"} <span aria-hidden>×</span>
                </button>
              ) : null}
              {monthFilter !== "all" ? (
                <button type="button" className="clist-chip" onClick={() => setMonthFilter("all")}>
                  {monthLabel(monthFilter)} <span aria-hidden>×</span>
                </button>
              ) : null}
              {statusFilter !== "all" ? (
                <button
                  type="button"
                  className="clist-chip"
                  onClick={() => {
                    setStatusFilter("all");
                    setListQueryParam("status", "all");
                  }}
                >
                  {operatorStatusLabel(statusFilter)} <span aria-hidden>×</span>
                </button>
              ) : null}
              {kindFilter !== "all" ? (
                <button
                  type="button"
                  className="clist-chip"
                  onClick={() => {
                    setKindFilter("all");
                    setListQueryParam("kind", "all");
                  }}
                >
                  {KIND_FILTERS.find((k) => k.value === kindFilter)?.label}{" "}
                  <span aria-hidden>×</span>
                </button>
              ) : null}
              {dateActive ? (
                <button
                  type="button"
                  className="clist-chip"
                  onClick={() => {
                    setDatePreset("any");
                    setDateFrom("");
                    setDateTo("");
                  }}
                >
                  Updated{" "}
                  {DATE_PRESETS.find((p) => p.value === datePreset)?.label.toLowerCase()}{" "}
                  <span aria-hidden>×</span>
                </button>
              ) : null}
              {filter === "archived" ? (
                <button type="button" className="clist-chip" onClick={() => setFilter("active")}>
                  Archived <span aria-hidden>×</span>
                </button>
              ) : null}
              <button type="button" className="clist-clear" onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          ) : null}

          <div className="dashboard-grid">
            <div className="stack" style={{ gap: 12 }}>
              {loading ? (
                <p className="muted">Loading...</p>
              ) : campaigns.length === 0 ? (
                filter === "archived" ? (
                  <div className="empty">
                    <p>No archived campaigns.</p>
                  </div>
                ) : (
                  <div className="empty">
                    <p>
                      {kindScope === "blog" ? "No blog posts yet." : "No campaigns yet."}
                    </p>
                    <Link className="btn" href="/admin/new" style={{ marginTop: 12 }}>
                      {kindScope === "blog"
                        ? "Create your first blog post"
                        : "Upload your first email"}
                    </Link>
                  </div>
                )
              ) : visible.length === 0 ? (
                <div className="empty">
                  <p>
                    {q
                      ? `No campaigns match “${query.trim()}”.`
                      : "No campaigns match these filters."}
                  </p>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ marginTop: 12 }}
                    onClick={clearFilters}
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                <div className="clist-table">
                  <div className="clist-cols clist-cols-head" aria-hidden="true">
                    <span>Client</span>
                    <span>Campaign</span>
                    <span>Status</span>
                    <span>Owner</span>
                    <span>Next send</span>
                    <span>Items</span>
                    <span />
                  </div>
                  {visible.map((c) => (
                    <CampaignRowView
                      key={c.id}
                      c={c}
                      filter={filter}
                      busyId={busyId}
                      onArchive={setArchived}
                      onRename={renameCampaign}
                    />
                  ))}
                </div>
              )}
            </div>
            <ActivitySidebar />
          </div>
        </div>
      </main>
    </div>
  );
}
