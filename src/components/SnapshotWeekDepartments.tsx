"use client";

import Link from "next/link";
import { DragEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  SNAPSHOT_DEPARTMENTS,
  snapshotItemStatusLabel,
  type SnapshotDepartmentSlug,
  type SnapshotItemStatus,
} from "@/lib/snapshot-department-list";
import { SnapshotDepartmentAdd, type SnapshotAddTodo } from "@/components/SnapshotDepartmentAdd";
import { DepartmentItemEditor } from "@/components/SnapshotItemEditor";

type Item = {
  id: string;
  body: string;
  completed?: boolean;
  status?: SnapshotItemStatus;
  sourceKey?: string;
  mark?: "" | "sent";
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

function otherDepartments(
  current: DropList,
  includeUnsorted: boolean,
  allowed: ReadonlyArray<{ slug: SnapshotDepartmentSlug; label: string }>
) {
  const rows: { value: DropList; label: string }[] = allowed
    .filter((dept) => dept.slug !== current)
    .map((dept) => ({ value: dept.slug, label: dept.label.replace(" Department", "") }));
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
 * Department lists for one client-week. Pass visibleDepartments to show one
 * person's sections. Omit it and every section is on screen. A department
 * with no items is omitted only on the client snapshot.
 */
export function SnapshotWeekDepartments({
  clientId,
  weekStart,
  visibleDepartments = null,
}: {
  clientId: string;
  weekStart: string;
  visibleDepartments?: readonly SnapshotDepartmentSlug[] | null;
}) {
  const allowed =
    visibleDepartments && visibleDepartments.length > 0
      ? SNAPSHOT_DEPARTMENTS.filter((dept) => visibleDepartments.includes(dept.slug))
      : SNAPSHOT_DEPARTMENTS;
  const [notes, setNotes] = useState<Note[]>(
    SNAPSHOT_DEPARTMENTS.map((dept) => ({
      department: dept.slug,
      label: dept.label,
      items: [],
    }))
  );
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [suggestionEdits, setSuggestionEdits] = useState<Record<string, string>>({});
  const [editingSuggestion, setEditingSuggestion] = useState<string | null>(null);
  const [unsortedDept, setUnsortedDept] = useState<Record<string, SnapshotDepartmentSlug>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [suggestStatus, setSuggestStatus] = useState<SuggestStatus>("");
  const [todos, setTodos] = useState<SnapshotAddTodo[]>([]);
  const [todoStatus, setTodoStatus] = useState<SuggestStatus>("");
  const [todoLoading, setTodoLoading] = useState(false);
  const [inView, setInView] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const requestGen = useRef(0);
  const todoGen = useRef(0);
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
      }
    },
    [clientId, weekStart]
  );

  const loadTodos = useCallback(async () => {
    const gen = ++todoGen.current;
    setTodoLoading(true);
    try {
      const res = await fetch(
        `/api/snapshot/departments/todos?clientId=${encodeURIComponent(clientId)}`
      );
      if (todoGen.current !== gen) return;
      if (!res.ok) {
        setTodos([]);
        setTodoStatus("error");
        return;
      }
      const data = await res.json();
      const status = data.status;
      setTodos((data.todos || []) as SnapshotAddTodo[]);
      setTodoStatus(
        status === "no_project" || status === "error" || status === "ok" ? status : "ok"
      );
    } catch {
      if (todoGen.current !== gen) return;
      setTodos([]);
      setTodoStatus("error");
    } finally {
      if (todoGen.current === gen) setTodoLoading(false);
    }
  }, [clientId]);

  async function refreshBasecamp() {
    setRefreshing(true);
    try {
      await Promise.all([loadSuggestions(true), loadTodos()]);
    } finally {
      setRefreshing(false);
    }
  }

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
    setEditing(null);
    setSuggestionEdits({});
    setEditingSuggestion(null);
    setSuggestions([]);
    setSuggestStatus("");
    setTodos([]);
    setTodoStatus("");
    void load();
  }, [load]);

  useEffect(() => {
    if (!inView) return;
    void loadSuggestions(false);
    void loadTodos();
    return () => {
      requestGen.current += 1;
      todoGen.current += 1;
    };
  }, [inView, loadSuggestions, loadTodos]);

  async function addText(department: SnapshotDepartmentSlug, body: string): Promise<string> {
    const text = body.trim();
    if (!text) return "Write an item before adding it.";
    try {
      const res = await fetch("/api/snapshot/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, weekStart, department, body: text }),
      });
      if (!res.ok) return "Could not add that item.";
      const data = await res.json();
      if (data.departments) setNotes(data.departments);
      void loadSuggestions(false);
      return "";
    } catch {
      return "Network error. Try again.";
    }
  }

  async function addTodo(todo: SnapshotAddTodo, department: SnapshotDepartmentSlug): Promise<string> {
    try {
      const res = await fetch("/api/snapshot/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          weekStart,
          department,
          body: todo.title,
          sourceKey: todo.sourceKey,
          status: todo.status,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return "Could not add that to-do.";
      if (data.departments) setNotes(data.departments);
      void loadSuggestions(false);
      return data.already ? "Already on this week." : "";
    } catch {
      return "Could not add that to-do.";
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
            const fallback = allowed[0]?.slug || "lifecycle";
            const picked = unsortedDept[suggestion.sourceKey];
            const target = picking
              ? picked && allowed.some((dept) => dept.slug === picked)
                ? picked
                : fallback
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
                    {allowed.map((dept) => (
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
                    {otherDepartments(department, true, allowed).map((choice) => (
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

  const shown = notes.filter((note) =>
    allowed.some((dept) => dept.slug === note.department)
  );
  const unsorted = suggestions.filter((row) => row.department === "unsorted");
  const takenSourceKeys = notes.flatMap((note) =>
    note.items.map((item) => item.sourceKey || "").filter(Boolean)
  );
  const projectStatus = todoStatus === "no_project" || suggestStatus === "no_project"
    ? "no_project"
    : todoStatus === "error" || suggestStatus === "error"
      ? "error"
      : todoStatus || suggestStatus;

  return (
    <div className="snap-dept-list" ref={rootRef}>
      {projectStatus === "no_project" ? (
        <p className="snap-suggest-note">
          No Basecamp project linked.{" "}
          <Link href="/admin/production">Link a Basecamp project</Link>
        </p>
      ) : null}
      {projectStatus === "error" ? (
        <p className="snap-suggest-note">
          Couldn&apos;t reach Basecamp.{" "}
          <button
            type="button"
            className="linklike"
            onClick={() => void refreshBasecamp()}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing…" : "Refresh Basecamp"}
          </button>
        </p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      {shown.map((note) => (
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
                    [
                      dropAt?.list === note.department && dropAt.beforeId === item.id
                        ? "is-drop-before"
                        : "",
                      editing?.id === item.id ? "is-editing" : "",
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined
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
                    <DepartmentItemEditor
                      label={note.label}
                      value={editing.body}
                      onChange={(body) => setEditing({ id: item.id, body })}
                      onSave={() => void saveEdit(item.id)}
                      onCancel={() => setEditing(null)}
                    />
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
                        {otherDepartments(note.department, false, allowed).length > 0 ? (
                          <details className="snap-move">
                            <summary>Move to…</summary>
                            <div className="snap-move-menu" role="menu">
                              {otherDepartments(note.department, false, allowed).map((choice) => (
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
                        ) : null}
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          <SnapshotDepartmentAdd
            department={note.department}
            label={note.label}
            todos={todos}
            takenSourceKeys={takenSourceKeys}
            loading={todoLoading}
            projectStatus={projectStatus}
            showRefresh={note.department === shown[0]?.department}
            refreshing={refreshing}
            onAddText={(body) => addText(note.department, body)}
            onAddTodo={addTodo}
            onRefresh={() => void refreshBasecamp()}
          />
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
