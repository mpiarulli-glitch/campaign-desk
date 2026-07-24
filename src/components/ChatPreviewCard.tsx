"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Message = {
  id: string;
  author_name: string;
  is_client: number;
  body: string;
  created_at: string;
};

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Compact entry card for the client hub Messages tab. Shows the latest message
// and a count, and the whole card links into the full-page thread.
export function ChatPreviewCard({
  clientId,
  kind,
  title,
  tag,
}: {
  clientId: string;
  kind: "internal" | "client";
  title: string;
  tag: string;
}) {
  const room = kind === "client" ? `client:${clientId}` : `team:${clientId}`;
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`/api/chat?room=${encodeURIComponent(room)}`)
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((d) => setMessages(d.messages || []))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [room]);

  const last = messages[messages.length - 1];

  return (
    <Link href={`/admin/clients/${clientId}/chat/${kind}`} className="chat-card">
      <div className="chat-card-head">
        <h2 className="acct-section-title" style={{ margin: 0 }}>{title}</h2>
        <span className={`chat-card-tag ${kind === "client" ? "is-client" : "is-internal"}`}>{tag}</span>
      </div>
      <div className="chat-card-body">
        {!loaded ? (
          <p className="muted" style={{ margin: 0 }}>Loading…</p>
        ) : last ? (
          <>
            <p className="chat-card-last">
              <strong>{last.author_name}:</strong> {last.body}
            </p>
            <p className="chat-card-meta">
              {messages.length} message{messages.length === 1 ? "" : "s"} · {timeAgo(last.created_at)}
            </p>
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>No messages yet. Open to start the thread.</p>
        )}
      </div>
      <span className="chat-card-open">Open thread →</span>
    </Link>
  );
}
