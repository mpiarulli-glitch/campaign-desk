"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  SNAPSHOT_DEPARTMENTS,
  snapshotItemStatusLabel,
  type SnapshotDepartmentSlug,
} from "@/lib/snapshot-department-list";
import { pickerTodosForDepartment } from "@/lib/snapshot-basecamp-suggestions";
import {
  snapPopPlacement,
  type SnapPopPlacement,
} from "@/lib/snapshot-pop-placement";

export type SnapshotAddTodo = {
  sourceKey: string;
  title: string;
  place: string;
  department: SnapshotDepartmentSlug | "unsorted";
  status: "in_progress" | "scheduled" | "completed";
};

type ProjectStatus = "" | "ok" | "no_project" | "error";

/**
 * One department's add row, in the same shape as the forecast add form.
 *
 * Basecamp to-dos for this department are the default. "Type it instead"
 * switches to free text that is not linked to Basecamp. A list that does not
 * map to a department stays in the picker and asks for one before Add.
 */
export function SnapshotDepartmentAdd({
  department,
  label,
  todos,
  takenSourceKeys,
  loading,
  projectStatus,
  showRefresh,
  refreshing,
  onAddText,
  onAddTodo,
  onRefresh,
}: {
  department: SnapshotDepartmentSlug;
  label: string;
  todos: SnapshotAddTodo[];
  takenSourceKeys: string[];
  loading: boolean;
  projectStatus: ProjectStatus;
  showRefresh: boolean;
  refreshing: boolean;
  onAddText: (body: string) => Promise<string>;
  onAddTodo: (todo: SnapshotAddTodo, department: SnapshotDepartmentSlug) => Promise<string>;
  onRefresh: () => void;
}) {
  const [preferType, setPreferType] = useState(false);
  const [selectedKey, setSelectedKey] = useState("");
  const [askDept, setAskDept] = useState<SnapshotDepartmentSlug | "">("");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const { matched, unmatched } = useMemo(
    () => pickerTodosForDepartment(todos, department, takenSourceKeys),
    [todos, department, takenSourceKeys]
  );
  const pickable = matched.length + unmatched.length > 0;
  // A word already typed stays typed when the to-do list arrives, same as forecast.
  const usePicker = !preferType && !text.trim() && (loading || pickable);
  const showToggle = loading || pickable;
  const selected =
    [...matched, ...unmatched].find((todo) => todo.sourceKey === selectedKey) || null;
  const needsDepartment = Boolean(selected && selected.department === "unsorted");

  useEffect(() => {
    if (selectedKey && !selected) {
      setSelectedKey("");
      setAskDept("");
    }
  }, [selected, selectedKey]);

  const hint = addHint({
    usePicker,
    preferType,
    loading,
    pickable,
    projectStatus,
    matched: matched.length,
    unmatched: unmatched.length,
  });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setNote("");
    if (usePicker) {
      if (!selected) return;
      const target = needsDepartment ? askDept : department;
      if (!target) {
        setNote("Pick a department for that to-do.");
        return;
      }
      setBusy(true);
      const message = await onAddTodo(selected, target);
      setBusy(false);
      setNote(message);
      if (!message) {
        setSelectedKey("");
        setAskDept("");
      }
      return;
    }
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    const message = await onAddText(body);
    setBusy(false);
    setNote(message);
    if (!message) setText("");
  }

  return (
    <form className="snap-add" onSubmit={(event) => void onSubmit(event)}>
      <div className="snap-add-row">
        {usePicker ? (
          <SnapshotTodoPicker
            label={label}
            matched={matched}
            unmatched={unmatched}
            selected={selected}
            loading={loading && !pickable}
            onSelect={(todo) => {
              setSelectedKey(todo.sourceKey);
              setAskDept("");
              setNote("");
            }}
            onRefresh={onRefresh}
            refreshing={refreshing}
          />
        ) : (
          <input
            value={text}
            aria-label={`${label}: add an item`}
            placeholder="Add an item"
            onChange={(event) => setText(event.target.value)}
          />
        )}
        {needsDepartment ? (
          <select
            aria-label={`Department for ${selected?.title || "this to-do"}`}
            value={askDept}
            onChange={(event) =>
              setAskDept(event.target.value as SnapshotDepartmentSlug | "")
            }
          >
            <option value="">Pick a department</option>
            {SNAPSHOT_DEPARTMENTS.map((dept) => (
              <option key={dept.slug} value={dept.slug}>
                {dept.label.replace(" Department", "")}
              </option>
            ))}
          </select>
        ) : selected ? (
          <span className={`snap-status is-${selected.status}`}>
            {snapshotItemStatusLabel(selected.status)}
          </span>
        ) : null}
        <button
          className="btn btn-sm"
          type="submit"
          disabled={
            busy ||
            (usePicker
              ? !selected || (needsDepartment && !askDept)
              : !text.trim())
          }
        >
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
      {showToggle || showRefresh ? (
        <div className="snap-add-switch">
          {showToggle ? (
            <button
              type="button"
              className="linklike"
              onClick={() => {
                setPreferType((cur) => !cur);
                setNote("");
              }}
            >
              {usePicker ? "Type it instead" : "Pick a todo instead"}
            </button>
          ) : (
            <span />
          )}
          {showRefresh ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onRefresh}
              disabled={refreshing}
            >
              {refreshing ? "Refreshing…" : "Refresh Basecamp"}
            </button>
          ) : null}
        </div>
      ) : null}
      {hint ? <p className="snap-add-hint">{hint}</p> : null}
      {note ? <p className="snap-add-hint">{note}</p> : null}
    </form>
  );
}

