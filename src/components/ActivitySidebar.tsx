"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { approvalActivityParts } from "@/lib/activity-copy";
import {
  ACTIVITY_HIDDEN_IDS_KEY,
  ACTIVITY_READ_IDS_KEY,
  activityItemKey,
  loadActivityIdSet,
  onActivityReadChange,
  relativeActivityTime,
  saveActivityIdSet,
  type ActivityFeedItem,
} from "@/lib/activity-read";

const COLLAPSED_KEY = "cd_activity_collapsed";

export function ActivitySidebar({ limit = 12 }: { limit?: number }) {
  const [items, setItems] = useState<ActivityFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  });

  useEffect(() => {
    function reloadLocal() {
      setReadIds(loadActivityIdSet(ACTIVITY_READ_IDS_KEY));
      setHiddenIds(loadActivityIdSet(ACTIVITY_HIDDEN_IDS_KEY));
    }
    reloadLocal();
    return onActivityReadChange(reloadLocal);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/activity")
      .then((res) => (res.ok ? res.json() : { activity: [] }))
      .then((data) => {
        if (active) setItems(data.activity || []);
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
      saveActivityIdSet(ACTIVITY_READ_IDS_KEY, next);
      return next;
    });
  }

  function hideItem(key: string) {
    setHiddenIds((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      saveActivityIdSet(ACTIVITY_HIDDEN_IDS_KEY, next);
      return next;
    });
  }

  const visible = items
    .filter((item) => !hiddenIds.has(activityItemKey(item)))
    .slice(0, limit);

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
      ) : visible.length === 0 ? (
        <div className="empty">No client activity yet.</div>
      ) : (
        <div className="activity-sidebar-list">
          {visible.map((item) => {
            const key = activityItemKey(item);
            const isRead = readIds.has(key);
            const approval = item.kind === "approved" ? approvalActivityParts(item) : null;
            return (
              <div key={key} className="activity-sidebar-row">
                <Link
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
                      {item.kind === "approved" && approval ? (
                        <>
                          <strong>{approval.actor}</strong> {approval.rest}
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
                      {item.campaign_title} · {relativeActivityTime(item.at)}
                    </span>
                  </span>
                </Link>
                <button
                  type="button"
                  className="activity-sidebar-dismiss"
                  aria-label="Hide this from the campaigns feed"
                  title="Hide this from the campaigns feed"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    hideItem(key);
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
