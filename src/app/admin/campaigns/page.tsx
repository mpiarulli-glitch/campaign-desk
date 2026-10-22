"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { ActivitySidebar } from "@/components/ActivitySidebar";
import {
  groupCampaignsByBoard,
  isDoneCampaignStatus,
  isDoneListStatus,
  isListStatusFilter,
  LIST_STATUS_OPTIONS,
  matchesCampaignStatusFilter,
  operatorStatusLabel,
  resolveListStatusFilter,
  type ListStatusFilter,
} from "@/lib/campaign-status";
import {
  ACCOUNT_MANAGER_REVIEW_SECTIONS,
  accountManagerQueueNote,
  campaignInAccountManagerQueue,
  isCampaignAccountManagerSlug,
} from "@/lib/campaign-review-queue";
import {
  emptyCampaignListFilters,
  isCampaignListUpdated,
  readCampaignListFilters,
  resolveListKindFilter,
  writeCampaignListFilters,
  type CampaignListFilterState,
  type CampaignListUpdated,
} from "@/lib/campaign-list-filters";
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
  internal_revision_authors?: string;
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
  review_assignee?: string;
};

const SEND_ZONE = "America/Los_Angeles";

const SEND_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: SEND_ZONE,
});

type TypeFilter = "all" | AssetKind;
type DatePreset = CampaignListUpdated;

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

const VIEW_STORAGE_KEY = "cd-campaigns-view";
type CampaignView = "list" | "board" | "review";
type CampaignScope = "mine" | "approved";

function isCampaignView(value: string | null): value is CampaignView {
  return value === "list" || value === "board" || value === "review";
}

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

const SOON_MS = 7 * 24 * 60 * 60 * 1000;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "–";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function avatarTone(name: string): string {
  let hash = 0;
  for (const char of name.trim().toLowerCase()) hash = (hash + char.charCodeAt(0) * 17) % 6;
  return String(hash);
}

function sendChip(
  iso: string | null,
  upcoming: boolean
): { label: string; tone: "soon" | "overdue" | "later" | "past" } | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return null;
  const label = formatSend(iso);
  if (!upcoming) return { label, tone: "past" };
  const delta = time - Date.now();
  if (delta < 0) return { label, tone: "overdue" };
  if (delta <= SOON_MS) return { label, tone: "soon" };
  return { label, tone: "later" };
}

