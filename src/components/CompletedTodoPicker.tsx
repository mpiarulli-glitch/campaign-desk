"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type CompletedTodoOption = {
  id: string;
  title: string;
  list: string;
  completedAt: string | null;
  url: string;
  projectId: string;
};

function completedLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export type LinkedTodoChip = { id: string; title: string; url: string };

/**
 * Multi-select picker for Basecamp to-dos, open or completed.
 *
 * The list stays open so several to-dos can be linked in one pass. Each click
 * toggles that to-do on the deliverable for this week.
 */
export function CompletedTodoPicker({
  todos,
  selected,
  loading,
  reason,
  projectName,
  clientName,
  onToggle,
  onRemove,
  onClear,
}: {
  todos: CompletedTodoOption[];
  selected: LinkedTodoChip[];
  loading?: boolean;
  reason?: string | null;
  projectName?: string | null;
  clientName?: string | null;
  onToggle: (todo: CompletedTodoOption) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selectedIds = new Set(selected.map((t) => t.id));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return todos;
    const starts: CompletedTodoOption[] = [];
    const contains: CompletedTodoOption[] = [];
    const inList: CompletedTodoOption[] = [];
    for (const t of todos) {
      const title = t.title.toLowerCase();
      const list = t.list.toLowerCase();
      if (title.startsWith(q)) starts.push(t);
      else if (title.includes(q)) contains.push(t);
      else if (list.includes(q)) inList.push(t);
    }
    return [...starts, ...contains, ...inList];
  }, [todos, query]);

  const groups = useMemo(() => {
    const q = query.trim();
    if (q) {
      return filtered.length
        ? ([["Matching", filtered]] as Array<[string, CompletedTodoOption[]]>)
        : [];
    }
    const map = new Map<string, CompletedTodoOption[]>();
    for (const t of todos) {
      const list = map.get(t.list) || [];
      list.push(t);
      map.set(t.list, list);
    }
    return [...map.entries()] as Array<[string, CompletedTodoOption[]]>;
  }, [todos, filtered, query]);

  const flat = useMemo(() => groups.flatMap(([, items]) => items), [groups]);

  useEffect(() => {
    setActive((a) => (a >= flat.length ? 0 : a));
  }, [flat.length]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function pick(todo: CompletedTodoOption) {
    onToggle(todo);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((a) => Math.min(flat.length - 1, a + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
      return;
    }
    if (e.key === "Enter") {
      if (!open) {
        setOpen(true);
        return;
      }
      const hit = flat[active];
      if (!hit) return;
      e.preventDefault();
      pick(hit);
      return;
    }
    if (e.key === "Escape") {
      if (!open) return;
      e.stopPropagation();
      setOpen(false);
      setQuery("");
    }
  }

  const scopeWarn =
    reason === "project-mismatch" || reason === "not-client-project";
  const fromLine = projectName
    ? `From Basecamp project: ${projectName}`
    : clientName
      ? `From the Basecamp project linked to ${clientName}`
      : "";
  const hint = loading
    ? "Loading Basecamp to-dos…"
    : reason === "no-project"
      ? "This client has no Basecamp project set."
      : reason === "not-connected"
        ? "Basecamp isn’t connected."
        : reason === "not-client-project"
          ? `“${projectName || "That project"}” is an internal/template Basecamp project, not ${clientName || "this client"}. Fix the Basecamp project on the client record.`
          : reason === "project-mismatch"
            ? `Linked project “${projectName || "unknown"}” doesn’t look like ${clientName || "this client"}. Check the Basecamp project on the client record.`
            : reason === "no-todos"
              ? "No Basecamp to-dos found in this client’s project."
              : reason === "failed"
                ? "Could not load Basecamp to-dos."
                : todos.length
                  ? `${todos.length} Basecamp to-do${todos.length === 1 ? "" : "s"} from this client’s project, including ones that are still open.`
                  : "";

  return (
    <div className="snap-completed-todo">
      {fromLine ? (
        <p className={`snap-todo-project ${scopeWarn ? "is-warn" : "muted"}`}>
          {fromLine}
        </p>
      ) : null}
      <div className="fc-combo fc-combo-todos snap-todo-combo" ref={wrapRef}>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Add Basecamp to-dos"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Basecamp to-dos"
          autoComplete="off"
          disabled={loading || reason === "not-client-project"}
        />
        {open && reason !== "not-client-project" ? (
          <ul className="fc-combo-list" id={listId} role="listbox" aria-multiselectable="true">
            {groups.length === 0 ? (
              <li className="fc-combo-empty">
                {loading ? "Loading…" : "No matches"}
              </li>
            ) : (
              groups.map(([label, items], gi) => {
                const offset = groups.slice(0, gi).reduce((n, [, g]) => n + g.length, 0);
                return (
                  <li key={label} className="fc-combo-group">
                    {query.trim() ? null : (
                      <div className="fc-combo-group-label">{label}</div>
                    )}
                    {items.map((t, itemIndex) => {
                      const i = offset + itemIndex;
                      const picked = selectedIds.has(t.id);
                          const when = completedLabel(t.completedAt);
                          const stateTag = when ? `done ${when}` : "open";
                      return (
                        <button
                          key={t.id}
                          type="button"
                          role="option"
                          aria-selected={picked}
                          className={`fc-combo-item ${i === active ? "is-active" : ""} ${
                            picked ? "is-picked" : ""
                          }`}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            pick(t);
                          }}
                          onMouseEnter={() => setActive(i)}
                        >
                          <span className="fc-combo-todo">
                            {t.title}
                            <span className="fc-combo-tag">{stateTag}</span>
                            {query.trim() && t.list ? (
                              <span className="fc-combo-tag">{t.list}</span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </li>
                );
              })
            )}
          </ul>
        ) : null}
      </div>
      {selected.length ? (
        <ul className="snap-todo-chips">
          {selected.map((todo) => (
            <li key={todo.id} className="snap-todo-chip">
              {todo.url ? (
                <a href={todo.url} target="_blank" rel="noreferrer">
                  {todo.title || "Basecamp to-do"}
                </a>
              ) : (
                <span>{todo.title || "Basecamp to-do"}</span>
              )}
              <button
                type="button"
                className="snap-todo-chip-x"
                aria-label={`Unlink ${todo.title || "to-do"}`}
                onClick={() => onRemove(todo.id)}
              >
                ×
              </button>
            </li>
          ))}
          {selected.length > 1 ? (
            <li>
              <button type="button" className="btn btn-ghost btn-sm snap-todo-clear" onClick={onClear}>
                Unlink all
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
      {hint ? (
        <p className={`snap-todo-hint ${scopeWarn ? "is-warn" : "muted"}`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
