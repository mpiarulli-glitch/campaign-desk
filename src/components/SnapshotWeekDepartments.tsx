"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  SNAPSHOT_DEPARTMENTS,
  type SnapshotDepartmentSlug,
} from "@/lib/snapshot-department-list";

type Item = { id: string; body: string; completed?: boolean };
type Note = {
  department: SnapshotDepartmentSlug;
  label: string;
  items: Item[];
};
type Suggestion = {
  sourceKey: string;
  title: string;
  place: string;
  department: SnapshotDepartmentSlug | "unsorted";
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
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [unsortedDept, setUnsortedDept] = useState<Record<string, SnapshotDepartmentSlug>>({});
  const [refreshing, setRefreshing] = useState(false);
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

  const loadSuggestions = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      try {
        const res = await fetch(
          `/api/snapshot/departments/suggestions?clientId=${encodeURIComponent(clientId)}&week=${weekStart}${refresh ? "&refresh=1" : ""}`
        );
        if (!res.ok) {
          setSuggestions([]);
          return;
        }
        const data = await res.json();
        setSuggestions((data.suggestions || []) as Suggestion[]);
      } catch {
        setSuggestions([]);
      } finally {
        if (refresh) setRefreshing(false);
      }
    },
    [clientId, weekStart]
  );

  useEffect(() => {
    setDraft({});
    setEditing(null);
    void load();
    void loadSuggestions(false);
  }, [load, loadSuggestions]);

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
      void loadSuggestions(false);
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

  async function toggleDone(item: Item) {
    const completed = !item.completed;
    setNotes((cur) =>
      cur.map((note) => ({
        ...note,
        items: note.items.map((row) => (row.id === item.id ? { ...row, completed } : row)),
      }))
    );
    try {
      const res = await fetch("/api/snapshot/departments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, completed }),
      });
      if (!res.ok) throw new Error("save failed");
    } catch {
      setNotes((cur) =>
        cur.map((note) => ({
          ...note,
          items: note.items.map((row) =>
            row.id === item.id ? { ...row, completed: item.completed } : row
          ),
        }))
      );
      setError("Could not update that check.");
    }
  }

  async function acceptSuggestion(suggestion: Suggestion, department: SnapshotDepartmentSlug) {
    setError("");
    try {
      const added = await fetch("/api/snapshot/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          weekStart,
          department,
          body: suggestion.title,
          completed: true,
          sourceKey: suggestion.sourceKey,
        }),
      });
      if (!added.ok) {
        setError("Could not add that item.");
        return;
      }
      const data = await added.json();
      if (data.departments) setNotes(data.departments);
      await fetch("/api/snapshot/departments/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, weekStart, sourceKey: suggestion.sourceKey }),
      });
      setSuggestions((cur) => cur.filter((row) => row.sourceKey !== suggestion.sourceKey));
    } catch {
      setError("Network error. Try again.");
    }
  }

  async function dismissSuggestion(sourceKey: string) {
    setSuggestions((cur) => cur.filter((row) => row.sourceKey !== sourceKey));
    try {
      await fetch("/api/snapshot/departments/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, weekStart, sourceKey }),
      });
    } catch {
      void loadSuggestions(false);
    }
  }

  function suggestionBlock(rows: Suggestion[], department?: SnapshotDepartmentSlug) {
    if (!rows.length) return null;
    return (
      <div className="snap-suggest">
        <p className="snap-suggest-label">From Basecamp</p>
        <ul>
          {rows.map((suggestion) => {
            const target = department || unsortedDept[suggestion.sourceKey] || "lifecycle";
            return (
                <li key={suggestion.sourceKey}>
                <span className="snap-check is-on" aria-label="Completed in Basecamp">
                  ✓
                </span>
                <span className="snap-suggest-title">
                  {suggestion.title}
                  {suggestion.place ? <span>{suggestion.place}</span> : null}
                </span>
                {department ? null : (
                  <select
                    aria-label={`Department for ${suggestion.title}`}
                    value={target}
                    onChange={(event) =>
                      setUnsortedDept((cur) => ({
                        ...cur,
                        [suggestion.sourceKey]: event.target.value as SnapshotDepartmentSlug,
                      }))
                    }
                  >
                    {SNAPSHOT_DEPARTMENTS.map((dept) => (
                      <option key={dept.slug} value={dept.slug}>
                        {dept.label}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => void acceptSuggestion(suggestion, target)}
                >
                  Add
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void dismissSuggestion(suggestion.sourceKey)}
                >
                  Dismiss
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  const unsorted = suggestions.filter((row) => row.department === "unsorted");

  return (
    <div className="snap-dept-list">
      <div className="snap-suggest-refresh">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void loadSuggestions(true)}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing…" : "Refresh Basecamp"}
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {notes.map((note) => (
        <section key={note.department} className="snap-dept">
          <div className="snap-dept-head">
            <strong>{note.label}</strong>
            <span>What we did this week</span>
          </div>
          {suggestionBlock(
            suggestions.filter((row) => row.department === note.department),
            note.department
          )}
          {note.items.length > 0 ? (
            <ul className="snap-dept-items">
              {note.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`snap-check ${item.completed ? "is-on" : ""}`}
                    aria-pressed={Boolean(item.completed)}
                    aria-label={item.completed ? "Completed. Click to clear." : "Mark done"}
                    onClick={() => void toggleDone(item)}
                  >
                    {item.completed ? "✓" : ""}
                  </button>
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
      {unsorted.length > 0 ? (
        <section className="snap-dept">
          <div className="snap-dept-head">
            <strong>Unsorted</strong>
            <span>Pick a department</span>
          </div>
          {suggestionBlock(unsorted)}
        </section>
      ) : null}
    </div>
  );
}
