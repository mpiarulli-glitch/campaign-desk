"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ActivityItem = {
  kind: "feedback" | "approved";
  id: string;
  campaign_id: string;
  campaign_title: string;
  client_name: string;
  actor: string | null;
  body: string | null;
  comment_type: "general" | "inline" | null;
  email_title: string | null;
  resolved: number | null;
  star_rating: number | null;
  attachment_count: number;
  at: string;
};

function relativeTime(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const READ_IDS_KEY = "cd_activity_read_ids";
const COLLAPSED_KEY = "cd_activity_collapsed";

function loadReadIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(READ_IDS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveReadIds(ids: Set<string>) {
  try {
    window.localStorage.setItem(READ_IDS_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore storage failures
  }
}

export function ActivitySidebar({ limit = 12 }: { limit?: number }) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  });

  useEffect(() => {
    setReadIds(loadReadIds());
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/activity")
      .then((res) => (res.ok ? res.json() : { activity: [] }))
      .then((data) => {
        if (active) setItems((data.activity || []).slice(0, limit));
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [limit]);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // ignore storage failures
      }
      return next;
    });
  }

  function markRead(key: string) {
    setReadIds((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      saveReadIds(next);
      return next;
    });
  }

  return (
    <aside className="card card-pad stack activity-sidebar">
      <div
        className="row"
        style={{ justifyContent: "space-between", alignItems: "center" }}
      >
        <button
          type="button"
          className="activity-sidebar-toggle"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand recent activity" : "Collapse recent activity"}
        >
          <span
            aria-hidden
            className="activity-sidebar-chevron"
            style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
          >
            ▾
          </span>
          <h2 className="h2" style={{ margin: 0 }}>
            Recent activity
          </h2>
        </button>
        <Link className="btn btn-ghost btn-sm" href="/admin/activity">
          View all
        </Link>
      </div>

      {collapsed ? null : loading ? (
        <p className="muted" style={{ margin: 0 }}>
          Loading...
        </p>
      ) : items.length === 0 ? (
        <div className="empty">No client activity yet.</div>
      ) : (
        <div className="activity-sidebar-list">
          {items.map((item) => {
            const key = `${item.kind}-${item.id}`;
            const isRead = readIds.has(key);
            return (
              <Link
                key={key}
                href={`/admin/campaigns/${item.campaign_id}`}
                className={
                  isRead
                    ? "activity-sidebar-item activity-sidebar-item--read"
                    : "activity-sidebar-item"
                }
                onClick={() => markRead(key)}
              >
                <span
                  aria-hidden
                  className="activity-dot"
                  style={{
                    background:
                      item.kind === "approved" ? "#16a34a" : "#2563eb",
                  }}
                />
                <span className="activity-sidebar-text">
                  <span className="activity-sidebar-line">
                    {item.kind === "approved" ? (
                      <>
                        <strong>{item.client_name || "Client"}</strong> approved{" "}
                        {item.campaign_title}
                        {item.star_rating ? ` (${item.star_rating}★)` : ""}
                      </>
                    ) : (
                      <>
                        <strong>{item.actor || "Reviewer"}</strong>
                        {item.body ? `: ${item.body}` : " left feedback"}
                        {item.attachment_count > 0
                          ? ` 📎${item.attachment_count}`
                          : ""}
                      </>
                    )}
                  </span>
                  <span className="activity-sidebar-meta">
                    {item.campaign_title} · {relativeTime(item.at)}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </aside>
  );
}
