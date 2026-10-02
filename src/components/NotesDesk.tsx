"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Note = {
  id: string;
  title: string;
  body: string;
  pinned: number;
  created_at: string;
  updated_at: string;
};

type Draft = { id: string; title: string; body: string };

const SAVE_DELAY_MS = 400;

function sortNotes(list: Note[]): Note[] {
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned - a.pinned;
    if (a.updated_at !== b.updated_at) return a.updated_at < b.updated_at ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
}

function sameDraft(a: Draft, b: Draft): boolean {
  return a.id === b.id && a.title === b.title && a.body === b.body;
}

function preview(body: string): string {
  const line = body.replace(/\s+/g, " ").trim();
  if (!line) return "Empty note";
  return line.length > 90 ? `${line.slice(0, 90)}…` : line;
}

function updatedLabel(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function displayTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed || "Untitled";
}

export function NotesDesk({ locked }: { locked: boolean }) {
  if (locked) {
    return (
      <div className="notes-page">
        <header className="notes-head">
          <div>
            <p className="eyebrow">Personal tools</p>
            <h1 className="h1">Notes</h1>
          </div>
        </header>
        <div className="card card-pad stack">
          <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
            Sign in as yourself to use your notes. Viewing the app as someone else
            keeps their notebook closed.
          </p>
          <Link href="/admin/hub" className="btn" style={{ width: "fit-content" }}>
            Back to Campaign Desk
          </Link>
        </div>
      </div>
    );
  }
  return <Desk />;
}

