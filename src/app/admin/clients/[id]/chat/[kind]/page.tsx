"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChatThread } from "@/components/ChatThread";

// Full-page view of a single client thread. kind = "internal" (team-only) or
// "client" (shared with the client). Both post through /api/chat.
export default function ClientChatPage() {
  const { id, kind } = useParams<{ id: string; kind: string }>();
  const router = useRouter();
  const [clientName, setClientName] = useState("");
  const isClient = kind === "client";

  useEffect(() => {
    fetch(`/api/admin/clients/${id}/dashboard`)
      .then((r) => {
        if (r.status === 401) {
          router.push("/login");
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((d) => d && setClientName(d.client?.name || ""))
      .catch(() => {});
  }, [id, router]);

  const room = isClient ? `client:${id}` : `team:${id}`;

  return (
    <div className="ops-scope">
      <div className="ops-page">
        <div className="ops-page-head">
          <div>
            <p className="ops-eyebrow">
              <Link href={`/admin/clients/${id}`} className="linklike">
                {clientName || "Client hub"}
              </Link>{" "}
              · Messages
            </p>
            <h1 className="ops-title">{isClient ? "Client thread" : "Internal thread"}.</h1>
            <p className="ops-sub">
              {isClient
                ? "Shared with the client. They see these on their dashboard."
                : "Team only. The client never sees this thread."}
            </p>
          </div>
          <Link href={`/admin/clients/${id}`} className="btn btn-ghost btn-sm">‹ Back to hub</Link>
        </div>

        <div className="ops-panel chat-panel chat-panel-tall">
          <ChatThread
            endpoint="/api/chat"
            room={room}
            emptyText={isClient ? "No messages with the client yet." : "No internal notes yet."}
            placeholder={isClient ? "Reply to the client…" : "Note for the team…"}
          />
        </div>
      </div>
    </div>
  );
}
