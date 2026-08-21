"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ForecastCalendar } from "@/components/ForecastCalendar";
import { ForecastQueue } from "@/components/ForecastQueue";
import { minHoursForTodos, splitHours } from "@/lib/forecast-hours";
import {
  queueTodoLinkage,
  queueTodoNotes,
  type ForecastDrag,
  type QueueTodo,
} from "@/lib/forecast-queue";
import {
  formatTimeLabel,
  padTime,
  parseTimeInput,
  staggerStartTimes,
} from "@/lib/forecast-time";
import {
  formatTracked,
  isRunning,
  trackedHours,
  trackedSeconds,
} from "@/lib/forecast-timer";
import { addWeeks, currentWeek, isCurrentWeek, weekLabel } from "@/lib/week";

type Priority = "urgent" | "important" | "flexible";

type Task = {
  id: string;
  person: string;
  task_date: string;
  client: string;
  notes: string;
  hours: number;
  completed: number;
  priority: Priority;
  start_time: string;
  basecamp_todo_id: string;
  basecamp_step_id: string;
  basecamp_project_id: string;
  basecamp_event_id: string;
  actual_hours: number;
  basecamp_time_entry_id: string;
  tracked_seconds: number;
  timer_started_at: string;
};

type Data = {
  label: string;
  week: string;
  tasks: Task[];
  hours: number;
  capacity: number;
  allocationPct: number;
  note: string;
};

type ClientOption = { id: string; name: string; internal?: boolean };

type BcTodo = {
  id: string;
  title: string;
  list: string;
  dueOn: string | null;
  assigned?: boolean;
  kind?: "todo" | "step";
  parentId?: string;
  parentTitle?: string;
};

// Per-client cache of the Basecamp todo picker's contents. `reason` explains an
// empty list so the form can tell someone why they're typing instead of picking.
type TodoState = {
  loading: boolean;
  todos: BcTodo[];
  assignedCount: number;
  projectId: string;
  reason: string | null;
};

// A Basecamp schedule entry, i.e. a meeting. Booked into the forecast so a
// meeting takes up its real hours without anyone creating a todo to represent
// it. Meetings often belong to no client at all (internal MEG calls), which is
// why this picker never asks for one first.
type BcEvent = {
  id: string;
  title: string;
  clientId: string | null;
  clientName: string;
  projectName: string;
  allDay: boolean;
  time: string;
  startTime: string;
  hours: number;
  participants: string;
};

// Per-date cache of the meeting picker, keyed by the day being added to.
type EventState = {
  loading: boolean;
  mine: BcEvent[];
  others: BcEvent[];
  reason: string | null;
};

const PRIORITIES: Priority[] = ["urgent", "important", "flexible"];
const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: "Urgent — can't be moved",
  important: "Important — move only if truly needed",
  flexible: "Flexible — reschedulable, still needs doing",
};

// Same Mon-Fri math as lib/week.ts's weekdays(), duplicated client-side so
// this page doesn't need a server round trip just to lay out the columns.
function weekdays(weekStart: string): string[] {
  const [y, m, d] = weekStart.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < 5; i++) {
    const dt = new Date(y, m - 1, d + i);
    out.push(
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`
    );
  }
  return out;
}

function dayName(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long" });
}
function dayShortDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Keep bulk-add order as the picker lists them, not the order they were ticked,
// so four assigned todos still land in the same order as Basecamp.
function todosInOrder(todos: BcTodo[], ids: string[]): BcTodo[] {
  const want = new Set(ids);
  return todos.filter((t) => want.has(t.id));
}

// "work" is the original flow: pick a client, then one of its Basecamp todos.
// "meeting" books a Basecamp schedule entry instead, so a meeting can take up
// hours without a todo being invented to hold it.
type DraftMode = "work" | "meeting";

type Draft = {
  mode: DraftMode;
  // Selected rev_client. `client` carries the name, which is what gets stored.
  clientId: string;
  client: string;
  notes: string;
  hours: string;
  startTime: string;
  // Basecamp todos picked for this add. One row is created per id, so completing
  // or logging time still attaches to that specific todo. Empty when typing by
  // hand or booking a meeting.
  todoIds: string[];
  projectId: string;
  // Set instead when the row came from the meeting picker. Never set alongside
  // todoIds: a meeting has nothing to close.
  eventId: string;
  // True once someone chooses to type the task rather than pick one.
  manual: boolean;
};

const emptyDraft: Draft = {
  mode: "work",
  clientId: "",
  client: "",
  notes: "",
  hours: "",
  startTime: "",
  todoIds: [],
  projectId: "",
  eventId: "",
  manual: false,
};

/**
 * Type-to-filter client picker.
 *
 * Replaces a plain <select>, which meant scrolling ~60 accounts to find one.
 * Filtering ranks a leading match above a match anywhere in the name, so typing
 * "kr" puts Krak Boba above "Looda House Pawn (Krak)" rather than ordering
 * alphabetically and burying the obvious hit. Internal MEG projects sit in the
 * same list, tagged so they don't read as billing clients.
 */
function ClientCombobox({
  clients,
  value,
  onPick,
  autoFocus,
  style,
}: {
  clients: ClientOption[];
  value: string;
  onPick: (clientId: string) => void;
  autoFocus?: boolean;
  style?: React.CSSProperties;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = clients.find((c) => c.id === value);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    const starts: ClientOption[] = [];
    const contains: ClientOption[] = [];
    for (const c of clients) {
      const n = c.name.toLowerCase();
      if (n.startsWith(q)) starts.push(c);
      else if (n.includes(q)) contains.push(c);
    }
    return [...starts, ...contains];
  }, [clients, query]);

  // The list shrinks as you type, so the highlight has to come back in range or
  // Enter would pick nothing.
  useEffect(() => {
    setActive((a) => (a >= matches.length ? 0 : a));
  }, [matches.length]);

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

  function choose(c: ClientOption) {
    onPick(c.id);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((a) => Math.min(matches.length - 1, a + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
      return;
    }
    if (e.key === "Enter") {
      if (!open) return;
      e.preventDefault();
      const hit = matches[active];
      if (hit) choose(hit);
      return;
    }
    if (e.key === "Escape") {
      if (!open) return;
      // Stop the week view's add form from closing on the same keystroke.
      e.stopPropagation();
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div className="fc-combo" ref={wrapRef} style={style}>
      <input
        ref={inputRef}
        // While open the box is a search field; closed, it displays the choice.
        value={open ? query : selected?.name || ""}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={selected ? selected.name : "Type a client or project"}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Client or project"
        autoComplete="off"
      />
      {open ? (
        <ul className="fc-combo-list" id={listId} role="listbox">
          {matches.length === 0 ? (
            <li className="fc-combo-empty">No matches</li>
          ) : (
            matches.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={c.id === value}
                  className={`fc-combo-item ${i === active ? "is-active" : ""} ${
                    c.id === value ? "is-picked" : ""
                  }`}
                  // mousedown fires before the outside-click handler closes the list.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(c);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  {c.name}
                  {c.internal ? <span className="fc-combo-tag">internal</span> : null}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Type-to-filter Basecamp todo picker, multi-select.
 *
 * A native <select> could only take one todo and could not be searched. This
 * keeps the list open while ticking, so four todos on the same client become
 * four forecast rows in one add. Typing ranks a leading title match above a
 * match anywhere in the title, then a match in the list name.
 */
function TodoPicker({
  todos,
  selectedIds,
  onChange,
  autoFocus,
  style,
}: {
  todos: BcTodo[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  autoFocus?: boolean;
  style?: React.CSSProperties;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return todos;
    const starts: BcTodo[] = [];
    const contains: BcTodo[] = [];
    const inList: BcTodo[] = [];
    for (const t of todos) {
      const title = t.title.toLowerCase();
      const list = t.list.toLowerCase();
      const parent = (t.parentTitle || "").toLowerCase();
      if (title.startsWith(q)) starts.push(t);
      else if (title.includes(q)) contains.push(t);
      else if (list.includes(q) || parent.includes(q)) inList.push(t);
    }
    return [...starts, ...contains, ...inList];
  }, [todos, query]);

  // Empty query: assigned work first, then each Basecamp list. A search flattens
  // that so the ranking above is what you actually see.
  const groups = useMemo(() => {
    const q = query.trim();
    if (q) {
      return filtered.length ? [["Matching", filtered] as [string, BcTodo[]]] : [];
    }
    const assigned = todos.filter((t) => t.assigned);
    const map = new Map<string, BcTodo[]>();
    for (const t of todos) {
      const list = map.get(t.list) || [];
      list.push(t);
      map.set(t.list, list);
    }
    const byList: Array<[string, BcTodo[]]> = [...map.entries()];
    return assigned.length ? [["Assigned to you", assigned] as [string, BcTodo[]], ...byList] : byList;
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

  function toggle(id: string) {
    onChange(selected.has(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
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
      toggle(hit.id);
      return;
    }
    if (e.key === "Escape") {
      if (!open) return;
      e.stopPropagation();
      setOpen(false);
      setQuery("");
    }
  }

  const closedLabel =
    selectedIds.length === 0
      ? ""
      : selectedIds.length === 1
        ? todos.find((t) => t.id === selectedIds[0])?.title || "1 todo selected"
        : `${selectedIds.length} todos selected`;

  return (
    <div className="fc-combo fc-combo-todos" ref={wrapRef} style={style}>
      <input
        value={open ? query : closedLabel}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={closedLabel || "Type to find a todo"}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Basecamp todos"
        autoComplete="off"
      />
      {open ? (
        <ul className="fc-combo-list" id={listId} role="listbox" aria-multiselectable="true">
          {groups.length === 0 ? (
            <li className="fc-combo-empty">No matches</li>
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
                  const picked = selected.has(t.id);
                  return (
                    <button
                      key={`${label}:${t.id}`}
                      type="button"
                      role="option"
                      aria-selected={picked}
                      className={`fc-combo-item ${i === active ? "is-active" : ""} ${
                        picked ? "is-picked" : ""
                      } ${t.kind === "step" ? "is-step" : ""}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        toggle(t.id);
                      }}
                      onMouseEnter={() => setActive(i)}
                    >
                      <span className={`fc-combo-check ${picked ? "is-on" : ""}`} aria-hidden="true" />
                      <span className="fc-combo-todo">
                        {t.title}
                        {t.kind === "step" ? <span className="fc-combo-tag">subtask</span> : null}
                        {t.kind === "step" && t.parentTitle ? (
                          <span className="fc-combo-tag">{t.parentTitle}</span>
                        ) : null}
                        {t.dueOn ? <span className="fc-combo-tag">due {t.dueOn}</span> : null}
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
  );
}