function BoardCard({ c }: { c: CampaignRow }) {
  const client = c.client_name.trim() || "No client";
  const owner = c.owner || "Unassigned";
  const kinds = Array.from(new Set(c.email_kinds || []));
  const sendAt = c.next_send_at || c.scheduled_send_at || null;
  const upcoming = c.next_send_at ? Boolean(c.next_send_upcoming) : false;
  const chip = sendChip(sendAt, upcoming);
  const chipLabel = chip
    ? chip.tone === "soon"
      ? `Soon · ${chip.label}`
      : chip.tone === "overdue"
        ? `Overdue · ${chip.label}`
        : chip.tone === "past"
          ? `Sent · ${chip.label}`
          : chip.label
    : null;

  return (
    <Link href={`/admin/campaigns/${c.id}`} className="cboard-card">
      <span className="cboard-who">
        <span className="cboard-avatar" data-tone={avatarTone(client)} aria-hidden="true">
          {initials(client)}
        </span>
        <span className="cboard-client">{client}</span>
      </span>
      <span className="cboard-name">{c.title}</span>
      <span className="cboard-foot">
        {kinds.length ? (
          <span className="cboard-kinds">
            {kinds.map((kind) => (
              <span key={kind} className="cboard-kind" title={TYPE_LABEL[kind]}>
                <KindGlyph kind={kind} />
                {TYPE_LABEL[kind]}
              </span>
            ))}
          </span>
        ) : (
          <span />
        )}
        <span
          className="cboard-owner"
          data-tone={avatarTone(owner)}
          title={owner}
          aria-label={`Owner ${owner}`}
        >
          {initials(owner)}
        </span>
      </span>
      {chip && chipLabel ? (
        <span className={`cboard-send is-${chip.tone}`}>
          {chipLabel}
        </span>
      ) : null}
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
  href,
  queueNote,
}: {
  c: CampaignRow;
  filter: "active" | "archived";
  busyId: string | null;
  onArchive: (id: string, archived: boolean) => void;
  onRename: (id: string, title: string) => Promise<void>;
  href?: string;
  queueNote?: string | null;
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
    <Link href={href || `/admin/campaigns/${c.id}`} className="clist-row">
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
        {queueNote ? <span className="clist-status-note">{queueNote}</span> : null}
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
  const [statusFilter, setStatusFilter] = useState<ListStatusFilter>("all");
  const [view, setView] = useState<CampaignView>("list");
  const [scope, setScope] = useState<CampaignScope>("mine");
  const [viewerSlug, setViewerSlug] = useState<string | null>(null);
  const [viewerIsAccountManager, setViewerIsAccountManager] = useState(false);
  const [kindScope, setKindScope] = useState<CampaignKindScope | "all">("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("any");
  const filtersRef = useRef<CampaignListFilterState>(emptyCampaignListFilters());
  filtersRef.current = {
    status: statusFilter,
    client: clientFilter,
    owner: ownerFilter,
    type: typeFilter,
    updated: datePreset,
  };
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [doneCount, setDoneCount] = useState<number | null>(null);

  const pool = useMemo(
    () =>
      filter === "archived" || scope === "approved"
        ? campaigns
        : campaigns.filter((c) => !isDoneCampaignStatus(c.status)),
    [campaigns, filter, scope]
  );
  const dateBounds = resolveDateBounds(datePreset);
  const dated = pool.filter((c) => matchesDateFilter(c, dateBounds));
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
    statusFilter === "all"
      ? searched
      : searched.filter((c) => matchesCampaignStatusFilter(c, statusFilter));

  const clients = useMemo(() => {
    const keys = new Set(pool.map((c) => clientKey(c.client_name)));
    if (clientFilter !== "all") keys.add(clientFilter);
    return Array.from(keys).sort((a, b) =>
      clientLabel(a).localeCompare(clientLabel(b))
    );
  }, [pool, clientFilter]);

  const types = useMemo(() => {
    const present = new Set<AssetKind>();
    for (const c of pool) {
      for (const kind of c.email_kinds || []) present.add(kind);
    }
    if (isAssetKind(typeFilter)) present.add(typeFilter);
    return ASSET_KINDS.filter((kind) => present.has(kind.kind));
  }, [pool, typeFilter]);

  const owners = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of pool) {
      const key = c.owner_key || "unassigned";
      if (!map.has(key)) map.set(key, c.owner || "Unassigned");
    }
    if (ownerFilter !== "all" && !map.has(ownerFilter)) {
      map.set(
        ownerFilter,
        ownerFilter === "unassigned" ? "Unassigned" : ownerFilter
      );
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [pool, ownerFilter]);

  function rememberFilters(next: CampaignListFilterState) {
    filtersRef.current = next;
    writeCampaignListFilters(
      typeof window === "undefined" ? null : window.localStorage,
      next
    );
  }

  const filtersOn =
    statusFilter !== "all" ||
    clientFilter !== "all" ||
    ownerFilter !== "all" ||
    typeFilter !== "all" ||
    datePreset !== "any" ||
    filter === "archived" ||
    query.trim() !== "";

  function clearFilters() {
    const next = emptyCampaignListFilters();
    setQuery("");
    setClientFilter(next.client);
    setOwnerFilter(next.owner);
    setTypeFilter(next.type);
    setStatusFilter(next.status);
    setDatePreset(next.updated);
    if (filter === "archived") setFilter("active");
    rememberFilters(next);
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

  function chooseScope(next: CampaignScope) {
    setScope(next);
    replaceQuery((params) => {
      if (next === "mine") params.delete("scope");
      else params.set("scope", "approved");
    });
  }

  function rememberView(next: CampaignView) {
    setView(next);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      /* Private browsing can block storage. The URL still records the view. */
    }
    replaceQuery((params) => {
      if (next === "list") params.delete("view");
      else params.set("view", next);
    });
  }

  function chooseStatus(value: string) {
    const next: ListStatusFilter =
      value === "all" || isListStatusFilter(value) ? value : "all";
    setStatusFilter(next);
    rememberFilters({ ...filtersRef.current, status: next });
    replaceQuery((params) => {
      if (next === "all") params.delete("status");
      else params.set("status", next);
    });
  }

  function chooseClient(next: string) {
    setClientFilter(next);
    rememberFilters({ ...filtersRef.current, client: next });
  }

  function chooseOwner(next: string) {
    setOwnerFilter(next);
    rememberFilters({ ...filtersRef.current, owner: next });
  }

  function chooseType(value: string) {
    const next: TypeFilter = isAssetKind(value) ? value : "all";
    setTypeFilter(next);
    rememberFilters({ ...filtersRef.current, type: next });
    replaceQuery((params) => {
      if (next === "all") params.delete("kind");
      else params.set("kind", next);
    });
  }

  function chooseUpdated(value: string) {
    const next: DatePreset = isCampaignListUpdated(value) ? value : "any";
    setDatePreset(next);
    rememberFilters({ ...filtersRef.current, updated: next });
  }

  const load = useCallback(async (
    nextFilter: "active" | "archived",
    nextScope: CampaignScope,
    opts?: { silent?: boolean }
  ) => {
    if (!opts?.silent) setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (nextFilter === "archived") params.set("archived", "1");
    if (nextScope === "approved") params.set("approved", "mine");
    const qs = params.toString();
    const res = await fetch(`/api/campaigns${qs ? `?${qs}` : ""}`);
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
    const rows = (data.campaigns || []) as CampaignRow[];
    if (nextFilter === "active" && nextScope === "mine") {
      setDoneCount(rows.filter((c) => isDoneCampaignStatus(c.status)).length);
    }
    setCampaigns(rows);
    const scope = isCampaignKindScope(data.scope) ? data.scope : "all";
    setKindScope(scope);
    const slug = typeof data.viewer?.slug === "string" ? data.viewer.slug : null;
    setViewerSlug(slug);
    setViewerIsAccountManager(
      Boolean(data.viewer?.accountManager) || isCampaignAccountManagerSlug(slug)
    );
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
    load(filter, scope, { silent: true });
  }

  useEffect(() => {
    void load(filter, scope);
  }, [filter, scope, load]);

  // ?status= selects one workflow status. Sent and Live go to Done.
  // "all" and the older "open" alias clear it. A leftover stage id is ignored
  // so a saved status can still apply. Dropdowns restore from this browser
  // when the URL does not name them. ?view= wins over the saved view.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedScope: CampaignScope =
      params.get("scope") === "approved" ? "approved" : "mine";
    setScope(requestedScope);
    const status = params.get("status");
    if (status && isDoneListStatus(status) && requestedScope !== "approved") {
      router.replace("/admin/campaigns/done");
      return;
    }
    const saved = readCampaignListFilters(window.localStorage);
    const nextStatus = resolveListStatusFilter(status, saved.status);
    if (nextStatus === "done") {
      router.replace("/admin/campaigns/done");
      return;
    }
    const nextType = resolveListKindFilter(params.get("kind"), saved.type);
    const nextClient = saved.client || "all";
    const nextOwner = saved.owner || "all";
    const nextUpdated: DatePreset = saved.updated ?? "any";
    setStatusFilter(nextStatus);
    setTypeFilter(nextType);
    setClientFilter(nextClient);
    setOwnerFilter(nextOwner);
    setDatePreset(nextUpdated);
    rememberFilters({
      status: nextStatus,
      client: nextClient,
      owner: nextOwner,
      type: nextType,
      updated: nextUpdated,
    });
    replaceQuery((query) => {
      if (nextStatus === "all") query.delete("status");
      else query.set("status", nextStatus);
      if (nextType === "all") query.delete("kind");
      else query.set("kind", nextType);
    });
    const requested = params.get("view");
    if (isCampaignView(requested)) {
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
      if (isCampaignView(stored)) setView(stored);
    } catch {
      /* ignore */
    }
  }, [router]);


  const showReviewTab = viewerIsAccountManager && scope === "mine";
  const listingView: CampaignView = scope === "approved" ? "list" : view;
  const inMyQueue = (c: CampaignRow) =>
    Boolean(viewerSlug) && campaignInAccountManagerQueue(c, viewerSlug!);
  const reviewPool = searched.filter(inMyQueue);
  const reviewVisible = visible.filter(inMyQueue);

  useEffect(() => {
    if (loading || viewerIsAccountManager || scope === "mine") return;
    setScope("mine");
    replaceQuery((params) => {
      params.delete("scope");
    });
  }, [loading, viewerIsAccountManager, scope]);

  useEffect(() => {
    if (loading || view !== "review" || viewerIsAccountManager) return;
    setView("list");
    try {
      if (localStorage.getItem(VIEW_STORAGE_KEY) === "review") {
        localStorage.setItem(VIEW_STORAGE_KEY, "list");
      }
    } catch {
      /* ignore */
    }
    replaceQuery((params) => {
      if (params.get("view") === "review") params.delete("view");
    });
  }, [loading, view, viewerIsAccountManager]);

  const board = groupCampaignsByBoard(visible);

  return (
    <div className="app-shell">
      <main className="container container-wide stack clist-page">
        <div className="clist">
          <div className="clist-head">
            <h1 className="h1">{kindScope === "blog" ? "Blog posts" : "Campaigns"}</h1>
            {viewerIsAccountManager ? (
              <div className="clist-view" role="group" aria-label="Which campaigns">
                <button
                  type="button"
                  aria-pressed={scope === "mine"}
                  onClick={() => chooseScope("mine")}
                >
                  My campaigns
                </button>
                <button
                  type="button"
                  aria-pressed={scope === "approved"}
                  onClick={() => chooseScope("approved")}
                >
                  Approved by me
                </button>
              </div>
            ) : null}
            {scope === "mine" ? (
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
                {showReviewTab ? (
                  <button
                    type="button"
                    aria-pressed={view === "review"}
                    aria-label="Campaigns needing your review"
                    onClick={() => rememberView("review")}
                  >
                    Needs your review
                  </button>
                ) : null}
              </div>
            ) : null}
            <Link className="clist-done" href="/admin/campaigns/done">
              Done
              {doneCount != null ? <span className="clist-done-count">{doneCount}</span> : null}
            </Link>
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
              <span>Status</span>
              <select
                className="campaign-filter-select"
                aria-label="Filter by status"
                value={statusFilter}
                onChange={(e) => chooseStatus(e.target.value)}
              >
                <option value="all">All</option>
                {LIST_STATUS_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
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
                onChange={(e) => chooseClient(e.target.value)}
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
                onChange={(e) => chooseOwner(e.target.value)}
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
                onChange={(e) => chooseType(e.target.value)}
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
                onChange={(e) => chooseUpdated(e.target.value)}
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

          <div className={listingView === "board" ? "dashboard-grid clist-board-wrap" : "dashboard-grid"}>
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
                      {viewerIsAccountManager
                        ? scope === "approved"
                          ? "Campaigns you mark Approved Internally show up here."
                          : "Campaigns appear here after they're sent to you for review, or after you leave revisions. Once you approve one, it moves to Approved by me."
                        : kindScope === "blog"
                          ? "No blog posts yet."
                          : "No campaigns yet."}
                    </p>
                    {viewerIsAccountManager ? null : (
                      <Link className="btn" href="/admin/new" style={{ marginTop: 12 }}>
                        {kindScope === "blog"
                          ? "Create your first blog post"
                          : "Upload your first email"}
                      </Link>
                    )}
                  </div>
                )
              ) : listingView === "review" ? (
                reviewPool.length === 0 ? (
                  <div className="empty">
                    <p>Nothing needs your review right now.</p>
                  </div>
                ) : reviewVisible.length === 0 ? (
                  <div className="empty">
                    <p>
                      {statusFilter === "all"
                        ? "No campaigns match these filters."
                        : `Nothing in this view matches ${operatorStatusLabel(statusFilter)}. Set Status to All to see every campaign that needs you.`}
                    </p>
                  </div>
                ) : (
                  <div className="clist-queue" aria-label="Campaigns needing your review">
                    {ACCOUNT_MANAGER_REVIEW_SECTIONS.filter(
                      (section) =>
                        statusFilter === "all" ||
                        matchesCampaignStatusFilter(
                          { status: section.status },
                          statusFilter
                        )
                    ).map((section) => {
                      const items = reviewVisible.filter(
                        (c) => c.status === section.status
                      );
                      return (
                        <section
                          key={section.id}
                          className="clist-queue-section"
                          aria-label={section.title}
                        >
                          <div className="clist-queue-head">
                            <h2>{section.title}</h2>
                            <span className="clist-queue-count">{items.length}</span>
                          </div>
                          <p className="clist-queue-note">{section.note}</p>
                          {items.length === 0 ? (
                            <p className="clist-queue-empty">None</p>
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
                              {items.map((c) => (
                                <CampaignRowView
                                  key={c.id}
                                  c={c}
                                  filter={filter}
                                  busyId={busyId}
                                  onArchive={setArchived}
                                  onRename={renameCampaign}
                                  href={`/review/${c.magic_token}`}
                                  queueNote={accountManagerQueueNote(c.status)}
                                />
                              ))}
                            </div>
                          )}
                        </section>
                      );
                    })}
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
              ) : listingView === "board" ? (
                <div className="clist-board" aria-label="Campaigns by stage">
                  {board.map((column) => (
                    <section
                      key={column.id}
                      className="clist-col"
                      data-stage={column.id}
                      aria-label={`${column.label}, ${column.items.length}`}
                    >
                      <header className="clist-col-head">
                        <h2>{column.label}</h2>
                        <span className="clist-col-count">{column.items.length}</span>
                      </header>
                      <div className="clist-col-cards">
                        {column.items.length ? (
                          column.items.map((c) => <BoardCard key={c.id} c={c} />)
                        ) : (
                          <p className="clist-col-empty">None yet</p>
                        )}
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
            {scope === "mine" && listingView === "list" ? <ActivitySidebar /> : null}
          </div>
        </div>
      </main>
    </div>
  );
}
