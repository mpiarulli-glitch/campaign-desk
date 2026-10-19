"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { ActivitySidebar } from "@/components/ActivitySidebar";
import {
  groupCampaignsByBoard,
  listStageFromStatusParam,
  matchesListBucket,
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

const STAGE_OPTIONS: { id: ListBucket; label: string }[] = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "in_progress", label: "In progress" },
  { id: "waiting", label: "Waiting on client" },
  { id: "ready", label: "Ready to send" },
  { id: "sent", label: "Sent" },
];

const VIEW_STORAGE_KEY = "cd-campaigns-view";
type CampaignView = "list" | "board";

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

function KindGlyph({ kind }: { kind: AssetKind }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  if (kind === "cold_email") {
    return (
      <svg {...common}>
        <rect x="1.5" y="3.5" width="11" height="8" rx="1.4" />
        <path d="M2 4.5 7 8.2 12 4.5" />
        <path d="M12.5 8.5 15 11M15 8.5 12.5 11" />
      </svg>
    );
  }
  if (kind === "linkedin") {
    return (
      <svg {...common}>
        <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
        <path d="M4.5 7v4.5M4.5 4.5h.01M7.5 11.5V8.2A1.6 1.6 0 0 1 11 8.2v3.3" />
      </svg>
    );
  }
  if (kind === "sms") {
    return (
      <svg {...common}>
        <path d="M3 3.5h10a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 13 11.5H7L3.5 14v-2.5H3A1.5 1.5 0 0 1 1.5 10V5A1.5 1.5 0 0 1 3 3.5Z" />
      </svg>
    );
  }
  if (kind === "interactive") {
    return (
      <svg {...common}>
        <rect x="2" y="2" width="12" height="12" rx="1.5" />
        <path d="M5 6h6M5 8.5h6M5 11h3.5" />
      </svg>
    );
  }
  if (kind === "blog") {
    return (
      <svg {...common}>
        <path d="M4 2.5h6L13 5.5V13.5H4Z" />
        <path d="M10 2.5V6h3M6 8.5h4M6 11h3" />
      </svg>
    );
  }
  if (kind === "copydeck") {
    return (
      <svg {...common}>
        <path d="M3 3.5h10M3 6.5h10M3 9.5h7M3 12.5h5" />
      </svg>
    );
  }
  if (kind === "mockup") {
    return (
      <svg {...common}>
        <rect x="2" y="2.5" width="12" height="11" rx="1.4" />
        <path d="M2 5.5h12" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" />
      <path d="M2 4.5 8 9l6-4.5" />
    </svg>
  );
}

function BoardCard({ c }: { c: CampaignRow }) {
  const kinds = Array.from(new Set(c.email_kinds || []));
  const sendAt = c.next_send_at || c.scheduled_send_at || null;
  return (
    <Link href={`/admin/campaigns/${c.id}`} className="cboard-card">
      <span className="cboard-client">{c.client_name.trim() || "No client"}</span>
      <span className="cboard-name">{c.title}</span>
      <span className="cboard-meta">
        {kinds.length ? (
          <span className="cboard-kinds">
            {kinds.map((kind) => (
              <span key={kind} className="cboard-kind" title={TYPE_LABEL[kind]} aria-label={TYPE_LABEL[kind]}>
                <KindGlyph kind={kind} />
              </span>
            ))}
          </span>
        ) : null}
        <span className="cboard-owner">{c.owner || "Unassigned"}</span>
      </span>
      <span className={sendAt ? "cboard-send" : "cboard-send is-quiet"}>
        {sendAt ? formatSend(sendAt) : "Not scheduled"}
      </span>
    </Link>
  );
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
  const [bucket, setBucket] = useState<BucketFilter>("all");
  const [view, setView] = useState<CampaignView>("list");
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
    bucket !== "all" ||
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
    setBucket("all");
    setDatePreset("any");
    if (filter === "archived") setFilter("active");
    replaceQuery((params) => {
      params.delete("status");
      params.delete("kind");
    });
  }

  function replaceQuery(mutate: (params: URLSearchParams) => void) {
    const url = new URL(window.location.href);
    mutate(url.searchParams);
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== current) window.history.replaceState(null, "", nextUrl);
  }

  function rememberView(next: CampaignView) {
    setView(next);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      /* Private browsing can block storage. The URL still records the view. */
    }
    replaceQuery((params) => {
      if (next === "board") params.set("view", "board");
      else params.delete("view");
    });
  }

  function chooseStage(next: BucketFilter) {
    setBucket(next);
    replaceQuery((params) => {
      if (next === "all") params.delete("status");
      else params.set("status", next);
    });
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

  // Old links pass an exact status or a stage id. Both select this dropdown.
  // ?view=board wins over the remembered view; otherwise localStorage does.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    if (status) {
      const stage = listStageFromStatusParam(status);
      if (stage) setBucket(stage);
    }
    const kind = params.get("kind");
    if (isAssetKind(kind)) setTypeFilter(kind);
    const requested = params.get("view");
    if (requested === "board" || requested === "list") {
      setView(requested);
      try {
        localStorage.setItem(VIEW_STORAGE_KEY, requested);
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      const stored = localStorage.getItem(VIEW_STORAGE_KEY);
      if (stored === "board" || stored === "list") setView(stored);
    } catch {
      /* ignore */
    }
  }, []);


  const board = groupCampaignsByBoard(visible);

  return (
    <div className="app-shell">
      <main className="container container-wide stack clist-page">
        <div className="clist">
          <div className="clist-head">
            <h1 className="h1">{kindScope === "blog" ? "Blog posts" : "Campaigns"}</h1>
            <div className="clist-view" role="group" aria-label="Campaign view">
              <button
                type="button"
                aria-pressed={view === "list"}
                onClick={() => rememberView("list")}
              >
                List
              </button>
              <button
                type="button"
                aria-pressed={view === "board"}
                onClick={() => rememberView("board")}
              >
                Board
              </button>
            </div>
            <Link className="btn btn-sm clist-new" href="/admin/new">
              {kindScope === "blog" ? "New blog post" : "New campaign"}
            </Link>
          </div>

          {error ? <p className="error">{error}</p> : null}

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
              <span>Stage</span>
              <select
                className="campaign-filter-select"
                aria-label="Filter by stage"
                value={bucket}
                onChange={(e) => chooseStage(e.target.value as BucketFilter)}
              >
                {STAGE_OPTIONS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
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
                  const type = isAssetKind(next) ? next : "all";
                  setTypeFilter(type);
                  replaceQuery((params) => {
                    if (type === "all") params.delete("kind");
                    else params.set("kind", type);
                  });
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
            <button
              type="button"
              className="clist-archived"
              aria-pressed={filter === "archived"}
              onClick={() => setFilter(filter === "archived" ? "active" : "archived")}
            >
              Archived
            </button>
            {filtersOn ? (
              <button type="button" className="clist-clear" onClick={clearFilters}>
                Clear
              </button>
            ) : null}
          </div>

          <div className={view === "board" ? "dashboard-grid clist-board-wrap" : "dashboard-grid"}>
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
              ) : view === "board" ? (
                <div className="clist-board" aria-label="Campaigns by stage">
                  {board.map((column) => (
                    <section
                      key={column.id}
                      className="clist-col"
                      aria-label={`${column.label}, ${column.items.length}`}
                    >
                      <header className="clist-col-head">
                        <h2>{column.label}</h2>
                        <span>{column.items.length}</span>
                      </header>
                      <div className="clist-col-cards">
                        {column.items.map((c) => (
                          <BoardCard key={c.id} c={c} />
                        ))}
                      </div>
                    </section>
                  ))}
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
            {view === "list" ? <ActivitySidebar /> : null}
          </div>
        </div>
      </main>
    </div>
  );
}
