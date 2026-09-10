"use client";

import { useState, type FormEvent } from "react";

export type ChecklistItem = {
  id: string;
  title: string;
  dueDate: string | null;
  status: "open" | "done";
};

export function ChecklistBlock({
  items,
  empty,
  addLabel,
  placeholder,
  kind,
  clientId,
  onChanged,
}: {
  items: ChecklistItem[];
  empty: string;
  addLabel: string;
  placeholder: string;
  kind: "deliverable" | "automation";
  clientId: string;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editTitle, setEditTitle] = useState("");

  async function addItem(e: FormEvent) {
    e.preventDefault();
    const next = title.trim();
    if (!next) {
      setError("Add a name.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/lifecycle/hub/${clientId}/checklist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, title: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Could not add that.");
        return;
      }
      setTitle("");
      setAdding(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function toggle(item: ChecklistItem) {
    const next = item.status === "done" ? "open" : "done";
    await fetch(`/api/todos/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    onChanged();
  }

  async function saveTitle(item: ChecklistItem) {
    const next = editTitle.trim();
    setEditingId("");
    if (!next || next === item.title) return;
    await fetch(`/api/todos/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: next }),
    });
    onChanged();
  }

  async function remove(item: ChecklistItem) {
    await fetch(`/api/todos/${item.id}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <div className="lh-checklist">
      {items.length === 0 && !adding ? (
        <p className="lh-card-note">{empty}</p>
      ) : (
        <ul className="lh-todos">
          {items.map((item) => (
            <li key={item.id} className={item.status === "done" ? "is-done" : ""}>
              <input
                type="checkbox"
                checked={item.status === "done"}
                onChange={() => void toggle(item)}
                aria-label={`Mark ${item.title} ${item.status === "done" ? "open" : "done"}`}
              />
              {editingId === item.id ? (
                <input
                  className="lh-todo-edit"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={() => void saveTitle(item)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      (e.target as HTMLInputElement).blur();
                    }
                    if (e.key === "Escape") setEditingId("");
                  }}
                  autoFocus
                  aria-label={`Edit ${item.title}`}
                />
              ) : (
                <button
                  type="button"
                  className="lh-todo-title"
                  onClick={() => {
                    setEditingId(item.id);
                    setEditTitle(item.title);
                  }}
                >
                  {item.title}
                </button>
              )}
              <button
                type="button"
                className="lh-todo-remove"
                onClick={() => void remove(item)}
                aria-label={`Remove ${item.title}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form className="lh-checklist-form" onSubmit={(e) => void addItem(e)}>
          {kind === "automation" ? (
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={placeholder}
              aria-label={addLabel}
              rows={4}
              autoFocus
            />
          ) : (
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={placeholder}
              aria-label={addLabel}
              autoFocus
            />
          )}
          <div className="lh-actions">
            <button type="submit" className="btn btn-sm" disabled={busy}>
              {busy ? "Adding…" : "Add"}
            </button>
            <button
              type="button"
              className="lh-link"
              onClick={() => {
                setAdding(false);
                setTitle("");
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
          {error ? <p className="lh-error">{error}</p> : null}
        </form>
      ) : (
        <button type="button" className="lh-link lh-checklist-add" onClick={() => setAdding(true)}>
          {addLabel}
        </button>
      )}
    </div>
  );
}