function Desk() {
  const router = useRouter();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [statusText, setStatusText] = useState("");
  const [creating, setCreating] = useState(false);
  const [reading, setReading] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<number | null>(null);
  const pending = useRef<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;

  const mark = useCallback((next: "idle" | "saving" | "saved" | "error", text: string) => {
    setStatus(next);
    setStatusText(text);
  }, []);

  const persist = useCallback(
    async (snapshot: Draft): Promise<boolean> => {
      if (pending.current && sameDraft(pending.current, snapshot)) {
        pending.current = null;
      }
      mark("saving", "Saving…");
      try {
        const res = await fetch(`/api/account/notes/${snapshot.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: snapshot.title, body: snapshot.body }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (!pending.current) pending.current = snapshot;
          mark("error", data.error || "Could not save.");
          return false;
        }
        const note = data.note as Note;
        setNotes((prev) =>
          sortNotes(prev.map((item) => (item.id === note.id ? { ...item, ...note } : item)))
        );
        const live = draftRef.current;
        if (live && sameDraft(live, snapshot) && (note.title !== snapshot.title || note.body !== snapshot.body)) {
          const clipped = { id: note.id, title: note.title, body: note.body };
          draftRef.current = clipped;
          setDraft(clipped);
        }
        const queued = pending.current;
        const newer =
          queued &&
          queued.id === snapshot.id &&
          (queued.title !== snapshot.title || queued.body !== snapshot.body);
        if (!newer) mark("saved", "Saved");
        return true;
      } catch {
        if (!pending.current) pending.current = snapshot;
        mark("error", "Could not reach the server.");
        return false;
      }
    },
    [mark]
  );

  const flush = useCallback(async (): Promise<boolean> => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (timer.current) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      const snapshot = pending.current;
      if (!snapshot) return true;
      const ok = await persist(snapshot);
      if (!ok) return false;
      const newer = pending.current;
      if (!newer || sameDraft(newer, snapshot)) return true;
    }
    return false;
  }, [persist]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/account/notes")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        if (!res.ok) {
          setLoadError(data.error || "Could not load your notes.");
          setLoading(false);
          return;
        }
        const list = sortNotes((data.notes || []) as Note[]);
        setNotes(list);
        if (list[0]) {
          setSelectedId(list[0].id);
          const next = { id: list[0].id, title: list[0].title, body: list[0].body };
          draftRef.current = next;
          setDraft(next);
        }
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError("Could not reach the server.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
      const snapshot = pending.current;
      if (!snapshot) return;
      fetch(`/api/account/notes/${snapshot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: snapshot.title, body: snapshot.body }),
        keepalive: true,
      }).catch(() => {});
    };
  }, []);

  function schedule(next: Draft) {
    draftRef.current = next;
    setDraft(next);
    pending.current = next;
    mark("saving", "Saving…");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const latest = pending.current;
      if (latest && sameDraft(latest, next)) void persist(next);
    }, SAVE_DELAY_MS);
  }

  async function openNote(note: Note) {
    if (note.id === selectedId) {
      setReading(true);
      return;
    }
    const ok = await flush();
    if (!ok) return;
    const next = { id: note.id, title: note.title, body: note.body };
    draftRef.current = next;
    setDraft(next);
    setSelectedId(note.id);
    mark("idle", "");
    setReading(true);
  }

  async function createNote() {
    if (creating) return;
    setCreating(true);
    const ok = await flush();
    if (!ok) {
      setCreating(false);
      return;
    }
    try {
      const res = await fetch("/api/account/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        mark("error", data.error || "Could not start a note.");
        return;
      }
      const note = data.note as Note;
      setNotes((prev) => sortNotes([note, ...prev.filter((item) => item.id !== note.id)]));
      const next = { id: note.id, title: note.title, body: note.body };
      draftRef.current = next;
      setDraft(next);
      setSelectedId(note.id);
      mark("saved", "Saved");
      setReading(true);
      requestAnimationFrame(() => titleRef.current?.focus());
    } catch {
      mark("error", "Could not reach the server.");
    } finally {
      setCreating(false);
    }
  }

  async function togglePin() {
    if (!selectedId) return;
    const ok = await flush();
    if (!ok) return;
    const current = notes.find((note) => note.id === selectedId);
    if (!current) return;
    try {
      const res = await fetch(`/api/account/notes/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: current.pinned !== 1 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        mark("error", data.error || "Could not update that pin.");
        return;
      }
      const note = data.note as Note;
      setNotes((prev) => sortNotes(prev.map((item) => (item.id === note.id ? note : item))));
    } catch {
      mark("error", "Could not reach the server.");
    }
  }

  async function removeNote() {
    if (!selectedId) return;
    const current = notes.find((note) => note.id === selectedId);
    if (!current) return;
    const label = displayTitle(draftRef.current?.id === current.id ? draftRef.current.title : current.title);
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return;
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const snapshot = pending.current;
    pending.current = null;
    try {
      const res = await fetch(`/api/account/notes/${current.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (snapshot) pending.current = snapshot;
        mark("error", data.error || "Could not delete that note.");
        return;
      }
      const rest = notes.filter((note) => note.id !== current.id);
      setNotes(rest);
      const next = rest[0] ?? null;
      setSelectedId(next?.id ?? null);
      const nextDraft = next ? { id: next.id, title: next.title, body: next.body } : null;
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      mark("idle", "");
      if (!next) setReading(false);
    } catch {
      if (snapshot) pending.current = snapshot;
      mark("error", "Could not reach the server.");
    }
  }

  const needle = query.trim().toLowerCase();
  const visible = notes.filter((note) => {
    if (!needle) return true;
    const title = draft?.id === note.id ? draft.title : note.title;
    const body = draft?.id === note.id ? draft.body : note.body;
    return `${title}\n${body}`.toLowerCase().includes(needle);
  });
  const selected = notes.find((note) => note.id === selectedId) ?? null;

  return (
    <div className={`notes-page${reading ? " is-reading" : ""}`}>
      <header className="notes-head">
        <div>
          <p className="eyebrow">Personal tools</p>
          <h1 className="h1">Notes</h1>
          <p className="notes-lead">Private to you. Nobody else on the team can open these.</p>
        </div>
      </header>

      {loadError ? (
        <div className="card card-pad stack">
          <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>{loadError}</p>
          <button type="button" className="btn" style={{ width: "fit-content" }} onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      ) : (
        <div className="notes-shell">
          <aside className="notes-list">
            <div className="notes-list-tools">
              <button type="button" className="btn btn-sm" disabled={creating || loading} onClick={createNote}>
                {creating ? "Starting…" : "New note"}
              </button>
              <input
                className="notes-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search your notes"
                aria-label="Search your notes"
              />
            </div>
            <div className="notes-items">
              {loading ? (
                <p className="notes-list-empty">Loading your notes…</p>
              ) : visible.length === 0 ? (
                <p className="notes-list-empty">
                  {notes.length === 0 ? "No notes yet." : "No notes match that search."}
                </p>
              ) : (
                <ul className="notes-item-list">
                  {visible.map((note) => {
                    const title = draft?.id === note.id ? draft.title : note.title;
                    const body = draft?.id === note.id ? draft.body : note.body;
                    const on = note.id === selectedId;
                    return (
                      <li key={note.id}>
                        <button
                          type="button"
                          className={`notes-item${on ? " is-on" : ""}`}
                          aria-current={on ? "true" : undefined}
                          onClick={() => void openNote(note)}
                        >
                          <span className="notes-item-title">
                            {note.pinned ? <span className="notes-pin">Pinned</span> : null}
                            <span>{displayTitle(title)}</span>
                          </span>
                          <span className="notes-item-preview">{preview(body)}</span>
                          <span className="notes-item-meta">{updatedLabel(note.updated_at)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>

          <section className="notes-editor" aria-label="Note">
            {draft && selected ? (
              <>
                <div className="notes-editor-bar">
                  <button type="button" className="btn btn-ghost btn-sm notes-back" onClick={() => setReading(false)}>
                    All notes
                  </button>
                  <span className={`notes-status${status === "error" ? " is-error" : ""}`} role="status">
                    {statusText}
                  </span>
                  <span className="notes-editor-spacer" />
                  <button
                    type="button"
                    className={`btn btn-ghost btn-sm notes-pin-btn${selected.pinned ? " is-on" : ""}`}
                    aria-pressed={selected.pinned === 1}
                    onClick={() => void togglePin()}
                  >
                    {selected.pinned ? "Unpin" : "Pin"}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm notes-delete" onClick={() => void removeNote()}>
                    Delete
                  </button>
                </div>
                <input
                  ref={titleRef}
                  className="notes-title"
                  value={draft.title}
                  aria-label="Title"
                  placeholder="Untitled"
                  maxLength={200}
                  onChange={(event) => schedule({ ...draft, title: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      bodyRef.current?.focus();
                    }
                  }}
                />
                <textarea
                  ref={bodyRef}
                  className="notes-body"
                  value={draft.body}
                  aria-label="Note"
                  placeholder="Write something you want to remember."
                  onChange={(event) => schedule({ ...draft, body: event.target.value })}
                />
              </>
            ) : (
              <div className="notes-empty-editor">
                <div>
                  <p className="notes-empty-title">{loading ? "Loading your notes…" : "Nothing open"}</p>
                  <p className="muted">
                    {loading ? "One moment." : "Start a note, or pick one from the list."}
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
