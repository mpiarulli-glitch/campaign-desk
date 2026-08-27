"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
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

const POLL_MS = 60_000;
const LIMIT = 12;

function BellIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

export function ActivityBell() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ActivityFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());

  const reloadLocal = useCallback(() => {
    setReadIds(loadActivityIdSet(ACTIVITY_READ_IDS_KEY));
    setHiddenIds(loadActivityIdSet(ACTIVITY_HIDDEN_IDS_KEY));
  }, []);

  useEffect(() => {
    reloadLocal();
    setReady(true);
    return onActivityReadChange(reloadLocal);
  }, [reloadLocal]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/activity");
      const data = res.ok ? await res.json() : { activity: [] };
      setItems(Array.isArray(data.activity) ? data.activity : []);
    } catch {
      // Leave whatever we last showed.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let on = true;
    load();
    const tick = () => {
      if (!on) return;
      if (document.visibilityState === "hidden") return;
      void load();
    };
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      on = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    void load();
    function onDoc(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, load]);

  function markRead(key: string) {
    setReadIds((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      saveActivityIdSet(ACTIVITY_READ_IDS_KEY, next);
      return next;
    });
  }

  function markAllRead(keys: string[]) {
    setReadIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const key of keys) {
        if (!next.has(key)) {
          next.add(key);
          changed = true;
        }
      }
      if (changed) saveActivityIdSet(ACTIVITY_READ_IDS_KEY, next);
      return changed ? next : prev;
    });
  }

  const visible = items
    .filter((item) => !hiddenIds.has(activityItemKey(item)))
    .slice(0, LIMIT);
  const unreadKeys = visible
    .map(activityItemKey)
    .filter((key) => !readIds.has(key));
  const unread = ready ? unreadKeys.length : 0;
  const label =
    unread > 0
      ? `Activity, ${unread} unread`
      : "Activity";

  return (
    <div ref={wrapRef} className="app-bell-wrap">
      <button
        type="button"
        className="app-iconbtn app-bell"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
      >
        <BellIcon />
        {unread > 0 ? (
          <span className="app-bell-badge">{unread > 9 ? "9+" : unread}</span>
        ) : null}
      </button>
      {open ? (
        <div className="app-notif" role="dialog" aria-label="Activity">
          <div className="app-notif-head">
            <span>Activity</span>
            {unread > 0 ? (
              <button
                type="button"
                className="app-notif-mark"
                onClick={() => markAllRead(unreadKeys)}
              >
                Mark all read
              </button>
            ) : null}
          </div>
          {loading && visible.length === 0 ? (
            <p className="app-notif-empty">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="app-notif-empty">No client activity yet.</p>
          ) : (
            <div className="app-notif-list">
              {visible.map((item) => {
                const key = activityItemKey(item);
                const isRead = readIds.has(key);
                const approval =
                  item.kind === "approved" ? approvalActivityParts(item) : null;
                return (
                  <Link
                    key={key}
                    href={`/admin/campaigns/${item.campaign_id}`}
                    className={
                      isRead ? "app-notif-item is-read" : "app-notif-item"
                    }
                    onClick={() => {
                      markRead(key);
                      setOpen(false);
                    }}
                  >
                    <span
                      aria-hidden
                      className="activity-dot"
                      style={{
                        background:
                          item.kind === "approved" ? "#16a34a" : "#2563eb",
                      }}
                    />
                    <span className="app-notif-text">
                      <span className="app-notif-line">
                        {item.kind === "approved" && approval ? (
                          <>
                            <strong>{approval.actor}</strong> {approval.rest}
                            {item.star_rating ? ` (${item.star_rating}★)` : ""}
                          </>
                        ) : (
                          <>
                            <strong>{item.actor || "Reviewer"}</strong>
                            {item.body ? `: ${item.body}` : " left feedback"}
                          </>
                        )}
                      </span>
                      <span className="app-notif-meta">
                        {item.campaign_title} · {relativeActivityTime(item.at)}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
          <Link
            href="/admin/activity"
            className="app-notif-foot"
            onClick={() => setOpen(false)}
          >
            View all activity
          </Link>
        </div>
      ) : null}
    </div>
  );
}
