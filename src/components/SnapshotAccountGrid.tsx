"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type SnapshotAccountCard = {
  id: string;
  name: string;
  deliverable_count: number;
  behind_count: number;
  status: "active" | "behind";
  logo_url: string | null;
  website: string;
  category: string;
  description: string;
};

const FAVORITES_KEY = "snapshot-account-favorites";

const AVATAR_COLORS = [
  "#d98b2b",
  "#3b82f6",
  "#10b981",
  "#8b5cf6",
  "#ef4444",
  "#0ea5e9",
  "#f59e0b",
  "#ec4899",
];

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function avatarColor(name: string): string {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

function readFavorites(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeFavorites(ids: Set<string>) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...ids]));
}

function ClientLogo({
  name,
  logoUrl,
  editable,
  busy,
  onPick,
}: {
  name: string;
  logoUrl: string | null;
  editable?: boolean;
  busy?: boolean;
  onPick?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = logoUrl && !failed;

  const inner = showImage ? (
    <img src={logoUrl} alt="" width={40} height={40} onError={() => setFailed(true)} />
  ) : (
    initials(name)
  );

  if (!editable) {
    if (showImage) {
      return (
        <span className="snap-pick-logo">
          {inner}
        </span>
      );
    }
    return (
      <span
        className="snap-pick-logo is-initials"
        style={{ background: avatarColor(name) }}
        aria-hidden="true"
      >
        {inner}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`snap-pick-logo-btn ${showImage ? "" : "is-initials"}`}
      style={showImage ? undefined : { background: avatarColor(name) }}
      title={busy ? "Uploading…" : "Upload logo"}
      aria-label={`Upload logo for ${name}`}
      disabled={busy}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onPick?.();
      }}
    >
      {inner}
      <span className="snap-pick-logo-overlay">{busy ? "…" : "+"}</span>
    </button>
  );
}

function StarButton({
  active,
  name,
  onToggle,
}: {
  active: boolean;
  name: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`snap-pick-star ${active ? "is-on" : ""}`}
      aria-label={active ? `Unfavorite ${name}` : `Favorite ${name}`}
      aria-pressed={active}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
    >
      <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true">
        <path
          d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
          fill={active ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function SnapshotAccountCard({
  account,
  favorited,
  onToggleFavorite,
  isAdmin,
  onLogoUploaded,
}: {
  account: SnapshotAccountCard;
  favorited: boolean;
  onToggleFavorite: () => void;
  isAdmin?: boolean;
  onLogoUploaded: (id: string, logoUrl: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState(account.logo_url);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setLogoUrl(account.logo_url);
  }, [account.logo_url]);

  async function upload(file: File) {
    setUploading(true);
    try {
      const body = new FormData();
      body.append("logo", file);
      const res = await fetch(`/api/revenue/clients/${account.id}/logo`, {
        method: "POST",
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "Could not upload that logo.");
        return;
      }
      const next = typeof data.logo_url === "string" ? data.logo_url : null;
      setLogoUrl(next);
      onLogoUploaded(account.id, next);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const metric =
    account.deliverable_count === 1
      ? "1 Deliverable"
      : `${account.deliverable_count} Deliverables`;

  return (
    <Link href={`/admin/snapshot/${account.id}`} className="snap-pick-card">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <div className="snap-pick-card-head">
        <ClientLogo
          name={account.name}
          logoUrl={logoUrl}
          editable={isAdmin}
          busy={uploading}
          onPick={() => inputRef.current?.click()}
        />
        <div className="snap-pick-card-title">
          <h3>{account.name}</h3>
          {account.category ? <p className="snap-pick-card-cat">{account.category}</p> : null}
        </div>
        <StarButton active={favorited} name={account.name} onToggle={onToggleFavorite} />
      </div>
      <p className="snap-pick-card-desc">{account.description}</p>
      <div className="snap-pick-card-foot">
        <span className="snap-pick-metric">{metric}</span>
        <span
          className={`snap-pick-status ${account.status === "active" ? "is-active" : "is-behind"}`}
        >
          {account.status === "active" ? "Active" : "Needs attention"}
        </span>
      </div>
    </Link>
  );
}

export function SnapshotAccountGrid({
  accounts: initialAccounts,
  isAdmin,
}: {
  accounts: SnapshotAccountCard[];
  isAdmin?: boolean;
}) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  useEffect(() => {
    setAccounts(initialAccounts);
  }, [initialAccounts]);

  useEffect(() => {
    setFavorites(readFavorites());
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeFavorites(next);
      return next;
    });
  }, []);

  const onLogoUploaded = useCallback((id: string, logoUrl: string | null) => {
    setAccounts((rows) =>
      rows.map((r) => (r.id === id ? { ...r, logo_url: logoUrl } : r))
    );
  }, []);

  const sorted = useMemo(() => {
    return [...accounts].sort((a, b) => {
      const af = favorites.has(a.id) ? 0 : 1;
      const bf = favorites.has(b.id) ? 0 : 1;
      if (af !== bf) return af - bf;
      return a.name.localeCompare(b.name);
    });
  }, [accounts, favorites]);

  return (
    <div className="snap-pick-grid">
      {sorted.map((account) => (
        <SnapshotAccountCard
          key={account.id}
          account={account}
          favorited={favorites.has(account.id)}
          onToggleFavorite={() => toggleFavorite(account.id)}
          isAdmin={isAdmin}
          onLogoUploaded={onLogoUploaded}
        />
      ))}
    </div>
  );
}