function PriorityPicker({
  value,
  onChange,
}: {
  value: Priority;
  onChange: (p: Priority) => void;
}) {
  return (
    <div className="priority-picker">
      {PRIORITIES.map((p) => (
        <button
          key={p}
          type="button"
          className={`priority-dot ${p} ${value === p ? "is-on" : ""}`}
          title={PRIORITY_LABEL[p]}
          aria-label={PRIORITY_LABEL[p]}
          onClick={() => onChange(p)}
        />
      ))}
    </div>
  );
}

// Why the task field is a text box instead of a picker, in the reader's terms.
// Empty string means the picker is working normally and needs no explanation.
function todoHint(draft: Draft, state: TodoState | undefined): string {
  if (!draft.clientId) return "";
  if (!state || state.loading) return "";
  if (draft.manual) return "Typing this one by hand, so it won't be linked to Basecamp.";
  if (draft.todoIds.length > 1) {
    const hours = Number(draft.hours);
    if (Number.isFinite(hours) && hours > 0) {
      const slices = splitHours(hours, draft.todoIds.length);
      if (slices.every((h) => h > 0)) {
        const same = slices.every((h) => h === slices[0]);
        return same
          ? `${draft.todoIds.length} selected. ${slices[0]}h each.`
          : `${draft.todoIds.length} selected. Split ${slices.join(" / ")}h.`;
      }
    }
    return `${draft.todoIds.length} selected. Hours split across them.`;
  }
  if (!state.todos.length) {
    if (state.reason === "no-project") {
      return "This client has no Basecamp project set, so type the task instead.";
    }
    if (state.reason === "not-connected") {
      return "Basecamp isn't connected, so type the task instead.";
    }
    if (state.reason === "person-not-connected") {
      return "Connect your own Basecamp account to pick from your to-dos. Until then, type the task instead.";
    }
    return "No open Basecamp todos found here, so type the task instead.";
  }
  return `${state.todos.length} open todos${
    state.assignedCount ? `, ${state.assignedCount} assigned to you` : ""
  }.`;
}

// Same idea as todoHint, for the meeting picker.
function eventHint(state: EventState | undefined): string {
  if (!state || state.loading) return "";
  const total = state.mine.length + state.others.length;
  if (!total) {
    if (state.reason === "never-synced") {
      return "Basecamp events haven't synced yet, so there's nothing to pick.";
    }
    return "No Basecamp events on this day.";
  }
  if (!state.mine.length) {
    return `${total} on the schedule, none listing you.`;
  }
  return `${state.mine.length} with you${
    state.others.length ? `, ${state.others.length} other` : ""
  }.`;
}

