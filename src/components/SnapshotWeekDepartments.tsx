"use client";

import Link from "next/link";
import { DragEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  SNAPSHOT_DEPARTMENTS,
  snapshotItemStatusLabel,
  type SnapshotDepartmentSlug,
  type SnapshotItemStatus,
} from "@/lib/snapshot-department-list";

type Item = {
  id: string;
  body: string;
  completed?: boolean;
  status?: SnapshotItemStatus;
  sourceKey?: string;
  mark?: "" | "sent";
};

type TodoHit = {
  sourceKey: string;
  title: string;
  place: string;
  department: SnapshotDepartmentSlug | "unsorted";
  status: SnapshotItemStatus;
};
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
  /** "sent" was delivered for approval and is not a completed check. */
  mark?: "done" | "sent";
};
type SuggestStatus = "" | "ok" | "no_project" | "error";
type DragKind = "item" | "suggestion";
type DropList = SnapshotDepartmentSlug | "unsorted";

function otherDepartments(current: DropList, includeUnsorted: boolean) {
  const rows: { value: DropList; label: string }[] = SNAPSHOT_DEPARTMENTS.filter(
    (dept) => dept.slug !== current
  ).map((dept) => ({ value: dept.slug, label: dept.label.replace(" Department", "") }));
  if (includeUnsorted && current !== "unsorted") rows.push({ value: "unsorted", label: "Unsorted" });
  return rows;
}

