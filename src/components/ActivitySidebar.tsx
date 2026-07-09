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

export function ActivitySidebar({ limit = 12 }: { limit?: number }) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <aside className="card card-pad stack activity-sidebar">
      <div
        className="row"
        style={{ justifyContent: "space-between", alignItems: "center" }}
      >
        <h2 className="h2" style={{ margin: 0 }}>
          Recent activity
        </h2>
        <Link className="btn btn-ghost btn-sm" href="/admin/activity">
          View all
        </Link>
      </div>

      {loading ? (
        <p className="muted" style={{ margin: 0 }}>
          Loading...
        </p>
      ) : items.length === 0 ? (
        <div className="empty">No client activity yet.</div>
      ) : (
        <div className="activity-sidebar-list">
          {items.map((item) => (
            <Link
              key={`${item.kind}-${item.id}`}
              href={`/admin/campaigns/${item.campaign_id}`}
              className="activity-sidebar-item"
            >
              <span
                aria-hidden
                className="activity-dot"
                style={{
                  background: item.kind === "approved" ? "#16a34a" : "#2563eb",
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
          ))}
        </div>
      )}
    </aside>
  );
}
