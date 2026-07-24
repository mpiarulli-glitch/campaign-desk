"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/Brand";
import { NavMenu } from "@/components/NavMenu";
import { ChatThread } from "@/components/ChatThread";
import { TeamTodos } from "@/components/TeamTodos";
import { SopsSection } from "@/components/hub/SopsSection";
import { TrainingSection } from "@/components/hub/TrainingSection";
import { SentimentSection } from "@/components/hub/SentimentSection";
import { HrSection } from "@/components/hub/HrSection";
import { teamLabel } from "@/lib/team";

type Section = "chat" | "resources" | "sops" | "training" | "todos" | "sentiment" | "hr";
const SECTIONS: { key: Section; label: string }[] = [
  { key: "chat", label: "Team chat" },
  { key: "resources", label: "Forecasts, docs & files" },
  { key: "sops", label: "SOPs" },
  { key: "training", label: "Marketing & AI training" },
  { key: "todos", label: "Team to-dos" },
  { key: "sentiment", label: "Sentiment check-in" },
  { key: "hr", label: "HR" },
];

function ResourcesSection({ isAdmin }: { isAdmin: boolean }) {
  const [links, setLinks] = useState<{ docsUrl: string; filesUrl: string }>({ docsUrl: "", filesUrl: "" });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ docsUrl: "", filesUrl: "" });

  useEffect(() => {
    fetch("/api/hub/links")
      .then((r) => (r.ok ? r.json() : { links: { docsUrl: "", filesUrl: "" } }))
      .then((d) => { setLinks(d.links); setDraft(d.links); });
  }, []);

  async function save() {
    const res = await fetch("/api/hub/links", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (res.ok) { setLinks((await res.json()).links); setEditing(false); }
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="hub-links">
        <Link className="hub-link-card" href="/admin/forecast">
          <span className="hub-link-title">Forecasts</span>
          <span className="hub-link-sub">Team allocation & weekly planning</span>
          <span className="hub-link-go">Open →</span>
        </Link>
        <a className={`hub-link-card ${!links.docsUrl ? "is-empty" : ""}`} href={links.docsUrl || undefined} target="_blank" rel="noreferrer">
          <span className="hub-link-title">Docs</span>
          <span className="hub-link-sub">{links.docsUrl ? "Shared documents" : "No link set yet"}</span>
          {links.docsUrl ? <span className="hub-link-go">Open →</span> : null}
        </a>
        <a className={`hub-link-card ${!links.filesUrl ? "is-empty" : ""}`} href={links.filesUrl || undefined} target="_blank" rel="noreferrer">
          <span className="hub-link-title">Files</span>
          <span className="hub-link-sub">{links.filesUrl ? "Shared drive / assets" : "No link set yet"}</span>
          {links.filesUrl ? <span className="hub-link-go">Open →</span> : null}
        </a>
      </div>

      {isAdmin ? (
        editing ? (
          <div className="card card-pad stack" style={{ gap: 10 }}>
            <label className="field"><span>Docs URL</span>
              <input value={draft.docsUrl} onChange={(e) => setDraft({ ...draft, docsUrl: e.target.value })} placeholder="https://drive.google.com/…" />
            </label>
            <label className="field"><span>Files URL</span>
              <input value={draft.filesUrl} onChange={(e) => setDraft({ ...draft, filesUrl: e.target.value })} placeholder="https://…" />
            </label>
            <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost btn-sm" onClick={() => { setDraft(links); setEditing(false); }}>Cancel</button>
              <button className="btn btn-sm" onClick={save}>Save links</button>
            </div>
          </div>
        ) : (
          <button className="btn btn-ghost btn-sm" style={{ width: "fit-content" }} onClick={() => setEditing(true)}>Edit doc & file links</button>
        )
      ) : null}
    </div>
  );
}

export default function TeamHubPage() {
  const router = useRouter();
  const [section, setSection] = useState<Section>("chat");
  const [role, setRole] = useState<"admin" | "forecast" | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.authenticated) { router.push("/login"); return; }
        setRole(d.role);
        setPerson(d.person || null);
        setReady(true);
      })
      .catch(() => setReady(true));
  }, [router]);

  const isAdmin = role === "admin";

  return (
    <div className="ops-scope">
      <header className="topbar">
        <Brand href="/admin" />
        <NavMenu current="/admin/hub" />
      </header>

      <div className="ops-page">
        <div className="ops-page-head">
          <div>
            <p className="ops-eyebrow">Internal</p>
            <h1 className="ops-title">MEG Team Hub.</h1>
            <p className="ops-sub">Everything the team runs on, in one place.</p>
          </div>
        </div>

        <div className="hub-nav">
          {SECTIONS.map((s) => (
            <button key={s.key} className={`hub-nav-btn ${section === s.key ? "is-on" : ""}`} onClick={() => setSection(s.key)}>
              {s.label}
            </button>
          ))}
        </div>

        {!ready ? (
          <p className="muted">Loading…</p>
        ) : section === "chat" ? (
          <div className="ops-panel chat-panel chat-panel-tall">
            <ChatThread endpoint="/api/chat" room="team" emptyText="No messages yet. Kick it off." />
          </div>
        ) : section === "resources" ? (
          <ResourcesSection isAdmin={isAdmin} />
        ) : section === "sops" ? (
          <SopsSection isAdmin={isAdmin} />
        ) : section === "training" ? (
          <TrainingSection isAdmin={isAdmin} />
        ) : section === "todos" ? (
          <TeamTodos />
        ) : section === "sentiment" ? (
          <SentimentSection isAdmin={isAdmin} person={person} />
        ) : section === "hr" ? (
          <HrSection isAdmin={isAdmin} personLabel={teamLabel} />
        ) : null}
      </div>
    </div>
  );
}
