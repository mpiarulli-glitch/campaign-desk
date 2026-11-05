"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  SNAPSHOT_DEPARTMENTS,
  type SnapshotDepartmentSlug,
} from "@/lib/snapshot-department-list";

type Item = { id: string; body: string };
type Note = {
  department: SnapshotDepartmentSlug;
  label: string;
  items: Item[];
};

/**
 * The six department lists for one client-week. Every section is always on
 * screen here. A department with no items is omitted only on the client snapshot.
 */
export function SnapshotWeekDepartments({
  clientId,
  weekStart,
}: {
  clientId: string;
  weekStart: string;
}) {
  const [notes, setNotes] = useState<Note[]>(
    SNAPSHOT_DEPARTMENTS.map((dept) => ({
      department: dept.slug,
      label: dept.label,
      items: [],
    }))
  );
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch(
        `/api/snapshot/departments?clientId=${encodeURIComponent(clientId)}&week=${weekStart}`
      );
      if (!res.ok) {
        setError("Could not load this week's departments.");
        return;
      }
      const data = await res.json();
      const next = (data.departments || []) as Note[];
      if (next.length) setNotes(next);
    } catch {
      setError("Network error. Try again.");
    }
  }, [clientId, weekStart]);

  useEffect(() => {
    setDraft({});
    setEditing(null);
    void load();
  }, [load]);

  async function addItem(event: FormEvent, department: SnapshotDepartmentSlug) {
    event.preventDefault();
    const body = (draft[department] || "").trim();
    if (!body) return;
    setError("");
    try {
      const res = await fetch("/api/snapshot/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, weekStart, department, body }),
      });
      if (!res.ok) {
        setError("Could not add that item.");
        return;
      }
      const data = await res.json();
      if (data.departments) setNotes(data.departments);
      setDraft((cur) => ({ ...cur, [department]: "" }));
    } catch {
      setError("Network error. Try again.");
    }
  }

  async function saveEdit(itemId: string) {
    const body = (editing?.body || "").trim();
    if (!editing || editing.id !== itemId) return;
    if (!body) {
      setError("Write something to keep this item, or remove it.");
      return;
    }
    setError("");
    try {
      const res = await fetch("/api/snapshot/departments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, body }),
      });
      if (!res.ok) {
        setError("Could not save that item.");
        return;
      }
      setNotes((cur) =>
        cur.map((note) => ({
          ...note,
          items: note.items.map((item) => (item.id === itemId ? { ...item, body } : item)),
        }))
      );
      setEditing(null);
    } catch {
      setError("Network error. Try again.");
    }
  }

  async function removeItem(itemId: string) {
    setError("");
    try {
      const res = await fetch(
        `/api/snapshot/departments?itemId=${encodeURIComponent(itemId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        setError("Could not remove that item.");
        return;
      }
      setNotes((cur) =>
        cur.map((note) => ({
          ...note,
          items: note.items.filter((item) => item.id !== itemId),
        }))
      );
      if (editing?.id === itemId) setEditing(null);
    } catch {
      setError("Network error. Try again.");
    }
  }

  return (
    <div className="snap-dept-list">
      {error ? <p className="error">{error}</p> : null}
      {notes.map((note) => (
        <section key={note.department} className="snap-dept">
          <div className="snap-dept-head">
            <strong>{note.label}</strong>
            <span>What we did this week</span>
          </div>
          {note.items.length > 0 ? (
            <ul className="snap-dept-items">
              {note.items.map((item) => (
                <li key={item.id}>
                  {editing?.id === item.id ? (
                    <form
                      className="snap-dept-add"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveEdit(item.id);
                      }}
                    >
                      <input
                        value={editing.body}
                        aria-label={`Edit ${note.label} item`}
                        autoFocus
                        onChange={(event) => setEditing({ id: item.id, body: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setEditing(null);
                        }}
                      />
                      <button className="btn btn-sm" type="submit">
                        Save
                      </button>
                    </form>
                  ) : (
                    <>
                      <span className="snap-dept-item-body">{item.body}</span>
                      <span className="snap-dept-item-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setEditing({ id: item.id, body: item.body })}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => void removeItem(item.id)}
                        >
                          Remove
                        </button>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          <form className="snap-dept-add" onSubmit={(event) => void addItem(event, note.department)}>
            <input
              value={draft[note.department] || ""}
              aria-label={`${note.label}: add an item`}
              placeholder="Add an item"
              onChange={(event) =>
                setDraft((cur) => ({ ...cur, [note.department]: event.target.value }))
              }
            />
            <button className="btn btn-sm" type="submit" disabled={!(draft[note.department] || "").trim()}>
              Add
            </button>
          </form>
        </section>
      ))}
    </div>
  );
}
