"use client";

import { useState } from "react";
import type { ClientRef, Note, SavedLink } from "./types";

const CATEGORIES = [
  { value: "doc", label: "Doc" },
  { value: "inspo", label: "Inspiration" },
  { value: "reference", label: "Reference" },
];

export function NotesPanel({
  notes,
  links,
  clients,
  onChanged,
}: {
  notes: Note[];
  links: SavedLink[];
  clients: ClientRef[];
  onChanged: () => void;
}) {
  const [note, setNote] = useState({ title: "", body: "", clientId: "", tags: "" });
  const [link, setLink] = useState({ title: "", url: "", clientId: "", category: "doc", note: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const clientName = (id: string | null) =>
    id ? (clients.find((c) => c.id === id)?.name ?? "Unknown client") : "";

  async function saveNote() {
    if (!note.title.trim() && !note.body.trim()) {
      setError("Add a title or some text before saving.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/lifecycle/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...note, clientId: note.clientId || null }),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error || "Could not save that note.");
        return;
      }
      setNote({ title: "", body: "", clientId: "", tags: "" });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function saveLink() {
    if (!link.title.trim() || !link.url.trim()) {
      setError("A link needs both a title and a URL.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/lifecycle/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...link, clientId: link.clientId || null }),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error || "Could not save that link.");
        return;
      }
      setLink({ title: "", url: "", clientId: "", category: "doc", note: "" });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function togglePin(n: Note) {
    await fetch(`/api/lifecycle/notes/${n.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !n.pinned }),
    });
    onChanged();
  }

  async function removeNote(n: Note) {
    if (!confirm(`Delete "${n.title || "this note"}"?`)) return;
    await fetch(`/api/lifecycle/notes/${n.id}`, { method: "DELETE" });
    onChanged();
  }

  async function removeLink(l: SavedLink) {
    if (!confirm(`Delete the link "${l.title}"?`)) return;
    await fetch(`/api/lifecycle/links/${l.id}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <div className="hud-grid hud-grid-2">
      <div className="hud-stack" style={{ gap: 14 }}>
        <h2 className="hud-panel-title">Notes</h2>

        <div className="hud-panel" style={{ display: "grid", gap: 8 }}>
          <input
            value={note.title}
            onChange={(e) => setNote({ ...note, title: e.target.value })}
            placeholder="Note title"
          />
          <textarea
            rows={3}
            value={note.body}
            onChange={(e) => setNote({ ...note, body: e.target.value })}
            placeholder="What did you learn?"
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select value={note.clientId} onChange={(e) => setNote({ ...note, clientId: e.target.value })}>
              <option value="">No client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <input
              value={note.tags}
              onChange={(e) => setNote({ ...note, tags: e.target.value })}
              placeholder="tags, comma separated"
              style={{ flex: 1, minWidth: 140 }}
            />
            <button className="hud-btn" disabled={busy} onClick={saveNote}>Save note</button>
          </div>
        </div>

        {notes.length === 0 ? (
          <p className="hud-empty">No notes yet.</p>
        ) : (
          notes.map((n) => (
            <div key={n.id} className={`hud-camp hud-note ${n.pinned ? "pinned" : ""}`}>
              <div className="hud-camp-top">
                <b>{n.title || "Untitled note"}</b>
                <div style={{ display: "flex", gap: 10 }}>
                  <button className="hud-link" onClick={() => togglePin(n)}>
                    {n.pinned ? "Unpin" : "Pin"}
                  </button>
                  <button className="hud-link" onClick={() => removeNote(n)}>Delete</button>
                </div>
              </div>
              {n.body ? <p className="hud-note-body">{n.body}</p> : null}
              <div className="hud-camp-sub" style={{ marginTop: 10 }}>
                {clientName(n.client_id) ? `${clientName(n.client_id)} · ` : ""}
                {n.tags ? `${n.tags} · ` : ""}
                {new Date(n.updated_at).toLocaleDateString()}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="hud-stack" style={{ gap: 14 }}>
        <h2 className="hud-panel-title">Docs & inspiration</h2>

        <div className="hud-panel" style={{ display: "grid", gap: 8 }}>
          <input
            value={link.title}
            onChange={(e) => setLink({ ...link, title: e.target.value })}
            placeholder="Link title"
          />
          <input
            value={link.url}
            onChange={(e) => setLink({ ...link, url: e.target.value })}
            placeholder="https://…"
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select value={link.category} onChange={(e) => setLink({ ...link, category: e.target.value })}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <select value={link.clientId} onChange={(e) => setLink({ ...link, clientId: e.target.value })}>
              <option value="">No client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button className="hud-btn" disabled={busy} onClick={saveLink}>Save link</button>
          </div>
        </div>

        {error ? <p className="hud-err">{error}</p> : null}

        {links.length === 0 ? (
          <p className="hud-empty">Nothing saved yet.</p>
        ) : (
          CATEGORIES.map((cat) => {
            const rows = links.filter((l) => l.category === cat.value);
            if (rows.length === 0) return null;
            return (
              <div key={cat.value} className="hud-panel" style={{ display: "grid", gap: 4 }}>
                <div className="hud-eyebrow">{cat.label}</div>
                {rows.map((l) => (
                  <div key={l.id} className="hud-row">
                    <a href={l.url} target="_blank" rel="noreferrer">{l.title}</a>
                    <span className="hud-row-meta">
                      {clientName(l.client_id)}
                    </span>
                    <button className="hud-link" onClick={() => removeLink(l)}>Delete</button>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
