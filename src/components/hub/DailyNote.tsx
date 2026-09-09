"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Message = {
  id: string;
  clientName: string;
  title: string;
  preview: string;
  authorName: string;
  url: string;
  at: string;
  awaitingReply: boolean;
};
type Approval = {
  id: string;
  clientName: string;
  campaignTitle: string;
  summary: string;
  at: string;
  cardUrl: string;
  href: string;
};
type Comment = {
  id: string;
  clientName: string;
  campaignTitle: string;
  actor: string;
  body: string;
  at: string;
  href: string;
};
type Ping = {
  id: string;
  section: string;
  title: string;
  excerpt: string;
  projectName: string;
  actor: string;
  url: string;
  at: string;
  unread: boolean;
};
type Note = {
  dayKey: string;
  label: string;
  syncedAt: string | null;
  clientMessages: Message[];
  waiting: Message[];
  adsLaunched: Message[];
  approvals: Approval[];
  reviewComments: Comment[];
};
type Pings = {
  items: Ping[];
  reason: "ok" | "no-person" | "not-connected" | "error";
};

function clock(iso: string): string {
  if (!iso) return "";
  try {
    const at = new Date(iso);
    const now = new Date();
    const sameDay =
      new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(at) ===
      new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now);
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      month: sameDay ? undefined : "short",
      day: sameDay ? undefined : "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(at);
  } catch {
    return "";
  }
}

function pingLabel(section: string): string {
  if (section === "pings") return "Ping";
  if (section === "mentions") return "Mention";
  return "Inbox";
}

function Open({ href, children }: { href: string; children: React.ReactNode }) {
  if (!href) return <span>{children}</span>;
  const external = href.startsWith("http");
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  }
  return <Link href={href}>{children}</Link>;
}

