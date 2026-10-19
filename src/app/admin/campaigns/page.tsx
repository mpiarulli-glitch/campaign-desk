"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { ActivitySidebar } from "@/components/ActivitySidebar";
import {
  matchesListBucket,
  statusBucketId,
  type ListBucket,
} from "@/lib/campaign-status";
import { ASSET_KINDS, isAssetKind, packageItemCountLabel, type AssetKind } from "@/lib/asset-kinds";
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

const SEND_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: SEND_ZONE,
});

type BucketFilter = ListBucket;
type TypeFilter = "all" | AssetKind;
type DatePreset = "any" | "7d" | "30d" | "90d" | "month";

// The stored type of a package is the kind of work inside it. There is no
// newsletter/promo/winback field. Package vs automation is a separate flag.
const TYPE_LABEL: Record<AssetKind, string> = {
  email: "Email",
  cold_email: "Cold email",
  linkedin: "LinkedIn",
  sms: "Text",
  interactive: "Form / quiz",
  blog: "Blog",
  copydeck: "Copy deck",
  mockup: "Mock-up",
};

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
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "month", label: "This month" },
];

const NO_CLIENT = "__none__";

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
  now = new Date()
): { start: string | null; end: string | null } {
  const end = ymdLocal(now);
  if (preset === "any") return { start: null, end: null };
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

function campaignMatchesType(c: CampaignRow, type: TypeFilter): boolean {
  if (type === "all") return true;
  return (c.email_kinds || []).includes(type);
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLSpanElement>(null);

  function swallow(e: React.MouseEvent | React.KeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  useEffect(() => {
    if (!menuOpen) return;
    function onPointer(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

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
      <span className="clist-actions" ref={menuRef} onClick={swallow}>
        {renaming ? null : (
          <>
            <button
              type="button"
              className="clist-menu-btn"
              aria-label={`Actions for ${c.title}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={(e) => {
                swallow(e);
                setMenuOpen((open) => !open);
              }}
            >
              <span aria-hidden="true">···</span>
            </button>
            {menuOpen ? (
              <span className="clist-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={(e) => {
                    swallow(e);
                    setMenuOpen(false);
                    setDraft(c.title);
                    setRenaming(true);
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={busyId === c.id}
                  onClick={(e) => {
                    swallow(e);
                    setMenuOpen(false);
                    onArchive(c.id, filter === "active");
                  }}
                >
                  {busyId === c.id ? "..." : filter === "active" ? "Archive" : "Restore"}
                </button>
              </span>
            ) : null}
          </>
        )}
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
  const [kindScope, setKindScope] = useState<CampaignKindScope | "all">("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("any");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const dateBounds = resolveDateBounds(datePreset);
  const dated = campaigns.filter((c) => matchesDateFilter(c, dateBounds));
  const cliented =
    clientFilter === "all"
      ? dated
      : dated.filter((c) => clientKey(c.client_name) === clientFilter);
  const owned =
    ownerFilter === "all"
      ? cliented
      : cliented.filter((c) => (c.owner_key || "unassigned") === ownerFilter);
  const typed = owned.filter((c) => campaignMatchesType(c, typeFilter));
  const q = query.trim().toLowerCase();
  const searched = q
    ? typed.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.client_name.toLowerCase().includes(q) ||
          (c.owner || "").toLowerCase().includes(q)
      )
    : typed;
  const visible =
    bucket === "all"
      ? searched
      : searched.filter((c) => matchesListBucket(c, bucket));

  const clients = useMemo(() => {
    const keys = new Set(campaigns.map((c) => clientKey(c.client_name)));
    return Array.from(keys).sort((a, b) =>
      clientLabel(a).localeCompare(clientLabel(b))
    );
  }, [campaigns]);

  const types = useMemo(() => {
    const present = new Set<AssetKind>();
    for (const c of campaigns) {
      for (const kind of c.email_kinds || []) present.add(kind);
    }
    return ASSET_KINDS.filter((kind) => present.has(kind.kind));
  }, [campaigns]);

  const owners = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of campaigns) {
      const key = c.owner_key || "unassigned";
      if (!map.has(key)) map.set(key, c.owner || "Unassigned");
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [campaigns]);

  useEffect(() => {
    if (clientFilter !== "all" && !clients.includes(clientFilter)) {
      setClientFilter("all");
    }
  }, [clients, clientFilter]);

  useEffect(() => {
    if (typeFilter !== "all" && !types.some((kind) => kind.kind === typeFilter)) {
      setTypeFilter("all");
    }
  }, [types, typeFilter]);

  const filtersOn =
    bucket !== "open" ||
    clientFilter !== "all" ||
    ownerFilter !== "all" ||
    typeFilter !== "all" ||
    datePreset !== "any" ||
    filter === "archived" ||
    query.trim() !== "";

  function clearFilters() {
    setQuery("");
    setClientFilter("all");
    setOwnerFilter("all");
    setTypeFilter("all");
    setBucket("open");
    setDatePreset("any");
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

  // Old links used an exact status. The pills are the only status control,
  // so a link lands on the group that status belongs to.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    if (status) {
      const parent = statusBucketId(status);
      if (parent) setBucket(parent);
    }
    const kind = params.get("kind");
    if (isAssetKind(kind)) setTypeFilter(kind);
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
              <p className="clist-sub">Open work first.</p>
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

          <div className="clist-quick">
            <div role="group" aria-label="Status">
              {QUICK_FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={bucket === item.id}
                  onClick={() => setBucket(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="clist-archived"
              aria-pressed={filter === "archived"}
              onClick={() => setFilter(filter === "archived" ? "active" : "archived")}
            >
              Archived
            </button>
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
            <label className="clist-field">
              <span>Type</span>
              <select
                className="campaign-filter-select"
                aria-label="Filter by type"
                value={typeFilter}
                onChange={(e) => {
                  const next = e.target.value;
                  setTypeFilter(isAssetKind(next) ? next : "all");
                }}
              >
                <option value="all">Any type</option>
                {types.map((kind) => (
                  <option key={kind.kind} value={kind.kind}>
                    {TYPE_LABEL[kind.kind]}
                  </option>
                ))}
              </select>
            </label>
            <label className="clist-field">
              <span>Updated</span>
              <select
                className="campaign-filter-select"
                aria-label="Filter by when it was updated"
                value={datePreset}
                onChange={(e) => setDatePreset(e.target.value as DatePreset)}
              >
                {DATE_PRESETS.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            {filtersOn ? (
              <button type="button" className="clist-clear" onClick={clearFilters}>
                Clear
              </button>
            ) : null}
          </div>

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