function addHint(input: {
  usePicker: boolean;
  preferType: boolean;
  loading: boolean;
  pickable: boolean;
  projectStatus: ProjectStatus;
  matched: number;
  unmatched: number;
}): string {
  if (input.usePicker) {
    if (input.loading && !input.pickable) return "Loading Basecamp to-dos…";
    const parts: string[] = [];
    if (input.matched) {
      parts.push(
        `${input.matched} Basecamp to-do${input.matched === 1 ? "" : "s"} for this department`
      );
    }
    if (input.matched && input.unmatched) {
      parts.push(
        `${input.unmatched} that still ${input.unmatched === 1 ? "needs" : "need"} a department`
      );
    } else if (input.unmatched) {
      parts.push(
        input.unmatched === 1
          ? "1 Basecamp to-do still needs a department"
          : `${input.unmatched} Basecamp to-dos still need a department`
      );
    }
    return parts.length ? `${parts.join(", ")}.` : "";
  }
  if (input.projectStatus === "no_project") {
    return "This client has no Basecamp project set, so type the item instead.";
  }
  if (input.projectStatus === "error") {
    return "Couldn't reach Basecamp, so type the item instead.";
  }
  if (input.preferType && input.pickable) {
    return "Typing this one by hand, so it won't be linked to Basecamp.";
  }
  if (!input.loading && !input.pickable && input.projectStatus) {
    return "No Basecamp to-dos matched this department, so type the item instead.";
  }
  return "";
}

