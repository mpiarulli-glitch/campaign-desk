"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { ActivitySidebar } from "@/components/ActivitySidebar";
import {
  compareDoneNewestFirst,
  doneSentInstant,
  isDoneCampaignStatus,
} from "@/lib/campaign-status";
import { ASSET_KINDS, isAssetKind, packageItemCountLabel, type AssetKind } from "@/lib/asset-kinds";

type DoneRow = {
  id: string;
  title: string;
  client_name: string;
  status: string;
  approved_channel?: string | null;
  updated_at: string;
  email_count?: number;
  email_kinds?: AssetKind[];
  presentation?: string;
  scheduled_send_at?: string | null;
  next_send_at?: string | null;
  next_send_upcoming?: boolean;
  owner?: string;
  owner_key?: string;
};

type TypeFilter = "all" | AssetKind;
type DatePreset = "any" | "7d" | "30d" | "90d" | "month";

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

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "any", label: "Any time" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "month", label: "This month" },
];

const NO_CLIENT = "__none__";
const SEND_ZONE = "America/Los_Angeles";
const SEND_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: SEND_ZONE,
});

function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function resolveDateBounds(preset: DatePreset, now = new Date()) {
  const end = ymdLocal(now);
  if (preset === "any") return { start: null as string | null, end: null as string | null };
  if (preset === "month") {
    return {
      start: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`,
      end,
    };
  }
  const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
  const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  return { start: ymdLocal(startDate), end };
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
  if (Number.isNaN(d.getTime())) return "No send date";
  return SEND_FORMAT.format(d);
}

function itemLabel(c: DoneRow): string {
  if (!c.email_count) return "No emails";
  return packageItemCountLabel(
    c.email_kinds?.length
      ? c.email_kinds
      : Array.from({ length: c.email_count }, () => "email" as AssetKind),
    { automation: c.presentation === "automation" }
  );
}

function DoneRowView({
  c,
  busyId,
  onArchive,
}: {
  c: DoneRow;
  busyId: string | null;
  onArchive: (id: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLSpanElement>(null);
  const sentAt = doneSentInstant(c);

  function swallow(e: React.MouseEvent) {
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

  return (
    <Link href={`/admin/campaigns/${c.id}`} className="clist-row">
      <span className="clist-client">{c.client_name.trim() || "No client"}</span>
      <span className="clist-name-wrap">
        <span className="clist-name">{c.title}</span>
      </span>
      <span className="clist-status">
        <StatusBadge status={c.status} approvedChannel={c.approved_channel} />
      </span>
      <span className="clist-owner">{c.owner || "Unassigned"}</span>
      <span className="clist-send">
        {sentAt ? formatSend(sentAt) : <span className="clist-quiet">No send date</span>}
      </span>
      <span className="clist-count-cell">{itemLabel(c)}</span>
      <span className="clist-actions" ref={menuRef} onClick={swallow}>
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
              disabled={busyId === c.id}
              onClick={(e) => {
                swallow(e);
                setMenuOpen(false);
                onArchive(c.id);
              }}
            >
              {busyId === c.id ? "..." : "Archive"}
            </button>
          </span>
        ) : null}
      </span>
    </Link>
  );
}

export default function DoneCampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<DoneRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("any");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const done = useMemo(
    () => campaigns.filter((c) => isDoneCampaignStatus(c.status)),
    [campaigns]
  );

  const load = useCallback(async () => {
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
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const bounds = resolveDateBounds(datePreset);
  const dated = done.filter((c) => {
    if (!bounds.start && !bounds.end) return true;
    const instant = doneSentInstant(c);
    if (!instant) return false;
    const day = ymdLocal(new Date(instant));
    if (bounds.start && day < bounds.start) return false;
    if (bounds.end && day > bounds.end) return false;
    return true;
  });
  const cliented =
    clientFilter === "all" ? dated : dated.filter((c) => clientKey(c.client_name) === clientFilter);
  const owned =
    ownerFilter === "all"
      ? cliented
      : cliented.filter((c) => (c.owner_key || "unassigned") === ownerFilter);
  const typed = owned.filter((c) => typeFilter === "all" || (c.email_kinds || []).includes(typeFilter));
  const q = query.trim().toLowerCase();
  const searched = q
    ? typed.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.client_name.toLowerCase().includes(q) ||
          (c.owner || "").toLowerCase().includes(q)
      )
    : typed;
  const visible = searched
    .slice()
    .sort((a, b) => compareDoneNewestFirst(doneSentInstant(a), doneSentInstant(b)));

  const clients = useMemo(() => {
    const keys = new Set(done.map((c) => clientKey(c.client_name)));
    return Array.from(keys).sort((a, b) => clientLabel(a).localeCompare(clientLabel(b)));
  }, [done]);

  const types = useMemo(() => {
    const present = new Set<AssetKind>();
    for (const c of done) {
      for (const kind of c.email_kinds || []) present.add(kind);
    }
    return ASSET_KINDS.filter((kind) => present.has(kind.kind));
  }, [done]);

  const owners = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of done) {
      const key = c.owner_key || "unassigned";
      if (!map.has(key)) map.set(key, c.owner || "Unassigned");
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [done]);

  const filtersOn =
    clientFilter !== "all" ||
    ownerFilter !== "all" ||
    typeFilter !== "all" ||
    datePreset !== "any" ||
    query.trim() !== "";

  function clearFilters() {
    setQuery("");
    setClientFilter("all");
    setOwnerFilter("all");
    setTypeFilter("all");
    setDatePreset("any");
  }

  async function archive(id: string) {
    setBusyId(id);
    const res = await fetch(`/api/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    setBusyId(null);
    if (!res.ok) {
      setError("Could not archive.");
      return;
    }
    setCampaigns((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <div className="app-shell">
      <main className="container container-wide stack clist-page">
        <div className="clist">
          <div className="clist-head">
            <h1 className="h1">Done</h1>
            <Link className="clist-done" href="/admin/campaigns">
              In progress
            </Link>
            <span className="clist-done is-current" aria-current="page">
              Done
              <span className="clist-done-count">{loading ? "—" : done.length}</span>
            </span>
          </div>

          {error ? <p className="error">{error}</p> : null}

          <div className="clist-bar">
            <label className="clist-field clist-search">
              <span>Search</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Campaign or client"
                aria-label="Search done campaigns by name or client"
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
              <span>Sent</span>
              <select
                className="campaign-filter-select"
                aria-label="Filter by when it was sent"
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
              ) : done.length === 0 ? (
                <div className="empty">
                  <p>No sent campaigns yet.</p>
                </div>
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
                    <span>Sent</span>
                    <span>Items</span>
                    <span />
                  </div>
                  {visible.map((c) => (
                    <DoneRowView key={c.id} c={c} busyId={busyId} onArchive={archive} />
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
