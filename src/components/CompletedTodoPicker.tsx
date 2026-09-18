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

/**
 * Single-select picker for a completed Basecamp to-do.
 *
 * Used on the snapshot fill desk so staff can attach a finished to-do as the
 * record of what happened under a deliverable. Multi-select is deliberate
 * absence: one deliverable week gets one completion record.
 */
export function CompletedTodoPicker({
  todos,
  selectedId,
  loading,
  reason,
  projectName,
  clientName,
  onSelect,
  onClear,
}: {
  todos: CompletedTodoOption[];
  selectedId: string;
  loading?: boolean;
  reason?: string | null;
  projectName?: string | null;
  clientName?: string | null;
  onSelect: (todo: CompletedTodoOption) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = todos.find((t) => t.id === selectedId);

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
    onSelect(todo);
    setOpen(false);
    setQuery("");
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

  const closedLabel = selected?.title || "";
  const fromLine = projectName
    ? `Basecamp project: ${projectName}`
    : clientName
      ? `Linked Basecamp project for ${clientName}`
      : "";
  const hint = loading
    ? "Loading completed to-dos…"
    : reason === "no-project"
      ? "This client has no Basecamp project set."
      : reason === "not-connected"
        ? "Basecamp isn’t connected."
        : reason === "project-mismatch"
          ? `Linked project “${projectName || "unknown"}” doesn’t look like ${clientName || "this client"}. Check the Basecamp project on the client record.`
          : reason === "no-todos"
            ? "No completed Basecamp to-dos found in this client’s project."
            : reason === "failed"
              ? "Could not load completed to-dos."
              : todos.length
                ? `${todos.length} completed to-do${todos.length === 1 ? "" : "s"} from this client’s project.`
                : "";

  return (
    <div className="snap-completed-todo">
      <div className="fc-combo fc-combo-todos snap-todo-combo" ref={wrapRef}>
        <input
          value={open ? query : closedLabel}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={closedLabel || "Pick a completed Basecamp to-do"}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Completed Basecamp to-do"
          autoComplete="off"
          disabled={loading}
        />
        {open ? (
          <ul className="fc-combo-list" id={listId} role="listbox">
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
                      const picked = t.id === selectedId;
                      const when = completedLabel(t.completedAt);
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
                            {when ? <span className="fc-combo-tag">done {when}</span> : null}
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
      {selectedId ? (
        <button type="button" className="link-button snap-todo-clear" onClick={onClear}>
          Clear link
        </button>
      ) : null}
      {fromLine ? (
        <p className={`snap-todo-project ${reason === "project-mismatch" ? "is-warn" : "muted"}`}>
          {fromLine}
        </p>
      ) : null}
      {hint ? (
        <p className={`snap-todo-hint ${reason === "project-mismatch" ? "is-warn" : "muted"}`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