export function DailyNote() {
  const [note, setNote] = useState<Note | null>(null);
  const [pings, setPings] = useState<Pings | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/hub/daily-note")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { note: Note; pings: Pings }) => {
        setNote(d.note);
        setPings(d.pings);
      })
      .catch(() => setError(true));
  }, []);

  if (error) {
    return (
      <div className="hq-card t-todo hq-note span2" style={{ cursor: "default" }}>
        <div className="hq-card-head">
          <span className="hq-icon"><NoteIcon /></span>
          <div>
            <h3 className="hq-card-title">Morning brief</h3>
            <p className="hq-card-desc">Couldn&apos;t load the morning brief.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!note) {
    return (
      <div className="hq-card t-todo hq-note span2" style={{ cursor: "default" }}>
        <div className="hq-card-head">
          <span className="hq-icon"><NoteIcon /></span>
          <div>
            <h3 className="hq-card-title">Morning brief</h3>
            <p className="hq-card-desc">Reading Basecamp…</p>
          </div>
        </div>
      </div>
    );
  }

  const pingItems = pings?.items || [];
  const waitingOnly = note.waiting.filter(
    (w) => !note.clientMessages.some((c) => c.id === w.id)
  );
  const count =
    pingItems.length +
    note.clientMessages.length +
    note.adsLaunched.length +
    note.approvals.length +
    note.reviewComments.length +
    waitingOnly.length;
  const quiet = count === 0;

  return (
    <div className="hq-card t-todo hq-note span2" style={{ cursor: "default" }}>
      <div className="hq-card-head">
        <span className="hq-icon"><NoteIcon /></span>
        <div>
          <h3 className="hq-card-title">Morning brief</h3>
          <p className="hq-card-desc">
            {note.label}
            {quiet ? " · all quiet" : ` · ${count} thing${count === 1 ? "" : "s"}`}
          </p>
        </div>
      </div>
      <div className="hq-divider" />

      {quiet ? (
        <p className="muted" style={{ margin: 0 }}>
          No new client messages, ads launches, or approval moves in the last day and a half.
        </p>
      ) : null}

      {pings?.reason === "not-connected" || pings?.reason === "no-person" ? (
        <p className="hq-note-hint">
          Connect your Basecamp account to include pings and mentions.{" "}
          <Link href="/account/basecamp">Connect Basecamp →</Link>
        </p>
      ) : null}
      {pings?.reason === "error" ? (
        <p className="hq-note-hint">Pings couldn&apos;t be loaded from Basecamp.</p>
      ) : null}

      <NoteSection title="Pings & mentions" hide={!pingItems.length}>
        {pingItems.map((p) => (
          <div key={p.id} className="hq-note-row">
            <span className="hq-tag">{pingLabel(p.section)}</span>
            <div className="hq-note-body">
              <Open href={p.url}>
                <strong>{p.projectName || p.title}</strong>
                {p.title && p.projectName ? ` · ${p.title}` : ""}
              </Open>
              <span className="hq-note-meta">
                {p.unread ? "Unread · " : ""}
                {p.actor ? `${p.actor} · ` : ""}
                {clock(p.at)}
              </span>
              {p.excerpt ? <span className="hq-note-excerpt">{p.excerpt}</span> : null}
            </div>
          </div>
        ))}
      </NoteSection>

      <NoteSection title="Clients who wrote" hide={!note.clientMessages.length}>
        {note.clientMessages.map((m) => (
          <MessageRow key={m.id} m={m} showWaiting />
        ))}
      </NoteSection>

      <NoteSection title="Ads launched" hide={!note.adsLaunched.length}>
        {note.adsLaunched.map((m) => (
          <MessageRow key={m.id} m={m} />
        ))}
      </NoteSection>

      <NoteSection
        title="Needs approval → approved"
        hide={!note.approvals.length}
      >
        {note.approvals.map((a) => (
          <div key={a.id} className="hq-note-row">
            <span className="hq-tag">Approved</span>
            <div className="hq-note-body">
              <Open href={a.href}>{a.summary}</Open>
              <span className="hq-note-meta">
                {a.clientName}
                {clock(a.at) ? ` · ${clock(a.at)}` : ""}
                {a.cardUrl ? (
                  <>
                    {" · "}
                    <a href={a.cardUrl} target="_blank" rel="noreferrer">
                      Basecamp card
                    </a>
                  </>
                ) : null}
              </span>
            </div>
          </div>
        ))}
      </NoteSection>

      <NoteSection title="Review-link comments" hide={!note.reviewComments.length}>
        {note.reviewComments.map((c) => (
          <div key={c.id} className="hq-note-row">
            <span className="hq-tag">Comment</span>
            <div className="hq-note-body">
              <Open href={c.href}>
                {c.actor} on {c.campaignTitle}
              </Open>
              <span className="hq-note-meta">
                {c.clientName}
                {clock(c.at) ? ` · ${clock(c.at)}` : ""}
              </span>
              {c.body ? <span className="hq-note-excerpt">{c.body}</span> : null}
            </div>
          </div>
        ))}
      </NoteSection>

      <NoteSection
        title="Still waiting on us"
        hide={!waitingOnly.length}
      >
        {waitingOnly.map((m) => (
          <MessageRow key={m.id} m={m} />
        ))}
      </NoteSection>
    </div>
  );
}

function MessageRow({ m, showWaiting }: { m: Message; showWaiting?: boolean }) {
  return (
    <div className="hq-note-row">
      <span className="hq-tag">{m.clientName || "Basecamp"}</span>
      <div className="hq-note-body">
        <Open href={m.url}>{m.title}</Open>
        <span className="hq-note-meta">
          {showWaiting && m.awaitingReply ? "Awaiting reply · " : ""}
          {m.authorName ? `${m.authorName} · ` : ""}
          {clock(m.at)}
        </span>
        {m.preview ? <span className="hq-note-excerpt">{m.preview}</span> : null}
      </div>
    </div>
  );
}

function NoteSection({
  title,
  children,
  hide,
}: {
  title: string;
  children: React.ReactNode;
  hide?: boolean;
}) {
  if (hide) return null;
  return (
    <section className="hq-note-section">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function NoteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h12v16H4z" />
      <path d="M16 8h4v12H8" />
      <path d="M8 8h4M8 12h4M8 16h2" />
    </svg>
  );
}
