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

// Polling chat thread. `endpoint` is the base URL for GET (list) and POST
// (send). For team rooms pass `room` (appended as a query param); for the
// client dashboard endpoint the room is implicit in the token, so omit it.
// `mineIsClient` flips which side "my" messages sit on (client dashboard vs
// team view).
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
  const scrollRef = useRef<HTMLDivElement>(null);
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
    if (messages.length !== lastCount.current) {
      lastCount.current = messages.length;
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
    }
  }, [messages]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft("");
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
                  <div className="chat-text">{m.body}</div>
                  <div className="chat-time">{timeLabel(m.created_at)}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="chat-compose">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={placeholder}
          rows={1}
        />
        <button className="btn btn-sm" disabled={sending || !draft.trim()} onClick={send}>
          Send
        </button>
      </div>
    </div>
  );
}
