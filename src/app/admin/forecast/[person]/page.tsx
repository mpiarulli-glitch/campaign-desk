"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  basecamp_todo_id: string;
  basecamp_project_id: string;
  basecamp_event_id: string;
  actual_hours: number;
  basecamp_time_entry_id: string;
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

type ClientOption = { id: string; name: string };

type BcTodo = {
  id: string;
  title: string;
  list: string;
  dueOn: string | null;
  assigned?: boolean;
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
  // Set when the task text was picked from a Basecamp todo. Kept so completing
  // the task can close that todo.
  todoId: string;
  projectId: string;
  // Set instead when the row came from the meeting picker. Never set alongside
  // todoId: a meeting has nothing to close.
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
  todoId: "",
  projectId: "",
  eventId: "",
  manual: false,
};

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
}) {
  const stack = layout === "stack";
  const todos = useMemo(() => todoState?.todos || [], [todoState]);
  const meeting = draft.mode === "meeting";

  // Grouped by todo list, the way Basecamp reads, with anything assigned to this
  // person lifted into a group of its own at the top so their own work is one
  // glance away without the rest being hidden.
  const groups = useMemo(() => {
    const assigned = todos.filter((t) => t.assigned);
    const map = new Map<string, BcTodo[]>();
    for (const t of todos) {
      const list = map.get(t.list) || [];
      list.push(t);
      map.set(t.list, list);
    }
    const byList: Array<[string, BcTodo[]]> = [...map.entries()];
    return assigned.length ? [["Assigned to you", assigned] as [string, BcTodo[]], ...byList] : byList;
  }, [todos]);

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
          clientId: hit?.clientId || "",
          client: hit?.clientName || "",
          todoId: "",
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
    <select
      autoFocus={autoFocus}
      value={draft.clientId}
      onChange={(e) => onPickClient(e.target.value)}
      aria-label="Client"
      style={stack ? undefined : { flex: "1 1 160px" }}
    >
      <option value="">Pick a client</option>
      {clients.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );

  const taskField = usePicker ? (
    <select
      value={draft.todoId}
      onChange={(e) => {
        const hit = todos.find((t) => t.id === e.target.value);
        patch({ todoId: hit?.id || "", notes: hit?.title || "" });
      }}
      aria-label="Basecamp todo"
      style={stack ? undefined : { flex: "2 1 240px" }}
    >
      <option value="">Pick a todo</option>
      {groups.map(([list, items]) => (
        <optgroup key={list} label={list}>
          {items.map((t) => (
            // Assigned todos appear both in their own group and under their
            // list, so the key has to include the group to stay unique.
            <option key={`${list}:${t.id}`} value={t.id}>
              {t.title}
              {t.dueOn ? ` (due ${t.dueOn})` : ""}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  ) : (
    <input
      value={draft.notes}
      onChange={(e) => patch({ notes: e.target.value, todoId: "", projectId: "" })}
      placeholder={
        !draft.clientId
          ? "Pick a client first"
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
      placeholder="Hours"
      type="number"
      min="0"
      step="0.5"
      aria-label="Hours"
      style={stack ? { flex: 1 } : { width: 90 }}
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
          patch({ manual: !draft.manual, notes: "", todoId: "", projectId: "" })
        }
      >
        {draft.manual ? "Pick a todo instead" : "Type it instead"}
      </button>
    ) : null;

  if (stack) {
    return (
      <div className="ops-day-add-form">
        {modeToggle}
        {/* Meetings skip the client select entirely: most of them are internal
            and have no client, and the picked event supplies one when it has. */}
        {meeting ? meetingField : clientSelect}
        {meeting ? null : taskField}
        <div className="row" style={{ gap: 6 }}>
          {hoursInput}
          <button className="btn btn-sm" onClick={onAdd}>
            Add
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
        {hoursInput}
        <button className="btn btn-sm" onClick={onAdd}>
          {meeting ? "Add meeting" : "Add task"}
        </button>
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

type View = "today" | "list" | "week";

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
  // Internal MEG Basecamp projects (Empire Leadership HQ, etc.) that aren't
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
  // taskId -> hours typed into that task's "log time" box. Logging is explicit:
  // the hours go onto a client-visible Basecamp timesheet and can't be unsent,
  // so ticking a task never posts on its own.
  const [logDrafts, setLogDrafts] = useState<Record<string, string>>({});
  const [logging, setLogging] = useState<string | null>(null);
  // Task currently being dragged, and the day it's hovering over. Both are
  // needed: the card dims itself, and only the hovered day highlights.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropDay, setDropDay] = useState<string | null>(null);

  function draftFor(date: string): Draft {
    return drafts[date] || emptyDraft;
  }
  function setDraft(date: string, patch: Partial<Draft>) {
    setDrafts((d) => ({ ...d, [date]: { ...(d[date] || emptyDraft), ...patch } }));
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
    fetch("/api/revenue/clients")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!Array.isArray(json?.clients)) return;
        setClients(
          json.clients
            .map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }))
            .sort((a: ClientOption, b: ClientOption) => a.name.localeCompare(b.name))
        );
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!person) return;
    fetch(`/api/forecast/internal-projects?person=${person}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!Array.isArray(json?.projects)) return;
        setInternalProjects(
          json.projects.map((p: { id: string; name: string }) => ({
            id: `internal:${p.id}`,
            name: p.name,
          }))
        );
      })
      .catch(() => {});
  }, [person]);

  // Client picker contents: revenue clients first, then internal Basecamp
  // projects (Empire Leadership HQ, etc.) that have todos but aren't billing
  // clients.
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
    const hit = clients.find((c) => c.id === clientId);
    // Changing client invalidates whatever task was picked for the old one.
    setDraft(date, {
      clientId,
      client: hit?.name || "",
      notes: "",
      todoId: "",
      projectId: "",
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

  // Switching mode clears whatever was picked under the old one, so a half-filled
  // work row can't be submitted as a meeting or the reverse.
  function pickMode(date: string, mode: DraftMode) {
    setDraft(date, {
      mode,
      notes: "",
      hours: "",
      todoId: "",
      projectId: "",
      eventId: "",
      clientId: "",
      client: "",
      manual: false,
    });
    if (mode === "meeting") ensureEvents(date);
  }

  const days = useMemo(() => weekdays(week), [week]);
  const today = todayYmd();
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

    // A meeting needs no client: most of them are internal and have none. It
    // does need a name, which the picker fills in and free text supplies.
    if (meeting) {
      if (!draft.notes.trim()) {
        setError("Pick a meeting, or type what it is.");
        return;
      }
    } else if (!draft.client.trim()) {
      setError("Pick a client for that task.");
      return;
    }
    if (!Number.isFinite(hours) || hours <= 0) {
      setError(
        meeting
          ? "Enter how long that meeting runs."
          : "Enter how many hours that task should take."
      );
      return;
    }
    setError("");
    const state = todosByClient[draft.clientId];
    const res = await fetch(`/api/forecast/${person}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskDate: date,
        client: draft.client,
        notes: draft.notes,
        hours,
        basecampTodoId: meeting ? "" : draft.todoId,
        // Carried even for a manually-typed task (no todoId), as long as the
        // client resolved to a real Basecamp project: it's what lets "Log to
        // Basecamp" create a shadow todo for that task later instead of
        // having nothing to attach the hours to.
        basecampProjectId: meeting ? "" : state?.projectId || "",
        basecampEventId: meeting ? draft.eventId : "",
      }),
    });
    if (!res.ok) {
      setError(meeting ? "Could not add that meeting." : "Could not add that task.");
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
    field: "client" | "notes" | "hours",
    rawValue: string
  ) {
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

  function onDragStart(e: React.DragEvent, task: Task) {
    setDragId(task.id);
    e.dataTransfer.effectAllowed = "move";
    // Firefox won't start a drag without data set.
    e.dataTransfer.setData("text/plain", task.id);
  }

  function onDragEnd() {
    setDragId(null);
    setDropDay(null);
  }

  function onDayDragOver(e: React.DragEvent, date: string) {
    if (!dragId) return;
    // Only preventDefault marks this as a valid drop target.
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dropDay !== date) setDropDay(date);
  }

  async function onDayDrop(e: React.DragEvent, date: string) {
    e.preventDefault();
    const id = dragId || e.dataTransfer.getData("text/plain");
    setDragId(null);
    setDropDay(null);
    if (!id) return;
    const task = (data?.tasks || []).find((t) => t.id === id);
    if (!task || task.task_date === date) return;

    // Move it locally first so the card lands where it was dropped instead of
    // snapping back until the request returns.
    setData((d) =>
      d ? { ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, task_date: date } : t)) } : d
    );
    const res = await fetch(`/api/forecast/${person}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskDate: date }),
    });
    if (!res.ok) {
      setError("Could not move that task.");
      load(week, { silent: true });
      return;
    }
    setError("");
    load(week, { silent: true });
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

  function dragProps(task: Task) {
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent) => onDragStart(e, task),
      onDragEnd,
    };
  }

  async function logTime(task: Task) {
    const raw = logDrafts[task.id] ?? String(task.hours);
    const hours = Number(raw);
    if (!Number.isFinite(hours) || hours <= 0) {
      setError("Enter the hours actually spent before logging to Basecamp.");
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
    load(week, { silent: true });
  }

  // Only for completed rows linked to something in Basecamp, whether that's a
  // todo, a meeting, or (for a task typed by hand) just the project it
  // belongs to — logTime() creates a shadow todo in that project the first
  // time someone logs against a row like that. There's nowhere to log
  // against otherwise, and logging before the work is done is a guess.
  function LogTimeRow({ task }: { task: Task }) {
    const linked = task.basecamp_todo_id || task.basecamp_event_id || task.basecamp_project_id;
    if (!linked || !task.completed) return null;
    if (task.basecamp_time_entry_id) {
      return (
        <div className="muted" style={{ fontSize: 12, paddingLeft: 26, marginTop: 2 }}>
          {task.actual_hours}h logged to Basecamp
        </div>
      );
    }
    return (
      <div className="row" style={{ gap: 6, paddingLeft: 26, marginTop: 4, flexWrap: "wrap" }}>
        <span className="muted" style={{ fontSize: 12 }}>Actual hours</span>
        <input
          value={logDrafts[task.id] ?? String(task.hours)}
          onChange={(e) => setLogDrafts((d) => ({ ...d, [task.id]: e.target.value }))}
          type="number"
          min="0"
          step="0.25"
          aria-label="Actual hours spent"
          style={{ width: 70 }}
        />
        <button
          className="btn btn-sm"
          disabled={logging === task.id}
          onClick={() => logTime(task)}
        >
          {logging === task.id ? "Logging..." : "Log to Basecamp"}
        </button>
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
              onClick={syncMeetings}
              disabled={syncingEvents}
              title="Re-read every project's schedule from Basecamp, so today's meetings show up in the picker."
            >
              {syncingEvents ? "Syncing…" : "Sync meetings"}
            </button>
          </div>
        </div>

        {error ? <p className="error" style={{ marginBottom: 16 }}>{error}</p> : null}

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