function SnapshotTodoPicker({
  label,
  matched,
  unmatched,
  selected,
  loading,
  onSelect,
  onRefresh,
  refreshing,
}: {
  label: string;
  matched: SnapshotAddTodo[];
  unmatched: SnapshotAddTodo[];
  selected: SnapshotAddTodo | null;
  loading: boolean;
  onSelect: (todo: SnapshotAddTodo) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [popPlace, setPopPlace] = useState<SnapPopPlacement | null>(null);

  const groups = useMemo(
    () => groupPickerTodos(matched, unmatched, query),
    [matched, unmatched, query]
  );
  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  useEffect(() => {
    setActive((index) => (index >= flat.length ? 0 : index));
  }, [flat.length]);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target) || popRef.current?.contains(target)) return;
      setOpen(false);
      setQuery("");
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setPopPlace(null);
      return;
    }
    function place() {
      const anchor = wrapRef.current?.getBoundingClientRect();
      const pop = popRef.current;
      if (!anchor || !pop) return;
      const list = pop.querySelector(".fc-combo-list");
      const refresh = pop.querySelector(".snap-picker-refresh");
      const previousPop = pop.style.maxHeight;
      const previousWidth = pop.style.width;
      const previousList = list instanceof HTMLElement ? list.style.maxHeight : "";
      const margin = 16;
      pop.style.width = `${Math.min(anchor.width, Math.max(0, window.innerWidth - margin))}px`;
      pop.style.maxHeight = "none";
      if (list instanceof HTMLElement) list.style.maxHeight = "none";
      const menuHeight = pop.offsetHeight;
      const chromeHeight = refresh instanceof HTMLElement ? refresh.offsetHeight : 0;
      pop.style.maxHeight = previousPop;
      pop.style.width = previousWidth;
      if (list instanceof HTMLElement) list.style.maxHeight = previousList;
      setPopPlace(
        snapPopPlacement({
          anchorTop: anchor.top,
          anchorBottom: anchor.bottom,
          anchorLeft: anchor.left,
          anchorWidth: anchor.width,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          menuHeight,
          chromeHeight,
        })
      );
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, groups, query]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) setOpen(true);
      else setActive((index) => Math.min(flat.length - 1, index + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === "Enter") {
      if (!open) return;
      const hit = flat[active];
      if (!hit) return;
      event.preventDefault();
      onSelect(hit);
      setOpen(false);
      setQuery("");
      return;
    }
    if (event.key === "Escape") {
      if (!open) return;
      event.stopPropagation();
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div className={`fc-combo fc-combo-todos snap-add-combo${open ? " is-open" : ""}`} ref={wrapRef}>
      <input
        value={open ? query : selected?.title || ""}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={loading ? "Loading Basecamp to-dos…" : selected?.title || "Type to find a todo"}
        disabled={loading}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={`${label}: add an item`}
        autoComplete="off"
      />
      {open && typeof document !== "undefined"
        ? createPortal(
        <div
          className={`fc-combo fc-combo-todos snap-add-pop${popPlace?.flip ? " is-flip" : ""}`}
          ref={popRef}
          style={
            popPlace
              ? {
                  top: popPlace.top,
                  left: popPlace.left,
                  width: popPlace.width,
                  maxHeight: popPlace.maxHeight,
                }
              : { top: 0, left: 0, visibility: "hidden" }
          }
        >
          <ul
            className="fc-combo-list"
            id={listId}
            role="listbox"
            style={popPlace ? { maxHeight: popPlace.listMaxHeight } : undefined}
          >
            {groups.length === 0 ? (
              <li className="fc-combo-empty">{loading ? "Loading…" : "No matches"}</li>
            ) : (
              groups.map((group) => (
                <li key={group.label} className="fc-combo-group">
                  <div className="fc-combo-group-label">{group.label}</div>
                  {group.items.map((todo) => {
                    const index = flat.indexOf(todo);
                    const picked = selected?.sourceKey === todo.sourceKey;
                    return (
                      <button
                        key={todo.sourceKey}
                        type="button"
                        role="option"
                        aria-selected={picked}
                        className={`fc-combo-item${index === active ? " is-active" : ""}${picked ? " is-picked" : ""}`}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          onSelect(todo);
                          setOpen(false);
                          setQuery("");
                        }}
                        onMouseEnter={() => setActive(index)}
                      >
                        <span className="fc-combo-todo">
                          {todo.title}
                          <span className="fc-combo-tag">{snapshotItemStatusLabel(todo.status)}</span>
                        </span>
                      </button>
                    );
                  })}
                </li>
              ))
            )}
          </ul>
          <button
            type="button"
            className="snap-picker-refresh"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onRefresh}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing…" : "Refresh Basecamp"}
          </button>
        </div>,
        document.body
      )
        : null}
    </div>
  );
}

function groupPickerTodos(
  matched: SnapshotAddTodo[],
  unmatched: SnapshotAddTodo[],
  query: string
): Array<{ label: string; items: SnapshotAddTodo[] }> {
  const q = query.trim().toLowerCase();
  const rank = (rows: SnapshotAddTodo[]) => {
    if (!q) return rows;
    const starts: SnapshotAddTodo[] = [];
    const contains: SnapshotAddTodo[] = [];
    const inList: SnapshotAddTodo[] = [];
    for (const todo of rows) {
      const title = todo.title.toLowerCase();
      const place = todo.place.toLowerCase();
      if (title.startsWith(q)) starts.push(todo);
      else if (title.includes(q)) contains.push(todo);
      else if (place.includes(q)) inList.push(todo);
    }
    return [...starts, ...contains, ...inList];
  };
  const groups: Array<{ label: string; items: SnapshotAddTodo[] }> = [];
  const matchedRows = rank(matched);
  const unmatchedRows = rank(unmatched);
  if (q) {
    if (matchedRows.length) groups.push({ label: "This department", items: matchedRows });
    if (unmatchedRows.length) groups.push({ label: "Needs a department", items: unmatchedRows });
    return groups;
  }
  const byPlace = new Map<string, SnapshotAddTodo[]>();
  for (const todo of matchedRows) {
    const place = todo.place || "To-dos";
    const list = byPlace.get(place) || [];
    list.push(todo);
    byPlace.set(place, list);
  }
  for (const [place, items] of byPlace) groups.push({ label: place, items });
  if (unmatchedRows.length) {
    const byPlaceUnmatched = new Map<string, SnapshotAddTodo[]>();
    for (const todo of unmatchedRows) {
      const place = todo.place || "Other lists";
      const list = byPlaceUnmatched.get(place) || [];
      list.push(todo);
      byPlaceUnmatched.set(place, list);
    }
    for (const [place, items] of byPlaceUnmatched) {
      groups.push({ label: `${place} · needs a department`, items });
    }
  }
  return groups;
}