function scrollParent(node: HTMLElement): Element | null {
  let el: HTMLElement | null = node.parentElement;
  while (el) {
    const overflow = getComputedStyle(el).overflowY;
    if (overflow === "auto" || overflow === "scroll") return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * Every department list for one client-week. Every section is always on
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
  const [suggestionEdits, setSuggestionEdits] = useState<Record<string, string>>({});
  const [editingSuggestion, setEditingSuggestion] = useState<string | null>(null);
  const [unsortedDept, setUnsortedDept] = useState<Record<string, SnapshotDepartmentSlug>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [suggestStatus, setSuggestStatus] = useState<SuggestStatus>("");
  const [todoQuery, setTodoQuery] = useState("");
  const [todoHits, setTodoHits] = useState<TodoHit[]>([]);
  const [todoNote, setTodoNote] = useState("");
  const [todoSearching, setTodoSearching] = useState(false);
  const [todoDept, setTodoDept] = useState<Record<string, SnapshotDepartmentSlug>>({});
  const [inView, setInView] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const requestGen = useRef(0);
  const dragRef = useRef<{ kind: DragKind; id: string } | null>(null);
  const [dropAt, setDropAt] = useState<{ list: DropList; beforeId: string | null } | null>(null);

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
      const gen = ++requestGen.current;
      if (refresh) setRefreshing(true);
      try {
        const res = await fetch(
          `/api/snapshot/departments/suggestions?clientId=${encodeURIComponent(clientId)}&week=${weekStart}${refresh ? "&refresh=1" : ""}`
        );
        if (requestGen.current !== gen) return;
        if (!res.ok) {
          setSuggestions([]);
          setSuggestStatus("error");
          return;
        }
        const data = await res.json();
        const status = data.status;
        setSuggestions((data.suggestions || []) as Suggestion[]);
        setSuggestStatus(
          status === "no_project" || status === "error" || status === "ok" ? status : "ok"
        );
      } catch {
        if (requestGen.current !== gen) return;
        setSuggestions([]);
        setSuggestStatus("error");
      } finally {
        if (requestGen.current === gen) setRefreshing(false);
      }
    },
    [clientId, weekStart]
  );

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setInView(true);
      },
      { root: scrollParent(node), rootMargin: "160px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [clientId]);

  useEffect(() => {
    setDraft({});
    setEditing(null);
    setSuggestionEdits({});
    setEditingSuggestion(null);
    setSuggestions([]);
    setSuggestStatus("");
    void load();
  }, [load]);

  useEffect(() => {
    if (!inView) return;
    void loadSuggestions(false);
    return () => {
      requestGen.current += 1;
    };
  }, [inView, loadSuggestions]);

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

  async function setItemStatus(item: Item, status: SnapshotItemStatus) {
    setNotes((cur) =>
      cur.map((note) => ({
        ...note,
        items: note.items.map((row) =>
          row.id === item.id ? { ...row, status, completed: status === "completed" } : row
        ),
      }))
    );
    try {
      const res = await fetch("/api/snapshot/departments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, status }),
      });
      if (!res.ok) throw new Error("save failed");
    } catch {
      setNotes((cur) =>
        cur.map((note) => ({
          ...note,
          items: note.items.map((row) =>
            row.id === item.id
              ? { ...row, status: item.status, completed: item.completed }
              : row
          ),
        }))
      );
      setError("Could not update that status.");
    }
  }

  async function searchTodos(event: FormEvent) {
    event.preventDefault();
    const q = todoQuery.trim();
    setTodoNote("");
    setTodoHits([]);
    if (q.length < 2) {
      setTodoNote("Type at least two letters.");
      return;
    }
    setTodoSearching(true);
    try {
      const res = await fetch(
        `/api/snapshot/departments/search?clientId=${encodeURIComponent(clientId)}&q=${encodeURIComponent(q)}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status === "error") {
        setTodoNote("Couldn't reach Basecamp, try again.");
        return;
      }
      if (data.status === "no_project") {
        setTodoNote("No Basecamp project linked.");
        return;
      }
      const hits = (data.hits || []) as TodoHit[];
      setTodoHits(hits);
      if (!hits.length) setTodoNote("No to-dos matched in this project.");
    } catch {
      setTodoNote("Couldn't reach Basecamp, try again.");
    } finally {
      setTodoSearching(false);
    }
  }

  async function addTodoHit(hit: TodoHit, department: string) {
    if (!department) {
      setTodoNote("Pick a department for that to-do.");
      return;
    }
    setTodoNote("");
    try {
      const res = await fetch("/api/snapshot/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          weekStart,
          department,
          body: hit.title,
          sourceKey: hit.sourceKey,
          status: hit.status,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTodoNote("Could not add that to-do.");
        return;
      }
      if (data.departments) setNotes(data.departments);
      setTodoHits((cur) => cur.filter((row) => row.sourceKey !== hit.sourceKey));
      setTodoNote(data.already ? "Already on this week." : "");
    } catch {
      setTodoNote("Could not add that to-do.");
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
          body: suggestionText(suggestion),
          status: suggestion.mark === "sent" ? "scheduled" : "completed",
          completed: suggestion.mark !== "sent",
          sourceKey: suggestion.sourceKey,
          mark: suggestion.mark === "sent" ? "sent" : "",
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

  function placeSuggestion(sourceKey: string, to: DropList, beforeId: string | null) {
    setSuggestions((cur) => {
      const moving = cur.find((row) => row.sourceKey === sourceKey);
      if (!moving) return cur;
      const rest = cur.filter((row) => row.sourceKey !== sourceKey);
      const next = { ...moving, department: to };
      const at = beforeId ? rest.findIndex((row) => row.sourceKey === beforeId) : -1;
      if (at >= 0) {
        rest.splice(at, 0, next);
        return rest;
      }
      let last = -1;
      rest.forEach((row, index) => {
        if (row.department === to) last = index;
      });
      rest.splice(last + 1, 0, next);
      return rest;
    });
  }

  async function placeItem(itemId: string, to: SnapshotDepartmentSlug, beforeId: string | null) {
    let previous: Note[] | null = null;
    setNotes((cur) => {
      previous = cur;
      let moving: Item | null = null;
      const stripped = cur.map((note) => ({
        ...note,
        items: note.items.filter((item) => {
          if (item.id !== itemId) return true;
          moving = item;
          return false;
        }),
      }));
      if (!moving) return cur;
      return stripped.map((note) => {
        if (note.department !== to) return note;
        const items = [...note.items];
        const at = beforeId ? items.findIndex((item) => item.id === beforeId) : -1;
        if (at >= 0) items.splice(at, 0, moving as Item);
        else items.push(moving as Item);
        return { ...note, items };
      });
    });
    try {
      const res = await fetch("/api/snapshot/departments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, department: to, beforeId }),
      });
      if (!res.ok) throw new Error("move");
      const data = await res.json();
      if (data.departments) setNotes(data.departments);
    } catch {
      if (previous) setNotes(previous);
      setError("Could not move that item.");
    }
  }

  function startDrag(event: DragEvent, kind: DragKind, id: string) {
    dragRef.current = { kind, id };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
    event.stopPropagation();
  }

  function dragGrip(kind: DragKind, id: string, label: string) {
    return (
      <span
        className="snap-drag"
        draggable
        role="button"
        tabIndex={0}
        aria-label={`Drag ${label}`}
        title="Drag"
        onDragStart={(event) => startDrag(event, kind, id)}
        onDragEnd={() => {
          dragRef.current = null;
          setDropAt(null);
        }}
      >
        <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">
          <circle cx="2" cy="2" r="1.15" fill="currentColor" />
          <circle cx="8" cy="2" r="1.15" fill="currentColor" />
          <circle cx="2" cy="8" r="1.15" fill="currentColor" />
          <circle cx="8" cy="8" r="1.15" fill="currentColor" />
          <circle cx="2" cy="14" r="1.15" fill="currentColor" />
          <circle cx="8" cy="14" r="1.15" fill="currentColor" />
        </svg>
      </span>
    );
  }

  function allowDrop(event: DragEvent, list: DropList, beforeId: string | null) {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === "item" && list === "unsorted") return;
    if (drag.id === beforeId) return;
    event.preventDefault();
    event.stopPropagation();
    setDropAt({ list, beforeId });
  }

  function finishDrop(event: DragEvent, list: DropList, beforeId: string | null) {
    event.preventDefault();
    event.stopPropagation();
    const drag = dragRef.current;
    dragRef.current = null;
    setDropAt(null);
    if (!drag) return;
    if (drag.kind === "suggestion") {
      placeSuggestion(drag.id, list, beforeId);
      return;
    }
    if (list === "unsorted") return;
    void placeItem(drag.id, list, beforeId);
  }

  function suggestionText(suggestion: Suggestion): string {
    const edited = suggestionEdits[suggestion.sourceKey];
    return edited !== undefined ? edited : suggestion.title;
  }

  function beginSuggestionEdit(suggestion: Suggestion) {
    setEditingSuggestion(suggestion.sourceKey);
    setSuggestionEdits((cur) =>
      cur[suggestion.sourceKey] !== undefined
        ? cur
        : { ...cur, [suggestion.sourceKey]: suggestion.title }
    );
  }

  function suggestionBlock(rows: Suggestion[], department: DropList) {
    if (!rows.length) return null;
    const picking = department === "unsorted";
    return (
      <div className="snap-suggest">
        <p className="snap-suggest-label">From Basecamp</p>
        <ul>
          {rows.map((suggestion) => {
            const target = picking
              ? unsortedDept[suggestion.sourceKey] || "lifecycle"
              : (department as SnapshotDepartmentSlug);
            const text = suggestionText(suggestion);
            const editingThis = editingSuggestion === suggestion.sourceKey;
            const sent = suggestion.mark === "sent";
            const armed =
              dropAt?.list === department && dropAt.beforeId === suggestion.sourceKey;
            return (
                <li
                  key={suggestion.sourceKey}
                  className={armed ? "is-drop-before" : undefined}
                  onDragOver={(event) => allowDrop(event, department, suggestion.sourceKey)}
                  onDrop={(event) => finishDrop(event, department, suggestion.sourceKey)}
                >
                {dragGrip("suggestion", suggestion.sourceKey, suggestion.title)}
                {sent ? (
                  <span className="snap-sent" aria-label="Sent for approval">
                    Sent for approval
                  </span>
                ) : (
                  <span className="snap-status is-completed">Completed</span>
                )}
                {editingThis ? (
                  <span className="snap-suggest-edit">
                    <input
                      value={text}
                      aria-label={`Edit ${suggestion.title}`}
                      autoFocus
                      onChange={(event) =>
                        setSuggestionEdits((cur) => ({
                          ...cur,
                          [suggestion.sourceKey]: event.target.value,
                        }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setSuggestionEdits((cur) => {
                            const next = { ...cur };
                            delete next[suggestion.sourceKey];
                            return next;
                          });
                          setEditingSuggestion(null);
                        }
                        if (event.key === "Enter") {
                          event.preventDefault();
                          setEditingSuggestion(null);
                        }
                      }}
                    />
                    {suggestion.place ? <span>{suggestion.place}</span> : null}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="snap-suggest-title"
                    onClick={() => beginSuggestionEdit(suggestion)}
                  >
                    {text}
                    {suggestion.place ? <span>{suggestion.place}</span> : null}
                  </button>
                )}
                {picking ? (
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
                ) : null}
                {editingThis ? null : (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => beginSuggestionEdit(suggestion)}
                  >
                    Edit
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={!text.trim()}
                  onClick={() =>
                    void acceptSuggestion({ ...suggestion, title: text.trim() }, target)
                  }
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
                <details className="snap-move">
                  <summary>Move to…</summary>
                  <div className="snap-move-menu" role="menu">
                    {otherDepartments(department, true).map((choice) => (
                      <button
                        key={choice.value}
                        type="button"
                        role="menuitem"
                        onClick={() => placeSuggestion(suggestion.sourceKey, choice.value, null)}
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  const unsorted = suggestions.filter((row) => row.department === "unsorted");

  return (
    <div className="snap-dept-list" ref={rootRef}>
      <div className="snap-suggest-refresh">
        <form className="snap-todo-search" onSubmit={(event) => void searchTodos(event)}>
          <input
            value={todoQuery}
            onChange={(event) => setTodoQuery(event.target.value)}
            placeholder="Search this project's to-dos"
            aria-label="Search Basecamp to-dos"
          />
          <button className="btn btn-ghost btn-sm" type="submit" disabled={todoSearching}>
            {todoSearching ? "Searching…" : "Search"}
          </button>
        </form>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void loadSuggestions(true)}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing…" : "Refresh Basecamp"}
        </button>
      </div>
      {todoNote ? <p className="snap-suggest-note">{todoNote}</p> : null}
      {todoHits.length > 0 ? (
        <ul className="snap-todo-hits">
          {todoHits.map((hit) => {
            const matched = hit.department !== "unsorted" ? hit.department : "";
            const chosen = matched || todoDept[hit.sourceKey] || "";
            return (
              <li key={hit.sourceKey}>
                <span>
                  <strong>{hit.title}</strong>
                  <span>
                    {snapshotItemStatusLabel(hit.status)}
                    {hit.place ? ` · ${hit.place}` : ""}
                  </span>
                </span>
                {matched ? (
                  <span className="snap-todo-where">
                    {SNAPSHOT_DEPARTMENTS.find((dept) => dept.slug === matched)?.label.replace(
                      " Department",
                      ""
                    )}
                  </span>
                ) : (
                  <select
                    aria-label={`Department for ${hit.title}`}
                    value={chosen}
                    onChange={(event) =>
                      setTodoDept((cur) => ({
                        ...cur,
                        [hit.sourceKey]: event.target.value as SnapshotDepartmentSlug,
                      }))
                    }
                  >
                    <option value="">Pick a department</option>
                    {SNAPSHOT_DEPARTMENTS.map((dept) => (
                      <option key={dept.slug} value={dept.slug}>
                        {dept.label.replace(" Department", "")}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => void addTodoHit(hit, chosen)}
                >
                  Add
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {suggestStatus === "no_project" ? (
        <p className="snap-suggest-note">
          No Basecamp project linked.{" "}
          <Link href="/admin/production">Link a Basecamp project</Link>
        </p>
      ) : null}
      {suggestStatus === "error" ? (
        <p className="snap-suggest-note">Couldn&apos;t reach Basecamp, try Refresh</p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      {notes.map((note) => (
        <section
          key={note.department}
          className={`snap-dept${dropAt?.list === note.department && !dropAt.beforeId ? " is-drop" : ""}`}
          onDragOver={(event) => allowDrop(event, note.department, null)}
          onDrop={(event) => finishDrop(event, note.department, null)}
        >
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
                <li
                  key={item.id}
                  className={
                    dropAt?.list === note.department && dropAt.beforeId === item.id
                      ? "is-drop-before"
                      : undefined
                  }
                  onDragOver={(event) => allowDrop(event, note.department, item.id)}
                  onDrop={(event) => finishDrop(event, note.department, item.id)}
                >
                  {dragGrip("item", item.id, item.body)}
                  {item.mark === "sent" ? (
                    <span className="snap-sent" aria-label="Sent for approval">
                      Sent for approval
                    </span>
                  ) : null}
                  <label className="snap-status-wrap">
                    <select
                      className={`snap-status is-${item.status || (item.completed ? "completed" : "in_progress")}`}
                      aria-label={`Status for ${item.body}`}
                      value={item.status || (item.completed ? "completed" : "in_progress")}
                      onChange={(event) =>
                        void setItemStatus(item, event.target.value as SnapshotItemStatus)
                      }
                    >
                      <option value="in_progress">{snapshotItemStatusLabel("in_progress")}</option>
                      <option value="scheduled">{snapshotItemStatusLabel("scheduled")}</option>
                      <option value="completed">{snapshotItemStatusLabel("completed")}</option>
                    </select>
                  </label>
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
                        <details className="snap-move">
                          <summary>Move to…</summary>
                          <div className="snap-move-menu" role="menu">
                            {otherDepartments(note.department, false).map((choice) => (
                              <button
                                key={choice.value}
                                type="button"
                                role="menuitem"
                                onClick={() =>
                                  void placeItem(
                                    item.id,
                                    choice.value as SnapshotDepartmentSlug,
                                    null
                                  )
                                }
                              >
                                {choice.label}
                              </button>
                            ))}
                          </div>
                        </details>
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
        <section
          className={`snap-dept${dropAt?.list === "unsorted" && !dropAt.beforeId ? " is-drop" : ""}`}
          onDragOver={(event) => allowDrop(event, "unsorted", null)}
          onDrop={(event) => finishDrop(event, "unsorted", null)}
        >
          <div className="snap-dept-head">
            <strong>Unsorted</strong>
            <span>Pick a department</span>
          </div>
          {suggestionBlock(unsorted, "unsorted")}
        </section>
      ) : null}
    </div>
  );
}