function StartTimeField({
  task,
  onSave,
}: {
  task: Task;
  onSave: (task: Task, value: string) => void;
}) {
  return (
    <input
      type="time"
      key={`${task.id}-start-${task.start_time || ""}`}
      defaultValue={task.start_time || ""}
      onBlur={(e) => onSave(task, e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      aria-label="Start time"
      title="Start time (optional)"
      className="ops-time"
    />
  );
}

function AddTaskForm({
  draft,
  patch,
  clients,
  todoState,
  eventState,
  onPickClient,
  onPickMode,
  onAdd,
  onCancel,
  layout,
  autoFocus,
  busy,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  clients: ClientOption[];
  todoState: TodoState | undefined;
  eventState: EventState | undefined;
  onPickClient: (clientId: string) => void;
  onPickMode: (mode: DraftMode) => void;
  onAdd: () => void;
  onCancel?: () => void;
  layout: "row" | "stack";
  autoFocus?: boolean;
  busy?: boolean;
}) {
  const stack = layout === "stack";
  const todos = useMemo(() => todoState?.todos || [], [todoState]);
  const meeting = draft.mode === "meeting";
  const selectedCount = draft.todoIds.length;

  const usePicker = Boolean(draft.clientId) && !draft.manual && todos.length > 0;
  const hint = meeting ? eventHint(eventState) : todoHint(draft, todoState);

  // Work or meeting. Kept as two small buttons rather than a select because it
  // switches which fields are shown, and a select there reads like data entry.
  const modeToggle = (
    <div className="fc-mode" role="group" aria-label="What are you adding?">
      <button
        type="button"
        className={`fc-mode-btn ${draft.mode === "work" ? "is-on" : ""}`}
        onClick={() => onPickMode("work")}
      >
        Work
      </button>
      <button
        type="button"
        className={`fc-mode-btn ${meeting ? "is-on" : ""}`}
        onClick={() => onPickMode("meeting")}
      >
        Meeting
      </button>
    </div>
  );

  const meetingEvents = useMemo(() => {
    const mine = eventState?.mine || [];
    const others = eventState?.others || [];
    const out: Array<[string, BcEvent[]]> = [];
    if (mine.length) out.push(["On your schedule", mine]);
    if (others.length) out.push(["Other meetings that day", others]);
    return out;
  }, [eventState]);

  const hasEvents = Boolean(
    (eventState?.mine.length || 0) + (eventState?.others.length || 0)
  );

  // Picking a meeting fills in everything the row needs: the title becomes the
  // task text, the duration becomes the hours, and the event's client (if it has
  // one) is carried across so the row still lands under that client.
  const meetingField = hasEvents ? (
    <select
      autoFocus={autoFocus}
      value={draft.eventId}
      onChange={(e) => {
        const all = [...(eventState?.mine || []), ...(eventState?.others || [])];
        const hit = all.find((v) => v.id === e.target.value);
        patch({
          eventId: hit?.id || "",
          notes: hit?.title || "",
          hours: hit && hit.hours > 0 ? String(hit.hours) : "",
          startTime: hit && !hit.allDay ? hit.startTime || "" : "",
          clientId: hit?.clientId || "",
          client: hit?.clientName || "",
          todoIds: [],
          projectId: "",
        });
      }}
      aria-label="Basecamp meeting"
      style={stack ? undefined : { flex: "3 1 260px" }}
    >
      <option value="">Pick a meeting</option>
      {meetingEvents.map(([label, items]) => (
        <optgroup key={label} label={label}>
          {items.map((v) => (
            <option key={`${label}:${v.id}`} value={v.id}>
              {v.time ? `${v.time} · ` : ""}
              {v.title}
              {v.clientName ? ` (${v.clientName})` : ""}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  ) : (
    <input
      value={draft.notes}
      onChange={(e) => patch({ notes: e.target.value, eventId: "" })}
      placeholder={eventState?.loading ? "Loading meetings..." : "Meeting name"}
      disabled={Boolean(eventState?.loading)}
      style={stack ? undefined : { flex: "3 1 260px" }}
    />
  );

  const clientSelect = (
    <ClientCombobox
      clients={clients}
      value={draft.clientId}
      onPick={onPickClient}
      autoFocus={autoFocus}
      style={stack ? undefined : { flex: "1 1 170px" }}
    />
  );

  const taskField = usePicker ? (
    <TodoPicker
      todos={todos}
      selectedIds={draft.todoIds}
      onChange={(todoIds) => patch({ todoIds })}
      style={stack ? undefined : { flex: "2 1 260px" }}
    />
  ) : (
    <input
      value={draft.notes}
      onChange={(e) => patch({ notes: e.target.value, todoIds: [], projectId: "" })}
      placeholder={
        !draft.clientId
          ? "Pick a client or project first"
          : todoState?.loading
            ? "Loading todos..."
            : "Task notes"
      }
      disabled={!draft.clientId || Boolean(todoState?.loading)}
      style={stack ? undefined : { flex: "2 1 240px" }}
    />
  );

  const hoursInput = (
    <input
      value={draft.hours}
      onChange={(e) => patch({ hours: e.target.value })}
      placeholder={selectedCount > 1 ? "Hours (split)" : "Hours"}
      type="number"
      min="0"
      step="0.5"
      aria-label={selectedCount > 1 ? "Hours, split across selected todos" : "Hours"}
      style={stack ? { flex: 1 } : { width: 90 }}
    />
  );

  const startInput = (
    <input
      type="time"
      value={draft.startTime}
      onChange={(e) => patch({ startTime: e.target.value })}
      aria-label="Start time"
      title="Start time (optional)"
      className="ops-time"
      style={stack ? { flex: 1 } : undefined}
    />
  );

  // Only worth offering once there are todos to switch away from, and never for
  // meetings, which have their own free-text fallback built in.
  const manualToggle =
    !meeting && draft.clientId && todos.length > 0 ? (
      <button
        type="button"
        className="linklike"
        style={{ fontSize: 12 }}
        onClick={() =>
          patch({ manual: !draft.manual, notes: "", todoIds: [], projectId: "" })
        }
      >
        {draft.manual ? "Pick a todo instead" : "Type it instead"}
      </button>
    ) : null;

  const addLabel = meeting
    ? "Add meeting"
    : selectedCount > 1
      ? `Add ${selectedCount} tasks`
      : "Add task";

  if (stack) {
    return (
      <div className="ops-day-add-form">
        {modeToggle}
        {/* Meetings skip the client select entirely: most of them are internal
            and have no client, and the picked event supplies one when it has. */}
        {meeting ? meetingField : clientSelect}
        {meeting ? null : taskField}
        <div className="row" style={{ gap: 6 }}>
          {startInput}
          {hoursInput}
          <button className="btn btn-sm" onClick={onAdd} disabled={busy}>
            {busy ? "Adding…" : addLabel}
          </button>
        </div>
        {manualToggle}
        {hint ? (
          <p className="muted" style={{ fontSize: 11, margin: "2px 0 0" }}>
            {hint}
          </p>
        ) : null}
        {onCancel ? (
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {modeToggle}
        {meeting ? meetingField : clientSelect}
        {meeting ? null : taskField}
        {startInput}
        {hoursInput}
        <button className="btn btn-sm" onClick={onAdd} disabled={busy}>
          {busy ? "Adding…" : addLabel}
        </button>
        {onCancel ? (
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
      {manualToggle || hint ? (
        <div className="row" style={{ gap: 10, marginTop: 6, flexWrap: "wrap" }}>
          {manualToggle}
          {hint ? (
            <span className="muted" style={{ fontSize: 12 }}>
              {hint}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type View = "today" | "list" | "week" | "calendar";

export default function PersonForecastPage() {
  const router = useRouter();
  const { person } = useParams<{ person: string }>();
  const searchParams = useSearchParams();

  const [week, setWeek] = useState(searchParams.get("week") || currentWeek());
  const [view, setView] = useState<View>(isCurrentWeek(searchParams.get("week") || currentWeek()) ? "today" : "list");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [role, setRole] = useState<"admin" | "forecast" | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [clients, setClients] = useState<ClientOption[]>([]);
  // Internal MEG Basecamp projects (HQs, team workspaces, etc.) that aren't
  // rev_clients but still have todos worth forecasting against. Merged into
  // the same picker with an "internal:" prefixed id so ensureTodos knows to
  // hit /api/forecast/todos?project= instead of ?client=.
  const [internalProjects, setInternalProjects] = useState<ClientOption[]>([]);
  const [todosByClient, setTodosByClient] = useState<Record<string, TodoState>>({});
  // Meeting picker contents, keyed by the day being added to rather than by
  // client, because a meeting is scoped to a date and often has no client.
  const [eventsByDate, setEventsByDate] = useState<Record<string, EventState>>({});
  // Manual refresh of the Basecamp schedule cache. It syncs itself on boot when
  // stale, but a meeting added this morning would not show until then, and this
  // page is now the only place that cache is used.
  const [syncingEvents, setSyncingEvents] = useState(false);
  const [syncingProjects, setSyncingProjects] = useState(false);
  // taskId -> hours typed into that task's "log time" box. Logging is explicit:
  // the hours go onto a client-visible Basecamp timesheet and can't be unsent,
  // so ticking a task never posts on its own.
  const [logDrafts, setLogDrafts] = useState<Record<string, string>>({});
  // Rows whose log box is open. Defaults to open until something has been logged,
  // then collapses to a "Log more time" link so a finished row reads as finished.
  const [logExpanded, setLogExpanded] = useState<Record<string, boolean>>({});
  const [logging, setLogging] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Ticks once a second, but only while something is being timed, so a page left
  // open on a quiet week re-renders no more than it used to.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [timerBusy, setTimerBusy] = useState<string | null>(null);
  // Task currently being dragged, and the day it's hovering over. Both are
  // needed: the card dims itself, and only the hovered day highlights.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropDay, setDropDay] = useState<string | null>(null);
  // What the calendar is currently receiving: an existing row being moved, or a
  // Basecamp to-do being booked for the first time. Held here rather than on the
  // drag event because dragover can't read dataTransfer, and the grid needs to
  // know mid-drag how long the thing it's about to place is.
  const [drag, setDrag] = useState<ForecastDrag | null>(null);
  // Which client the queue sidebar is showing Basecamp to-dos for, and how many
  // hours a dragged-in to-do should book.
  const [queueClientId, setQueueClientId] = useState("");
  const [queueHours, setQueueHours] = useState("1");

  function draftFor(date: string): Draft {
    return drafts[date] || emptyDraft;
  }
  function setDraft(date: string, patch: Partial<Draft>) {
    setDrafts((d) => ({ ...d, [date]: { ...(d[date] || emptyDraft), ...patch } }));
  }

  function applyPicker(json: {
    clients?: Array<{ id: string; name: string }>;
    internals?: Array<{ id: string; name: string }>;
  }) {
    if (Array.isArray(json.clients)) {
      setClients(
        json.clients
          .map((c) => ({ id: c.id, name: c.name }))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
    }
    if (Array.isArray(json.internals)) {
      setInternalProjects(
        json.internals.map((p) => ({
          id: `internal:${p.id}`,
          name: p.name,
          internal: true,
        }))
      );
    }
  }

  // silent = true skips the loading indicator so the whole task list doesn't
  // unmount (and the page doesn't jump to the top) after a checkbox toggle
  // or field edit refetches in the background.
  async function load(w: string, opts?: { silent?: boolean }) {
    if (!opts?.silent) setLoading(true);
    const res = await fetch(`/api/forecast/${person}?week=${w}`);
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) {
      setError("Failed to load.");
      setLoading(false);
      return;
    }
    const json = await res.json();
    setData(json);
    setNoteDraft(json.note || "");
    setLoading(false);
  }

  async function saveNote() {
    setNoteSaving(true);
    await fetch(`/api/forecast/${person}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ week, note: noteDraft }),
    });
    setNoteSaving(false);
  }

  useEffect(() => {
    load(week);
    router.replace(`/admin/forecast/${person}?week=${week}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, person]);
  useEffect(() => {
    fetch("/api/auth")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.authenticated) setRole(data.role);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!person) return;
    fetch(`/api/forecast/projects?person=${person}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!json) return;
        applyPicker(json);
      })
      .catch(() => {});
  }, [person]);

  // Client picker contents: revenue clients first, then internal Basecamp
  // projects (HQs, team workspaces) that have todos but aren't billing clients.
  const pickerClients = useMemo(
    () => [...clients, ...internalProjects],
    [clients, internalProjects]
  );

  // Basecamp is slow enough that this is fetched once per client and reused
  // across every day's form for the rest of the visit.
  // Which clients have already been requested this visit. This is a ref, not
  // state, because it has to be readable synchronously: a setState updater runs
  // during render, so a flag assigned inside one is still unset on the next line
  // and the fetch below never fires — which left the picker stuck on
  // "Loading todos..." forever with no request ever sent.
  const requestedTodos = useRef<Set<string>>(new Set());

  const ensureTodos = useCallback(
    async (clientId: string) => {
      if (!clientId) return;
      if (requestedTodos.current.has(clientId)) return;
      requestedTodos.current.add(clientId);
      setTodosByClient((prev) => ({
        ...prev,
        [clientId]: {
          loading: true,
          todos: [],
          assignedCount: 0,
          projectId: "",
          reason: null,
        },
      }));
      try {
        const query = clientId.startsWith("internal:")
          ? `project=${encodeURIComponent(clientId.slice("internal:".length))}`
          : `client=${encodeURIComponent(clientId)}`;
        const res = await fetch(`/api/forecast/todos?person=${person}&${query}`);
        const json = res.ok ? await res.json() : null;
        if (!res.ok) requestedTodos.current.delete(clientId);
        setTodosByClient((prev) => ({
          ...prev,
          [clientId]: {
            loading: false,
            todos: Array.isArray(json?.todos) ? json.todos : [],
            assignedCount: Number(json?.assignedCount) || 0,
            projectId: json?.projectId || "",
            reason: json?.reason ?? (res.ok ? null : "failed"),
          },
        }));
      } catch {
        // Drop the marker so re-picking the client retries rather than being
        // stuck with a failed result for the rest of the visit.
        requestedTodos.current.delete(clientId);
        setTodosByClient((prev) => ({
          ...prev,
          [clientId]: {
            loading: false,
            todos: [],
            assignedCount: 0,
            projectId: "",
            reason: "failed",
          },
        }));
      }
    },
    [person]
  );

  function pickClient(date: string, clientId: string) {
    const hit = pickerClients.find((c) => c.id === clientId);
    // Changing client invalidates whatever task was picked for the old one.
    setDraft(date, {
      clientId,
      client: hit?.name || "",
      notes: "",
      todoIds: [],
      projectId: clientId.startsWith("internal:")
        ? clientId.slice("internal:".length)
        : "",
      manual: false,
    });
    ensureTodos(clientId);
  }

  // Meetings come from the local basecamp_events cache, so this is a cheap read
  // and re-fetching on every switch into meeting mode keeps it current without a
  // "requested" marker of its own.
  const ensureEvents = useCallback(
    async (date: string) => {
      setEventsByDate((prev) => ({
        ...prev,
        [date]: prev[date] || { loading: true, mine: [], others: [], reason: null },
      }));
      try {
        const res = await fetch(
          `/api/forecast/events?person=${person}&date=${encodeURIComponent(date)}`
        );
        const json = res.ok ? await res.json() : null;
        setEventsByDate((prev) => ({
          ...prev,
          [date]: {
            loading: false,
            mine: Array.isArray(json?.mine) ? json.mine : [],
            others: Array.isArray(json?.others) ? json.others : [],
            reason: json?.reason ?? (res.ok ? null : "failed"),
          },
        }));
      } catch {
        setEventsByDate((prev) => ({
          ...prev,
          [date]: { loading: false, mine: [], others: [], reason: "failed" },
        }));
      }
    },
    [person]
  );

  async function syncMeetings() {
    setSyncingEvents(true);
    setError("");
    const res = await fetch("/api/basecamp/events", { method: "POST" });
    setSyncingEvents(false);
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      setError(json?.error || "Could not sync Basecamp meetings.");
      return;
    }
    // Drop the cached picker contents so the next open re-reads the fresh table.
    setEventsByDate({});
  }

  async function syncProjects() {
    setSyncingProjects(true);
    setError("");
    const res = await fetch(`/api/forecast/projects?person=${person}`, { method: "POST" });
    setSyncingProjects(false);
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      setError(json?.error || "Could not sync Basecamp projects.");
      return;
    }
    const json = await res.json().catch(() => null);
    if (json) applyPicker(json);
  }

  // Switching mode clears whatever was picked under the old one, so a half-filled
  // work row can't be submitted as a meeting or the reverse.
  function pickMode(date: string, mode: DraftMode) {
    setDraft(date, {
      mode,
      notes: "",
      hours: "",
      todoIds: [],
      projectId: "",
      eventId: "",
      clientId: "",
      client: "",
      manual: false,
    });
    if (mode === "meeting") ensureEvents(date);
  }

  const running = useMemo(
    () => (data?.tasks || []).find((t) => isRunning(t)) || null,
    [data]
  );
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const days = useMemo(() => weekdays(week), [week]);
  const today = todayYmd();
  // Which day a queued item lands on when nobody picked an hour for it: today
  // while you're looking at this week, otherwise the Monday of the week on
  // screen, so a to-do queued for next week doesn't quietly land in this one.
  const queueDay = days.includes(today) ? today : days[0];
  const progress = useMemo(() => {
    const all = data?.tasks || [];
    const done = all.filter((t) => t.completed).length;
    return { done, total: all.length, pct: all.length ? Math.round((done / all.length) * 100) : 0 };
  }, [data]);
  // Hours split into done vs still planned, both as a share of the weekly
  // capacity, so one track shows progress and load at once.
  const gauge = useMemo(() => {
    const all = data?.tasks || [];
    const capacity = data?.capacity || 40;
    const doneHours = all.filter((t) => t.completed).reduce((s, t) => s + t.hours, 0);
    const totalHours = all.reduce((s, t) => s + t.hours, 0);
    const openHours = totalHours - doneHours;
    const pct = capacity ? Math.round((totalHours / capacity) * 100) : 0;
    return {
      capacity,
      doneHours,
      openHours,
      totalHours,
      pct,
      // Bars are capped at the track width; the percentage still reads over 100.
      donePct: capacity ? Math.min(100, (doneHours / capacity) * 100) : 0,
      openPct: capacity ? Math.min(100 - Math.min(100, (doneHours / capacity) * 100), (openHours / capacity) * 100) : 0,
      over: totalHours > capacity,
      clear: all.length > 0 && doneHours === totalHours,
    };
  }, [data]);
  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of data?.tasks || []) {
      const list = map.get(t.task_date) || [];
      list.push(t);
      map.set(t.task_date, list);
    }
    return map;
  }, [data]);

  async function addTask(date: string) {
    const draft = draftFor(date);
    const hours = Number(draft.hours);
    const meeting = draft.mode === "meeting";
    const state = todosByClient[draft.clientId];
    const selected = meeting
      ? []
      : todosInOrder(state?.todos || [], draft.todoIds);

    if (meeting) {
      if (!draft.notes.trim()) {
        setError("Pick a meeting, or type what it is.");
        return;
      }
    } else if (!draft.client.trim()) {
      setError("Pick a client for that task.");
      return;
    } else if (!draft.manual && (state?.todos.length || 0) > 0 && selected.length === 0) {
      setError("Pick at least one todo, or type it instead.");
      return;
    }
    if (!Number.isFinite(hours) || hours <= 0) {
      setError(
        meeting
          ? "Enter how long that meeting runs."
          : selected.length > 1
            ? "Enter how many hours to split across those todos."
            : "Enter how many hours that task should take."
      );
      return;
    }
    const startTime = parseTimeInput(draft.startTime);

    const rows: Array<{
      notes: string;
      hours: number;
      todoId: string;
      stepId: string;
      eventId: string;
      startTime: string;
    }> = [];
    if (meeting || draft.manual || selected.length === 0) {
      rows.push({
        notes: draft.notes,
        hours,
        todoId: "",
        stepId: "",
        eventId: meeting ? draft.eventId : "",
        startTime,
      });
    } else {
      const slices = splitHours(hours, selected.length);
      if (slices.some((h) => h <= 0)) {
        setError(
          `Enter at least ${minHoursForTodos(selected.length)} hours to split across ${selected.length} todos.`
        );
        return;
      }
      const starts = staggerStartTimes(startTime, slices);
      for (let i = 0; i < selected.length; i++) {
        // A subtask sends both ids: the step is what gets ticked off, its parent
        // to-do is what hours can be logged against.
        const link = queueTodoLinkage(selected[i]);
        rows.push({
          notes: queueTodoNotes(selected[i]),
          hours: slices[i],
          todoId: link.basecampTodoId,
          stepId: link.basecampStepId,
          eventId: "",
          startTime: starts[i],
        });
      }
    }

    setError("");
    setSaving(true);
    const projectId = meeting ? "" : state?.projectId || draft.projectId || "";
    const results = await Promise.all(
      rows.map((row) =>
        fetch(`/api/forecast/${person}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskDate: date,
            client: draft.client,
            notes: row.notes,
            hours: row.hours,
            basecampTodoId: row.todoId,
            basecampStepId: row.stepId,
            basecampProjectId: projectId,
            basecampEventId: row.eventId,
            startTime: row.startTime,
          }),
        })
      )
    );
    setSaving(false);
    if (results.some((res) => !res.ok)) {
      setError(
        rows.length > 1
          ? "Could not add some of those tasks. Refresh and try the ones that are missing."
          : meeting
            ? "Could not add that meeting."
            : "Could not add that task."
      );
      load(week, { silent: true });
      return;
    }
    setDrafts((d) => ({ ...d, [date]: emptyDraft }));
    setAddingFor(null);
    load(week, { silent: true });
  }

  async function removeTask(id: string) {
    const res = await fetch(`/api/forecast/${person}/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Could not remove that task.");
      return;
    }
    load(week, { silent: true });
  }

  async function saveField(
    task: Task,
    field: "client" | "notes" | "hours" | "start_time",
    rawValue: string
  ) {
    if (field === "start_time") {
      const next = parseTimeInput(rawValue);
      if (rawValue.trim() && !next) {
        setError("Start time must be a time.");
        load(week, { silent: true });
        return;
      }
      if (next === (task.start_time || "")) return;
      setError("");
      const res = await fetch(`/api/forecast/${person}/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startTime: next }),
      });
      if (!res.ok) setError("Could not save that start time.");
      load(week, { silent: true });
      return;
    }
    if (field === "hours") {
      const hours = Number(rawValue);
      if (!Number.isFinite(hours) || hours <= 0) {
        setError("Hours must be a positive number.");
        load(week);
        return;
      }
      if (hours === task.hours) return;
      setError("");
      const res = await fetch(`/api/forecast/${person}/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours }),
      });
      if (!res.ok) setError("Could not save that task.");
      load(week, { silent: true });
      return;
    }
    if (field === "client" && !rawValue.trim()) {
      setError("A task needs a client.");
      load(week, { silent: true });
      return;
    }
    if (rawValue === task[field]) return;
    setError("");
    const res = await fetch(`/api/forecast/${person}/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: rawValue }),
    });
    if (!res.ok) setError("Could not save that task.");
    load(week, { silent: true });
  }

  async function toggleCompleted(task: Task) {
    const res = await fetch(`/api/forecast/${person}/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: !task.completed }),
    });
    if (!res.ok) {
      setError("Could not update that task.");
      return;
    }
    // The forecast row saved either way, so a Basecamp sync failure is a notice
    // rather than an error that implies nothing happened.
    const json = await res.json().catch(() => null);
    if (json?.basecamp && !json.basecamp.synced) {
      setError(
        `Saved here, but the Basecamp todo didn't update${
          json.basecamp.error ? `: ${json.basecamp.error}` : "."
        }`
      );
    } else {
      setError("");
    }
    load(week, { silent: true });
  }

  /* ------------------------------------------------------ drag to reschedule */

  function onDragStart(e: React.DragEvent, task: { id: string }) {
    setDragId(task.id);
    e.dataTransfer.effectAllowed = "move";
    // Firefox won't start a drag without data set.
    e.dataTransfer.setData("text/plain", task.id);
  }

  // Dragging an existing row. grabOffsetMin is how far into the block the pointer
  // took hold of it, so dropping puts the block's start where it was picked up
  // from instead of shunting it later by however far down it was grabbed. It's 0
  // for a queue card, which has no position on the grid to grab by.
  function onTaskDragStart(
    e: React.DragEvent,
    task: { id: string; hours: number },
    grabOffsetMin = 0
  ) {
    onDragStart(e, task);
    setDrag({
      kind: "task",
      id: task.id,
      grabOffsetMin,
      durationMin: Math.round((task.hours || 0) * 60),
    });
  }

  // Dragging a Basecamp to-do that isn't on the forecast yet. It becomes a row
  // when it lands, taking the hours typed in the queue.
  function onTodoDragStart(e: React.DragEvent, todo: QueueTodo) {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/plain", todo.id);
    const hours = Number(queueHours);
    setDrag({
      kind: "todo",
      todo,
      durationMin: Math.round((Number.isFinite(hours) && hours > 0 ? hours : 1) * 60),
    });
  }

  function onDragEnd() {
    setDragId(null);
    setDropDay(null);
    setDrag(null);
  }

  function onDayDragOver(e: React.DragEvent, date: string) {
    if (!dragId && !drag) return;
    // Only preventDefault marks this as a valid drop target.
    e.preventDefault();
    e.dataTransfer.dropEffect = drag?.kind === "todo" ? "copy" : "move";
    if (dropDay !== date) setDropDay(date);
  }

  async function moveTask(id: string, date: string, startTime?: string | null) {
    const task = (data?.tasks || []).find((t) => t.id === id);
    if (!task) return;
    const nextTime =
      startTime === undefined ? task.start_time || "" : parseTimeInput(startTime ?? "");
    if (task.task_date === date && nextTime === (task.start_time || "")) return;

    setData((d) =>
      d
        ? {
            ...d,
            tasks: d.tasks.map((t) =>
              t.id === id ? { ...t, task_date: date, start_time: nextTime } : t
            ),
          }
        : d
    );
    const body: { taskDate: string; startTime?: string } = { taskDate: date };
    if (startTime !== undefined) body.startTime = nextTime;
    const res = await fetch(`/api/forecast/${person}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setError("Could not move that task.");
      load(week, { silent: true });
      return;
    }
    setError("");
    load(week, { silent: true });
  }

  // Turn a Basecamp to-do into a forecast row. `startTime` is empty when it was
  // queued rather than dropped on an hour, which leaves it in the sidebar.
  async function bookTodo(todo: QueueTodo, date: string, startTime: string) {
    const raw = Number(queueHours);
    const hours = Number.isFinite(raw) && raw > 0 ? raw : 1;
    setSaving(true);
    const res = await fetch(`/api/forecast/${person}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskDate: date,
        client: todo.clientName,
        notes: queueTodoNotes(todo),
        hours,
        ...queueTodoLinkage(todo),
        basecampProjectId: todo.projectId,
        startTime,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Could not add that Basecamp to-do.");
      return;
    }
    setError("");
    load(week, { silent: true });
  }

  // One drop handler for the whole grid: move the row that was dragged, or book
  // the Basecamp to-do that was, depending on what's in flight.
  async function placeDrag(date: string, startTime: string) {
    const held = drag;
    setDrag(null);
    setDragId(null);
    setDropDay(null);
    if (!held) return;
    if (held.kind === "task") {
      await moveTask(held.id, date, startTime);
      return;
    }
    await bookTodo(held.todo, date, startTime);
  }

  // Dragging a block's bottom edge changes how long it runs for.
  async function resizeTask(task: { id: string; hours: number }, hours: number) {
    if (hours === task.hours) return;
    setData((d) =>
      d ? { ...d, tasks: d.tasks.map((t) => (t.id === task.id ? { ...t, hours } : t)) } : d
    );
    const res = await fetch(`/api/forecast/${person}/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hours }),
    });
    if (!res.ok) setError("Could not change that task's length.");
    load(week, { silent: true });
  }

  function pickQueueClient(clientId: string) {
    setQueueClientId(clientId);
    if (clientId) ensureTodos(clientId);
  }

  async function onDayDrop(e: React.DragEvent, date: string) {
    e.preventDefault();
    const held = drag;
    const id = dragId || e.dataTransfer.getData("text/plain");
    setDragId(null);
    setDropDay(null);
    setDrag(null);
    // A day column has no hour under the cursor, so a to-do dropped here is
    // booked to that day and stays in the queue until it's given a time.
    if (held?.kind === "todo") {
      await bookTodo(held.todo, date, "");
      return;
    }
    if (!id) return;
    await moveTask(id, date);
  }

  // Spread across the day containers in every view that accepts a drop.
  function dayDropProps(date: string) {
    return {
      onDragOver: (e: React.DragEvent) => onDayDragOver(e, date),
      onDragLeave: (e: React.DragEvent) => {
        // Ignore the events fired while crossing child elements.
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDropDay((d) => (d === date ? null : d));
      },
      onDrop: (e: React.DragEvent) => onDayDrop(e, date),
    };
  }

  function dragProps(task: { id: string }) {
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent) => onDragStart(e, task),
      onDragEnd,
    };
  }

  /**
   * What the log box starts out reading.
   *
   * Measured time wins when the timer has run — that is the whole point of having
   * timed it, and it's already net of whatever was sent before. Otherwise it's
   * the forecast estimate first time round, and blank once hours are on the row,
   * so a second log is always a number somebody typed on purpose.
   */
  function logDefault(task: Task): string {
    const outstanding =
      Math.round((trackedHours(task, nowMs) - task.actual_hours) * 100) / 100;
    if (outstanding > 0) return String(outstanding);
    if (task.basecamp_time_entry_id) return "";
    return String(task.hours);
  }

  async function logTime(task: Task) {
    const raw = logDrafts[task.id] ?? logDefault(task);
    const hours = Number(raw);
    if (!Number.isFinite(hours) || hours <= 0) {
      setError("Enter how many hours to log to Basecamp.");
      return;
    }
    setLogging(task.id);
    const res = await fetch(`/api/forecast/${person}/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logTimeHours: hours }),
    });
    setLogging(null);
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      setError(json?.error || "Could not log that time to Basecamp.");
      return;
    }
    setError("");
    setLogDrafts((d) => {
      const next = { ...d };
      delete next[task.id];
      return next;
    });
    setLogExpanded((d) => ({ ...d, [task.id]: false }));
    load(week, { silent: true });
  }

  /**
   * Start or stop timing a task.
   *
   * One timer runs at a time, so starting a second task banks the first one's
   * time and says which task stopped. A task with no slot on the calendar is
   * placed at the current hour when its timer starts, so the block that grows as
   * you work is somewhere you can see it.
   */
  async function toggleTimer(task: Task) {
    const stopping = isRunning(task);
    setTimerBusy(task.id);

    if (!stopping && !task.start_time && task.task_date === today) {
      const now = new Date();
      await fetch(`/api/forecast/${person}/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startTime: padTime(now.getHours(), Math.floor(now.getMinutes() / 15) * 15),
        }),
      });
    }

    const res = await fetch(`/api/forecast/${person}/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timer: stopping ? "stop" : "start" }),
    });
    setTimerBusy(null);
    if (!res.ok) {
      setError(stopping ? "Could not stop that timer." : "Could not start that timer.");
      return;
    }
    const json = await res.json().catch(() => null);
    if (json?.stopped) {
      const what = json.stopped.notes || json.stopped.client || "the last task";
      setError(`Timer moved. ${what} stopped and kept its time.`);
    } else {
      setError("");
    }
    setNowMs(Date.now());
    load(week, { silent: true });
  }

  function TimerButton({ task, compact }: { task: Task; compact?: boolean }) {
    const live = isRunning(task);
    const seconds = trackedSeconds(task, nowMs);
    return (
      <button
        type="button"
        className={`fc-timer-btn ${live ? "is-running" : ""} ${compact ? "is-compact" : ""}`}
        disabled={timerBusy === task.id}
        onClick={(e) => {
          e.stopPropagation();
          void toggleTimer(task);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        title={
          live
            ? "Stop the timer and keep the time"
            : seconds
              ? `${formatTracked(seconds, false)} tracked so far. Start again to add to it.`
              : "Start timing this task"
        }
      >
        <span className="fc-timer-icon" aria-hidden="true" />
        {live
          ? formatTracked(seconds, true)
          : seconds
            ? formatTracked(seconds, false)
            : compact
              ? "Start"
              : "Start task"}
      </button>
    );
  }

  // Shown for any row linked to something in Basecamp, whether that's a todo, a
  // subtask, a meeting, or (for a task typed by hand) just the project it
  // belongs to — logTime() creates a shadow todo in that project the first time
  // someone logs against a row like that. Only a row linked to nothing at all
  // has nowhere for hours to land.
  //
  // Deliberately not gated on the task being finished. Work spans days, and time
  // has to go in while it's still fresh, so each log adds to the row's total
  // rather than replacing it and nothing here waits for a tick.
  function LogTimeRow({ task }: { task: Task }) {
    const linked = task.basecamp_todo_id || task.basecamp_event_id || task.basecamp_project_id;
    if (!linked) return null;
    const logged = Boolean(task.basecamp_time_entry_id);
    const [expanded, setExpanded] = [
      logExpanded[task.id] ?? !logged,
      (on: boolean) => setLogExpanded((d) => ({ ...d, [task.id]: on })),
    ];
    return (
      <div className="fc-log-row">
        {logged ? (
          <span className="fc-log-total">{task.actual_hours}h logged</span>
        ) : null}
        {expanded ? (
          <>
            <span className="muted" style={{ fontSize: 12 }}>
              {logged ? "Add hours" : "Hours spent so far"}
            </span>
            <input
              value={logDrafts[task.id] ?? logDefault(task)}
              onChange={(e) => setLogDrafts((d) => ({ ...d, [task.id]: e.target.value }))}
              type="number"
              min="0"
              step="0.25"
              aria-label="Hours to log to Basecamp"
              style={{ width: 70 }}
            />
            <button
              className="btn btn-sm"
              disabled={logging === task.id}
              onClick={() => logTime(task)}
            >
              {logging === task.id ? "Logging..." : "Log to Basecamp"}
            </button>
            {logged ? (
              <button type="button" className="linklike" onClick={() => setExpanded(false)}>
                Cancel
              </button>
            ) : null}
          </>
        ) : (
          <button type="button" className="linklike" onClick={() => setExpanded(true)}>
            Log more time
          </button>
        )}
      </div>
    );
  }

  async function setPriority(task: Task, priority: Priority) {
    if (priority === task.priority) return;
    const res = await fetch(`/api/forecast/${person}/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority }),
    });
    if (!res.ok) setError("Could not update priority.");
    load(week, { silent: true });
  }

  return (
    <div className="ops-scope">
      <div className="page-actions">
        {role === "admin" ? (
          <Link className="btn btn-ghost btn-sm" href="/admin/forecast">All forecasts</Link>
        ) : null}
      </div>

      <div className="ops-page">
        <div className="ops-page-head">
          <div>
            <p className="ops-eyebrow">Weekly forecast</p>
            <h1 className="ops-title">{data?.label || person}</h1>
            <p className="ops-sub">Add what you expect to work on each day this week.</p>
          </div>
          <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
            <div className="view-toggle">
              <button className={`view-toggle-btn ${view === "today" ? "is-on" : ""}`} onClick={() => setView("today")}>
                Today
              </button>
              <button className={`view-toggle-btn ${view === "list" ? "is-on" : ""}`} onClick={() => setView("list")}>
                List
              </button>
              <button className={`view-toggle-btn ${view === "week" ? "is-on" : ""}`} onClick={() => setView("week")}>
                Week
              </button>
              <button className={`view-toggle-btn ${view === "calendar" ? "is-on" : ""}`} onClick={() => setView("calendar")}>
                Calendar
              </button>
            </div>
            <div className="ops-weeknav">
              <button onClick={() => setWeek((w) => addWeeks(w, -1))} aria-label="Previous week">‹</button>
              <strong>{weekLabel(week)}</strong>
              <button onClick={() => setWeek((w) => addWeeks(w, 1))} aria-label="Next week">›</button>
              {!isCurrentWeek(week) ? (
                <button
                  style={{ width: "auto", padding: "0 10px", fontSize: 12, fontWeight: 600 }}
                  onClick={() => setWeek(currentWeek())}
                >
                  This week
                </button>
              ) : null}
            </div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={syncProjects}
              disabled={syncingProjects}
              title="Pull new Basecamp projects into the picker, including internal MEG workspaces."
            >
              {syncingProjects ? "Syncing…" : "Sync projects"}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={syncMeetings}
              disabled={syncingEvents}
              title="Re-read every project's schedule from Basecamp, so today's meetings show up in the picker."
            >
              {syncingEvents ? "Syncing…" : "Sync meetings"}
            </button>
          </div>
        </div>

        {error ? <p className="error" style={{ marginBottom: 16 }}>{error}</p> : null}

        {/* Always on screen while a timer runs, whichever view you're in, so time
            can't quietly keep accruing on something you finished an hour ago. */}
        {running ? (
          <div className="fc-running">
            <span className="fc-running-pulse" aria-hidden="true" />
            <div className="fc-running-what">
              <strong>{running.notes || running.client || "Task"}</strong>
              {running.client && running.notes ? <span>{running.client}</span> : null}
            </div>
            <span className="fc-running-clock">
              {formatTracked(trackedSeconds(running, nowMs), true)}
            </span>
            <button
              className="btn btn-sm"
              disabled={timerBusy === running.id}
              onClick={() => void toggleTimer(running)}
            >
              Stop
            </button>
          </div>
        ) : null}

        {!loading && progress.total > 0 ? (
          <div
            className={`fc-gauge ${gauge.over ? "is-over" : ""} ${gauge.clear ? "is-clear" : ""}`}
          >
            <div className="fc-gauge-figure">
              <b>{Math.round(gauge.totalHours * 10) / 10}</b>
              <span>/ {gauge.capacity} hrs</span>
            </div>
            <div className="fc-gauge-main">
              <div
                className="fc-gauge-track"
                role="img"
                aria-label={`${gauge.totalHours} of ${gauge.capacity} hours planned, ${gauge.doneHours} done`}
              >
                <div className="fc-gauge-done" style={{ width: `${gauge.donePct}%` }} />
                <div className="fc-gauge-planned" style={{ width: `${gauge.openPct}%` }} />
              </div>
              <div className="fc-gauge-legend">
                <span>
                  <i style={{ background: "var(--success)" }} />
                  {Math.round(gauge.doneHours * 10) / 10}h done
                </span>
                <span>
                  <i style={{ background: gauge.over ? "var(--danger)" : "var(--accent)" }} />
                  {Math.round(gauge.openHours * 10) / 10}h to go
                </span>
                <span>
                  {progress.done} of {progress.total} tasks
                </span>
              </div>
            </div>
            <div className="fc-gauge-note">
              {gauge.clear
                ? "Week is clear"
                : gauge.over
                  ? `${Math.round((gauge.totalHours - gauge.capacity) * 10) / 10}h over capacity`
                  : `${gauge.pct}% allocated`}
            </div>
          </div>
        ) : null}

        {loading ? (
          <p className="muted">Loading...</p>
        ) : view === "today" ? (
          (() => {
            const tasks = tasksByDay.get(today) || [];
            const inWeek = days.includes(today);
            const dayHours = tasks.reduce((sum, t) => sum + t.hours, 0);
            const doneToday = tasks.filter((t) => t.completed).length;
            const draft = draftFor(today);
            if (!inWeek) {
              return (
                <div className="ops-list-day">
                  <p className="muted" style={{ margin: 0 }}>
                    Today isn&apos;t in the week you&apos;re viewing. Jump back to{" "}
                    <button className="linklike" onClick={() => setWeek(currentWeek())}>this week</button>{" "}
                    to plan your day.
                  </p>
                </div>
              );
            }
            return (
              <div className="fc-today">
                <div className="fc-today-head">
                  <div>
                    <div className="fc-today-day">{dayName(today)}</div>
                    <div className="muted">{dayShortDate(today)}</div>
                  </div>
                  <div className="fc-today-stat">
                    <strong>{doneToday}/{tasks.length}</strong>
                    <span className="muted">done · {dayHours || 0}h</span>
                  </div>
                </div>

                {tasks.length === 0 ? (
                  <p className="muted" style={{ margin: "4px 0 14px" }}>Nothing planned for today yet. Add your first task below.</p>
                ) : (
                  tasks.map((t) => (
                    <Fragment key={t.id}>
                    <div className={`ops-list-row pri-${t.priority}`}>
                      <input
                        type="checkbox"
                        checked={!!t.completed}
                        onChange={() => toggleCompleted(t)}
                        aria-label="Mark complete"
                      />
                      <input
                        key={`${t.id}-client`}
                        defaultValue={t.client}
                        onBlur={(e) => saveField(t, "client", e.target.value)}
                        placeholder="Client"
                        className="client"
                        style={{ textDecoration: t.completed ? "line-through" : "none", opacity: t.completed ? 0.6 : 1 }}
                      />
                      <input
                        key={`${t.id}-notes`}
                        defaultValue={t.notes}
                        onBlur={(e) => saveField(t, "notes", e.target.value)}
                        placeholder="Task notes"
                        className="notes"
                        title={t.basecamp_event_id ? "Booked from a Basecamp meeting" : t.basecamp_todo_id ? "Linked to a Basecamp todo" : undefined}
                        style={{ textDecoration: t.completed ? "line-through" : "none", opacity: t.completed ? 0.6 : 1 }}
                      />
                      <StartTimeField task={t} onSave={(task, value) => saveField(task, "start_time", value)} />
                      <div className="row" style={{ gap: 2 }}>
                        <input
                          key={`${t.id}-hours`}
                          defaultValue={t.hours}
                          onBlur={(e) => saveField(t, "hours", e.target.value)}
                          type="number"
                          min="0"
                          step="0.5"
                          className="hrs"
                        />
                        <span className="muted">h</span>
                      </div>
                      <PriorityPicker value={t.priority} onChange={(p) => setPriority(t, p)} />
                      <TimerButton task={t} />
                      <button className="btn btn-ghost btn-sm" onClick={() => removeTask(t.id)}>Remove</button>
                    </div>
                    <LogTimeRow task={t} />
                    </Fragment>
                  ))
                )}

                <AddTaskForm
                  draft={draft}
                  patch={(p) => setDraft(today, p)}
                  clients={pickerClients}
                  todoState={todosByClient[draft.clientId]}

                  eventState={eventsByDate[today]}
                  onPickClient={(id) => pickClient(today, id)}
                  onPickMode={(m) => pickMode(today, m)}
                  onAdd={() => addTask(today)}
                  layout="row"
                  busy={saving}
                />
              </div>
            );
          })()
        ) : view === "week" ? (
          <div className="ops-planner">
            {days.map((date) => {
              const tasks = tasksByDay.get(date) || [];
              const dayHours = tasks.reduce((sum, t) => sum + t.hours, 0);
              const draft = draftFor(date);
              const isAdding = addingFor === date;
              return (
                <div
                  key={date}
                  className={`ops-day-col ${date === today ? "is-today" : ""} ${
                    dropDay === date ? "is-drop-target" : ""
                  } ${dayHours > 8 ? "is-loaded" : ""}`}
                  {...dayDropProps(date)}
                >
                  <div className="ops-day-head">
                    <div>
                      <div className="ops-day-name">{dayName(date)}</div>
                      <div className="ops-day-date">{dayShortDate(date)}</div>
                    </div>
                    <span className="ops-day-hours">{dayHours ? `${dayHours}h` : "—"}</span>
                  </div>

                  <div className="ops-day-tasks">
                    {tasks.map((t) => (
                      <div
                        key={t.id}
                        className={`ops-task-chip pri-${t.priority} ${t.completed ? "is-done" : ""} ${
                          dragId === t.id ? "is-dragging" : ""
                        }`}
                        title="Drag to another day to reschedule"
                        {...dragProps(t)}
                      >
                        <div className="chip-top">
                          <input
                            type="checkbox"
                            className="done-check"
                            checked={!!t.completed}
                            onChange={() => toggleCompleted(t)}
                            aria-label="Mark complete"
                          />
                          <input
                            key={`${t.id}-client`}
                            defaultValue={t.client}
                            onBlur={(e) => saveField(t, "client", e.target.value)}
                            placeholder="Client"
                            className="client"
                          />
                          <StartTimeField task={t} onSave={(task, value) => saveField(task, "start_time", value)} />
                          <input
                            key={`${t.id}-hours`}
                            defaultValue={t.hours}
                            onBlur={(e) => saveField(t, "hours", e.target.value)}
                            type="number"
                            min="0"
                            step="0.5"
                            className="hrs"
                            aria-label="Hours"
                          />
                        </div>
                        <input
                          key={`${t.id}-notes`}
                          defaultValue={t.notes}
                          onBlur={(e) => saveField(t, "notes", e.target.value)}
                          placeholder="Task notes"
                          className="notes"
                          title={t.basecamp_event_id ? "Booked from a Basecamp meeting" : t.basecamp_todo_id ? "Linked to a Basecamp todo" : undefined}
                        />
                        <div className="chip-foot">
                          <PriorityPicker value={t.priority} onChange={(p) => setPriority(t, p)} />
                          <TimerButton task={t} compact />
                          <button className="remove" onClick={() => removeTask(t.id)}>Remove</button>
                        </div>
                        <LogTimeRow task={t} />
                      </div>
                    ))}
                  </div>

                  <div className="ops-day-add">
                    {isAdding ? (
                      <AddTaskForm
                        draft={draft}
                        patch={(p) => setDraft(date, p)}
                        clients={pickerClients}
                        todoState={todosByClient[draft.clientId]}

                        eventState={eventsByDate[date]}
                        onPickClient={(id) => pickClient(date, id)}
                        onPickMode={(m) => pickMode(date, m)}
                        onAdd={() => addTask(date)}
                        onCancel={() => setAddingFor(null)}
                        layout="stack"
                        autoFocus
                        busy={saving}
                      />
                    ) : (
                      <button className="ops-add-trigger" onClick={() => setAddingFor(date)}>
                        + Add task
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : view === "calendar" ? (
          <div className="fc-planner">
            <ForecastQueue
              tasks={data?.tasks || []}
              today={today}
              clients={pickerClients}
              clientId={queueClientId}
              source={todosByClient[queueClientId]}
              hoursDraft={queueHours}
              onPickClient={pickQueueClient}
              onHoursDraft={setQueueHours}
              onSyncProjects={syncProjects}
              syncing={syncingProjects}
              drag={drag}
              onTaskDragStart={(e, t) => onTaskDragStart(e, t)}
              onTodoDragStart={onTodoDragStart}
              onDragEnd={onDragEnd}
              onToggle={(t) => {
                const task = (data?.tasks || []).find((x) => x.id === t.id);
                if (task) void toggleCompleted(task);
              }}
              onRemove={removeTask}
              onQueueTodo={(todo) => void bookTodo(todo, queueDay, "")}
              onToggleTimer={(t) => {
                const task = (data?.tasks || []).find((x) => x.id === t.id);
                if (task) void toggleTimer(task);
              }}
              timerBusyId={timerBusy}
              nowMs={nowMs}
              dayLabel={(ymd) => `${dayName(ymd).slice(0, 3)} ${dayShortDate(ymd)}`}
              busy={saving}
            />
            <div className="fc-planner-main">
            <ForecastCalendar
              days={days}
              today={today}
              tasksByDay={tasksByDay}
              capacityPerDay={Math.round(((data?.capacity || 40) / days.length) * 10) / 10}
              dayName={dayName}
              dayShortDate={dayShortDate}
              drag={drag}
              dropDay={dropDay}
              onToggle={(t) => {
                const task = (data?.tasks || []).find((x) => x.id === t.id);
                if (task) void toggleCompleted(task);
              }}
              onRemove={removeTask}
              onSlotClick={(date, startTime) => {
                setAddingFor(date);
                setDraft(date, { startTime });
              }}
              onDropAt={(date, startTime) => void placeDrag(date, startTime)}
              onDragOverDay={onDayDragOver}
              onDragLeaveDay={(e, date) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                setDropDay((d) => (d === date ? null : d));
              }}
              onTaskDragStart={onTaskDragStart}
              onDragEnd={onDragEnd}
              onResize={(t, hours) => void resizeTask(t, hours)}
              onToggleTimer={(t) => {
                const task = (data?.tasks || []).find((x) => x.id === t.id);
                if (task) void toggleTimer(task);
              }}
              timerBusyId={timerBusy}
              nowMs={nowMs}
            />
            {addingFor ? (
              <div className="ops-list-day" style={{ marginTop: 16 }}>
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                  <strong>
                    Add · {dayName(addingFor)}{" "}
                    <span className="muted" style={{ fontWeight: 400 }}>
                      {draftFor(addingFor).startTime
                        ? formatTimeLabel(draftFor(addingFor).startTime)
                        : "no start time"}
                    </span>
                  </strong>
                </div>
                <AddTaskForm
                  draft={draftFor(addingFor)}
                  patch={(p) => setDraft(addingFor, p)}
                  clients={pickerClients}
                  todoState={todosByClient[draftFor(addingFor).clientId]}
                  eventState={eventsByDate[addingFor]}
                  onPickClient={(id) => pickClient(addingFor, id)}
                  onPickMode={(m) => pickMode(addingFor, m)}
                  onAdd={() => addTask(addingFor)}
                  onCancel={() => setAddingFor(null)}
                  layout="row"
                  autoFocus
                  busy={saving}
                />
              </div>
            ) : (
              <p className="muted" style={{ margin: "12px 0 0", fontSize: 13 }}>
                Click an hour to add a task there, or drag one in from the list on the left.
                Drag a block&apos;s bottom edge to change how long it runs.
              </p>
            )}
            </div>
          </div>
        ) : (
          <div>
            {days.map((date) => {
              const tasks = tasksByDay.get(date) || [];
              const dayHours = tasks.reduce((sum, t) => sum + t.hours, 0);
              const draft = draftFor(date);
              return (
                <div
                  key={date}
                  className={`ops-list-day ${date === today ? "is-today" : ""} ${
                    dropDay === date ? "is-drop-target" : ""
                  }`}
                  {...dayDropProps(date)}
                >
                  <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                    <strong>{dayName(date)} <span className="muted" style={{ fontWeight: 400 }}>{dayShortDate(date)}</span></strong>
                    <span className="muted">{dayHours || 0}h</span>
                  </div>

                  {tasks.length === 0 ? (
                    <p className="muted" style={{ margin: "0 0 10px", fontSize: 13 }}>
                      {dragId ? "Drop here to move it to this day." : "Nothing planned yet."}
                    </p>
                  ) : (
                    tasks.map((t) => (
                      <Fragment key={t.id}>
                      <div
                        className={`ops-list-row pri-${t.priority} ${dragId === t.id ? "is-dragging" : ""}`}
                        title="Drag to another day to reschedule"
                        {...dragProps(t)}
                      >
                        <input
                          type="checkbox"
                          checked={!!t.completed}
                          onChange={() => toggleCompleted(t)}
                          aria-label="Mark complete"
                        />
                        <input
                          key={`${t.id}-client`}
                          defaultValue={t.client}
                          onBlur={(e) => saveField(t, "client", e.target.value)}
                          placeholder="Client"
                          className="client"
                          style={{
                            textDecoration: t.completed ? "line-through" : "none",
                            opacity: t.completed ? 0.6 : 1,
                          }}
                        />
                        <input
                          key={`${t.id}-notes`}
                          defaultValue={t.notes}
                          onBlur={(e) => saveField(t, "notes", e.target.value)}
                          placeholder="Task notes"
                          className="notes"
                          title={t.basecamp_event_id ? "Booked from a Basecamp meeting" : t.basecamp_todo_id ? "Linked to a Basecamp todo" : undefined}
                          style={{
                            textDecoration: t.completed ? "line-through" : "none",
                            opacity: t.completed ? 0.6 : 1,
                          }}
                        />
                        <StartTimeField task={t} onSave={(task, value) => saveField(task, "start_time", value)} />
                        <div className="row" style={{ gap: 2 }}>
                          <input
                            key={`${t.id}-hours`}
                            defaultValue={t.hours}
                            onBlur={(e) => saveField(t, "hours", e.target.value)}
                            type="number"
                            min="0"
                            step="0.5"
                            className="hrs"
                          />
                          <span className="muted">h</span>
                        </div>
                        <PriorityPicker value={t.priority} onChange={(p) => setPriority(t, p)} />
                        <TimerButton task={t} />
                        <button className="btn btn-ghost btn-sm" onClick={() => removeTask(t.id)}>
                          Remove
                        </button>
                      </div>
                      <LogTimeRow task={t} />
                      </Fragment>
                    ))
                  )}

                  <AddTaskForm
                    draft={draft}
                    patch={(p) => setDraft(date, p)}
                    clients={pickerClients}
                    todoState={todosByClient[draft.clientId]}

                    eventState={eventsByDate[date]}
                    onPickClient={(id) => pickClient(date, id)}
                    onPickMode={(m) => pickMode(date, m)}
                    onAdd={() => addTask(date)}
                    layout="row"
                    busy={saving}
                  />
                </div>
              );
            })}
          </div>
        )}

        {data ? (
          <label className="field" style={{ marginTop: 18 }}>
            <span>
              Notes for this week
              {noteSaving ? " · saving…" : ""}
            </span>
            <textarea
              value={noteDraft}
              placeholder="Anything worth flagging for the week — PTO, a heads up on a client, blockers, whatever's useful."
              onChange={(e) => setNoteDraft(e.target.value)}
              onBlur={saveNote}
              rows={3}
            />
          </label>
        ) : null}

        {/* Week total lives in the capacity gauge at the top of the page now. */}
      </div>
    </div>
  );
}
