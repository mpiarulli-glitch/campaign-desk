"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand } from "@/components/Brand";
import { NavMenu } from "@/components/NavMenu";

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
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function ActivityPage() {
  const router = useRouter();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "feedback" | "approved">("all");

  async function load() {
    setLoading(true);
    setError("");
    const res = await fetch("/api/activity");
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) {
      setError("Failed to load activity.");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setItems(data.activity || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const shown = items.filter((i) => filter === "all" || i.kind === filter);

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand href="/admin" />
        <div className="row">
          <Link className="btn" href="/admin/new">
            New campaign
          </Link>
          <NavMenu current="/admin/activity" />
        </div>
      </header>

      <main className="container stack">
        <div className="page-hero">
          <p className="eyebrow">Dashboard</p>
          <h1 className="h1">Client activity</h1>
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
            Every piece of client feedback and approval across all campaigns,
            newest first.
          </p>
        </div>

        <div className="row" style={{ gap: 8 }}>
          {(["all", "feedback", "approved"] as const).map((f) => (
            <button
              key={f}
              className={`btn btn-sm ${filter === f ? "" : "btn-ghost"}`}
              onClick={() => setFilter(f)}
            >
              {f === "all"
                ? "All activity"
                : f === "feedback"
                  ? "Feedback"
                  : "Approvals"}
            </button>
          ))}
        </div>

        {error ? <p className="error">{error}</p> : null}

        {loading ? (
          <p className="muted">Loading...</p>
        ) : shown.length === 0 ? (
          <div className="empty">
            <p>No client activity yet.</p>
          </div>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {shown.map((item) => (
              <div
                key={`${item.kind}-${item.id}`}
                className="card card-pad"
                style={{ display: "flex", gap: 14, alignItems: "flex-start" }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    marginTop: 6,
                    flexShrink: 0,
                    background:
                      item.kind === "approved" ? "#16a34a" : "#2563eb",
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    className="row"
                    style={{
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: 12,
                    }}
                  >
                    <div style={{ fontSize: 14, lineHeight: 1.5 }}>
                      {item.kind === "approved" ? (
                        <>
                          <strong>
                            {item.client_name || "Client"}
                          </strong>{" "}
                          approved{" "}
                          <Link href={`/admin/campaigns/${item.campaign_id}`}>
                            {item.campaign_title}
                          </Link>
                          {item.star_rating ? (
                            <span style={{ marginLeft: 8 }}>
                              {"★".repeat(item.star_rating)}
                              <span style={{ color: "#d1d5db" }}>
                                {"★".repeat(Math.max(0, 5 - item.star_rating))}
                              </span>
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <strong>{item.actor || "Reviewer"}</strong> left
                          feedback on{" "}
                          <Link href={`/admin/campaigns/${item.campaign_id}`}>
                            {item.campaign_title}
                          </Link>
                          {item.client_name ? (
                            <span className="muted">
                              {" "}
                              · {item.client_name}
                            </span>
                          ) : null}
                        </>
                      )}
                    </div>
                    <span
                      className="muted"
                      style={{ fontSize: 12, whiteSpace: "nowrap" }}
                      title={new Date(item.at).toLocaleString()}
                    >
                      {relativeTime(item.at)}
                    </span>
                  </div>

                  {item.kind === "feedback" && item.body ? (
                    <div
                      className="comment-body"
                      style={{ marginTop: 6, fontSize: 14 }}
                    >
                      {item.body}
                    </div>
                  ) : null}

                  {item.kind === "feedback" ? (
                    <div
                      className="meta"
                      style={{ marginTop: 6, fontSize: 12 }}
                    >
                      {item.email_title ? `${item.email_title} · ` : ""}
                      {item.comment_type === "inline"
                        ? "Pinned comment"
                        : "General comment"}
                      {item.resolved ? " · Resolved" : " · Open"}
                      {item.attachment_count > 0
                        ? ` · 📎 ${item.attachment_count} image${
                            item.attachment_count === 1 ? "" : "s"
                          }`
                        : ""}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
