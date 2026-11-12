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
type TodoStatus = "" | "ok" | "no_project" | "error";

function otherDepartments(
  current: SnapshotDepartmentSlug,
  allowed: ReadonlyArray<{ slug: SnapshotDepartmentSlug; label: string }>
) {
  return allowed
    .filter((dept) => dept.slug !== current)
    .map((dept) => ({ value: dept.slug, label: dept.label.replace(" Department", "") }));
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
 *
 * Items already stored for the week stay here, including ones picked from
 * Basecamp earlier. Opening the week does not pull new Basecamp to-dos in.
 * Someone adds the next line from the picker, or types it.
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
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [todos, setTodos] = useState<SnapshotAddTodo[]>([]);
  const [todoStatus, setTodoStatus] = useState<TodoStatus>("");
  const [todoLoading, setTodoLoading] = useState(false);
  const [inView, setInView] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const todoGen = useRef(0);
  const dragRef = useRef<string | null>(null);
  const [dropAt, setDropAt] = useState<{ list: SnapshotDepartmentSlug; beforeId: string | null } | null>(
    null
  );

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
      await loadTodos();
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
    void load();
  }, [load]);

  // The Basecamp list belongs to the client, not the week. Clearing it on a
  // week change left the add row empty, because nothing asked for it again.
  useEffect(() => {
    setTodos([]);
    setTodoStatus("");
  }, [clientId]);

  useEffect(() => {
    if (!inView) return;
    void loadTodos();
    return () => {
      todoGen.current += 1;
    };
  }, [inView, loadTodos]);

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

  function startDrag(event: DragEvent, id: string) {
    dragRef.current = id;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
    event.stopPropagation();
  }

  function dragGrip(id: string, label: string) {
    return (
      <span
        className="snap-drag"
        draggable
        role="button"
        tabIndex={0}
        aria-label={`Drag ${label}`}
        title="Drag"
        onDragStart={(event) => startDrag(event, id)}
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

  function allowDrop(event: DragEvent, list: SnapshotDepartmentSlug, beforeId: string | null) {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag === beforeId) return;
    event.preventDefault();
    event.stopPropagation();
    setDropAt({ list, beforeId });
  }

  function finishDrop(event: DragEvent, list: SnapshotDepartmentSlug, beforeId: string | null) {
    event.preventDefault();
    event.stopPropagation();
    const drag = dragRef.current;
    dragRef.current = null;
    setDropAt(null);
    if (!drag) return;
    void placeItem(drag, list, beforeId);
  }

  const shown = notes.filter((note) =>
    allowed.some((dept) => dept.slug === note.department)
  );
  const takenSourceKeys = notes.flatMap((note) =>
    note.items.map((item) => item.sourceKey || "").filter(Boolean)
  );

  return (
    <div className="snap-dept-list" ref={rootRef}>
      {todoStatus === "no_project" ? (
        <p className="snap-suggest-note">
          No Basecamp project linked.{" "}
          <Link href="/admin/production">Link a Basecamp project</Link>
        </p>
      ) : null}
      {todoStatus === "error" ? (
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
                  {dragGrip(item.id, item.body)}
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
                        {otherDepartments(note.department, allowed).length > 0 ? (
                          <details className="snap-move">
                            <summary>Move to…</summary>
                            <div className="snap-move-menu" role="menu">
                              {otherDepartments(note.department, allowed).map((choice) => (
                                <button
                                  key={choice.value}
                                  type="button"
                                  role="menuitem"
                                  onClick={() => void placeItem(item.id, choice.value, null)}
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
            projectStatus={todoStatus}
            showRefresh={note.department === shown[0]?.department}
            refreshing={refreshing}
            onAddText={(body) => addText(note.department, body)}
            onAddTodo={addTodo}
            onRefresh={() => void refreshBasecamp()}
          />
        </section>
      ))}
    </div>
  );
}
