"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/Brand";
import { NavMenu } from "@/components/NavMenu";
import { ChatThread } from "@/components/ChatThread";

export default function TeamChatPage() {
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.authenticated) router.push("/login");
      })
      .catch(() => {});
  }, [router]);

  return (
    <div className="ops-scope">
      <header className="topbar">
        <Brand href="/admin" />
        <NavMenu current="/admin/chat" />
      </header>

      <div className="ops-page">
        <div className="ops-page-head">
          <div>
            <p className="ops-eyebrow">Team</p>
            <h1 className="ops-title">Team chat.</h1>
            <p className="ops-sub">One place for the whole team. Client-specific threads live on each client&apos;s hub.</p>
          </div>
        </div>

        <div className="ops-panel chat-panel">
          <ChatThread endpoint="/api/chat" room="team" emptyText="No messages yet. Kick it off." />
        </div>
      </div>
    </div>
  );
}
