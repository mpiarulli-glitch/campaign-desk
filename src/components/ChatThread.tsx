"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Message = {
  id: string;
  author_name: string;
  author_slug: string;
  is_client: number;
  body: string;
  created_at: string;
};

type Member = { slug: string; label: string };

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
        " " +
        d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Render a message body, highlighting @mentions of known team members. Matches
// "@" + a roster label (longest labels first so "Kyle Morris" wins over "Kyle").
function renderBody(body: string, labels: string[]): React.ReactNode {
  if (!labels.length) return body;
  const sorted = [...labels].sort((a, b) => b.length - a.length).map(escapeRe);
  const re = new RegExp(`@(${sorted.join("|")})`, "g");
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) out.push(body.slice(last, m.index));
    out.push(
      <span key={`m${i++}`} className="chat-mention">{m[0]}</span>
    );
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push(body.slice(last));
  return out;
}

// Polling chat thread. `endpoint` is the base URL for GET (list) and POST
// (send). For team rooms pass `room` (appended as a query param); for the
// client dashboard endpoint the room is implicit in the token, so omit it.
// `mineIsClient` flips which side "my" messages sit on (client dashboard vs
// team view). @mention autocomplete turns itself on only when the team roster
// loads (it 401s for the client-facing dashboard, which is intended).
export function ChatThread({
  endpoint,
  room,
  mineIsClient = false,
  emptyText = "No messages yet. Say hi.",
  placeholder = "Write a message…",
}: {
  endpoint: string;
  room?: string;
  mineIsClient?: boolean;
  emptyText?: string;
  placeholder?: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [team, setTeam] = useState<Member[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(0);
  const [activeMention, setActiveMention] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const lastCount = useRef(0);

  const url = room ? `${endpoint}?room=${encodeURIComponent(room)}` : endpoint;

  const load = useCallback(async () => {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch {
      /* keep last state on transient failure */
    } finally {
      setLoaded(true);
    }
  }, [url]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    fetch("/api/team")
      .then((r) => (r.ok ? r.json() : { team: [] }))
      .then((d) => setTeam(d.team || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (messages.length !== lastCount.current) {
      lastCount.current = messages.length;
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
    }
  }, [messages]);

  const teamLabels = team.map((m) => m.label);
  const matches =
    mentionQuery === null
      ? []
      : team
          .filter((m) => m.label.toLowerCase().includes(mentionQuery.toLowerCase()))
          .slice(0, 6);

  // Detect an "@word" token ending at the caret and open the picker for it.
  function detectMention(value: string, caret: number) {
    const before = value.slice(0, caret);
    const match = /(^|\s)@([\p{L}]*)$/u.exec(before);
    if (match && team.length) {
      setMentionQuery(match[2]);
      setMentionStart(caret - match[2].length - 1); // index of the "@"
      setActiveMention(0);
    } else {
      setMentionQuery(null);
    }
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setDraft(e.target.value);
    detectMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
  }

  function pickMention(member: Member) {
    const caret = taRef.current?.selectionStart ?? draft.length;
    const next = draft.slice(0, mentionStart) + "@" + member.label + " " + draft.slice(caret);
    setDraft(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const pos = mentionStart + member.label.length + 2;
      if (taRef.current) {
        taRef.current.focus();
        taRef.current.setSelectionRange(pos, pos);
      }
    });
  }

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft("");
    setMentionQuery(null);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(room ? { room, body: text } : { body: text }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.message) setMessages((m) => [...m, data.message]);
    } else {
      setDraft(text);
    }
    setSending(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery !== null && matches.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveMention((a) => Math.min(a + 1, matches.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveMention((a) => Math.max(a - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(matches[activeMention]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="chat">
      <div className="chat-scroll" ref={scrollRef}>
        {!loaded ? (
          <p className="muted chat-empty">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="muted chat-empty">{emptyText}</p>
        ) : (
          messages.map((m) => {
            const mine = mineIsClient ? m.is_client === 1 : m.is_client === 0;
            return (
              <div key={m.id} className={`chat-msg ${mine ? "is-mine" : "is-them"}`}>
                <div className="chat-bubble">
                  <div className="chat-author">
                    {m.author_name}
                    {m.is_client ? <span className="chat-badge chat-badge-client">Client</span> : null}
                  </div>
                  <div className="chat-text">{renderBody(m.body, teamLabels)}</div>
                  <div className="chat-time">{timeLabel(m.created_at)}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="chat-compose">
        <div className="chat-input-wrap">
          {mentionQuery !== null && matches.length ? (
            <div className="chat-mention-menu">
              {matches.map((m, i) => (
                <button
                  key={m.slug}
                  type="button"
                  className={`chat-mention-item ${i === activeMention ? "is-active" : ""}`}
                  onMouseEnter={() => setActiveMention(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickMention(m);
                  }}
                >
                  @{m.label}
                </button>
              ))}
            </div>
          ) : null}
          <textarea
            ref={taRef}
            value={draft}
            onChange={onChange}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            rows={1}
          />
        </div>
        <button className="btn btn-sm" disabled={sending || !draft.trim()} onClick={send}>
          Send
        </button>
      </div>
    </div>
  );
}
