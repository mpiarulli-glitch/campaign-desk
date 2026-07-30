"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
};

// Per-client cache of the Basecamp todo picker's contents. `reason` explains an
// empty list so the form can tell someone why they're typing instead of picking.
type TodoState = {
  loading: boolean;
  todos: BcTodo[];
  filteredToPerson: boolean;
  projectId: string;
  reason: string | null;
};

const PRIORITIES: Priority[] = ["urgent", "important", "flexible"];
const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: "Urgent — can't be moved",
  important: "Important — move only if truly needed",
  flexible: "Flexible — reschedulable, still needs doing",
};

function allocationColor(pct: number): string {
  if (pct > 100) return "var(--danger)";
  if (pct >= 80) return "var(--success)";
  return "var(--warning)";
}

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

type Draft = {
  // Selected rev_client. `client` carries the name, which is what gets stored.
  clientId: string;
  client: string;
  notes: string;
  hours: string;
  // Set when the task text was picked from a Basecamp todo. Kept so completing
  // the task can close that todo.
  todoId: string;
  projectId: string;
  // True once someone chooses to type the task rather than pick one.
  manual: boolean;
};

const emptyDraft: Draft = {
  clientId: "",
  client: "",
  notes: "",
  hours: "",
  todoId: "",
  projectId: "",
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
    return "No open Basecamp todos found here, so type the task instead.";
  }
  if (!state.filteredToPerson) {
    return "Nothing here is assigned to you, so every open todo is listed.";
  }
  return "";
}

function AddTaskForm({
  draft,
  patch,
  clients,
  todoState,
  onPickClient,
  onAdd,
  onCancel,
  layout,
  autoFocus,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  clients: ClientOption[];
  todoState: TodoState | undefined;
  onPickClient: (clientId: string) => void;
  onAdd: () => void;
  onCancel?: () => void;
  layout: "row" | "stack";
  autoFocus?: boolean;
}) {
  const stack = layout === "stack";
  const todos = useMemo(() => todoState?.todos || [], [todoState]);

  // Group by todo list so the dropdown reads the way Basecamp does.
  const groups = useMemo(() => {
    const map = new Map<string, BcTodo[]>();
    for (const t of todos) {
      const list = map.get(t.list) || [];
      list.push(t);
      map.set(t.list, list);
    }
    return [...map.entries()];
  }, [todos]);

  const usePicker = Boolean(draft.clientId) && !draft.manual && todos.length > 0;
  const hint = todoHint(draft, todoState);

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
            <option key={t.id} value={t.id}>
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

  // Only worth offering once there are todos to switch away from.
  const manualToggle =
    draft.clientId && todos.length > 0 ? (
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
        {clientSelect}
        {taskField}
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
        {clientSelect}
        {taskField}
        {hoursInput}
        <button className="btn btn-sm" onClick={onAdd}>
          Add task
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
  const [todosByClient, setTodosByClient] = useState<Record<string, TodoState>>({});

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
          filteredToPerson: false,
          projectId: "",
          reason: null,
        },
      }));
      try {
        const res = await fetch(
          `/api/forecast/todos?person=${person}&client=${encodeURIComponent(clientId)}`
        );
        const json = res.ok ? await res.json() : null;
        if (!res.ok) requestedTodos.current.delete(clientId);
        setTodosByClient((prev) => ({
          ...prev,
          [clientId]: {
            loading: false,
            todos: Array.isArray(json?.todos) ? json.todos : [],
            filteredToPerson: Boolean(json?.filteredToPerson),
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
            filteredToPerson: false,
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

  const days = useMemo(() => weekdays(week), [week]);
  const today = todayYmd();
  const progress = useMemo(() => {
    const all = data?.tasks || [];
    const done = all.filter((t) => t.completed).length;
    return { done, total: all.length, pct: all.length ? Math.round((done / all.length) * 100) : 0 };
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
    if (!draft.client.trim()) {
      setError("Pick a client for that task.");
      return;
    }
    if (!Number.isFinite(hours) || hours <= 0) {
      setError("Enter how many hours that task should take.");
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
        basecampTodoId: draft.todoId,
        basecampProjectId: draft.todoId ? state?.projectId || "" : "",
      }),
    });
    if (!res.ok) {
      setError("Could not add that task.");
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
          </div>
        </div>

        <div className="color-legend">
          <div className="color-legend-group">
            <span className="color-legend-group-label">Task priority</span>
            <span className="color-legend-item">
              <i className="color-legend-dot" style={{ background: "var(--danger)" }} /> {PRIORITY_LABEL.urgent}
            </span>
            <span className="color-legend-item">
              <i className="color-legend-dot" style={{ background: "var(--warning)" }} /> {PRIORITY_LABEL.important}
            </span>
            <span className="color-legend-item">
              <i className="color-legend-dot" style={{ background: "var(--success)" }} /> {PRIORITY_LABEL.flexible}
            </span>
          </div>
        </div>

        {error ? <p className="error" style={{ marginBottom: 16 }}>{error}</p> : null}

        {!loading && progress.total > 0 ? (
          <div className={`fc-progress ${progress.pct === 100 ? "is-clear" : ""}`}>
            <div className="fc-progress-bar">
              <div className="fc-progress-fill" style={{ width: `${progress.pct}%` }} />
            </div>
            <span className="fc-progress-label">
              {progress.pct === 100
                ? `All ${progress.total} done for the week 🎉`
                : `${progress.done} of ${progress.total} done · ${progress.pct}%`}
            </span>
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
                    <div key={t.id} className={`ops-list-row pri-${t.priority}`}>
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
                        title={t.basecamp_todo_id ? "Linked to a Basecamp todo" : undefined}
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
                  ))
                )}

                <AddTaskForm
                  draft={draft}
                  patch={(p) => setDraft(today, p)}
                  clients={clients}
                  todoState={todosByClient[draft.clientId]}
                  onPickClient={(id) => pickClient(today, id)}
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
                <div key={date} className="ops-day-col">
                  <div className="ops-day-head">
                    <div>
                      <div className="ops-day-name">{dayName(date)}</div>
                      <div className="ops-day-date">{dayShortDate(date)}</div>
                    </div>
                    <span className="ops-day-hours">{dayHours ? `${dayHours}h` : "—"}</span>
                  </div>

                  <div className="ops-day-tasks">
                    {tasks.map((t) => (
                      <div key={t.id} className={`ops-task-chip pri-${t.priority} ${t.completed ? "is-done" : ""}`}>
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
                          style={{ paddingLeft: 18 }}
                        />
                        <input
                          key={`${t.id}-notes`}
                          defaultValue={t.notes}
                          onBlur={(e) => saveField(t, "notes", e.target.value)}
                          placeholder="Task notes"
                          className="notes"
                          title={t.basecamp_todo_id ? "Linked to a Basecamp todo" : undefined}
                          style={{ paddingLeft: 18 }}
                        />
                        <input
                          key={`${t.id}-hours`}
                          defaultValue={t.hours}
                          onBlur={(e) => saveField(t, "hours", e.target.value)}
                          type="number"
                          min="0"
                          step="0.5"
                          className="hrs"
                        />
                        <div style={{ marginTop: 6, paddingLeft: 18 }}>
                          <PriorityPicker value={t.priority} onChange={(p) => setPriority(t, p)} />
                        </div>
                        <button className="remove" onClick={() => removeTask(t.id)}>Remove</button>
                      </div>
                    ))}
                  </div>

                  <div className="ops-day-add">
                    {isAdding ? (
                      <AddTaskForm
                        draft={draft}
                        patch={(p) => setDraft(date, p)}
                        clients={clients}
                        todoState={todosByClient[draft.clientId]}
                        onPickClient={(id) => pickClient(date, id)}
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
                <div key={date} className="ops-list-day">
                  <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                    <strong>{dayName(date)} <span className="muted" style={{ fontWeight: 400 }}>{dayShortDate(date)}</span></strong>
                    <span className="muted">{dayHours || 0}h</span>
                  </div>

                  {tasks.length === 0 ? (
                    <p className="muted" style={{ margin: "0 0 10px", fontSize: 13 }}>Nothing forecasted yet.</p>
                  ) : (
                    tasks.map((t) => (
                      <div key={t.id} className={`ops-list-row pri-${t.priority}`}>
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
                          title={t.basecamp_todo_id ? "Linked to a Basecamp todo" : undefined}
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
                    ))
                  )}

                  <AddTaskForm
                    draft={draft}
                    patch={(p) => setDraft(date, p)}
                    clients={clients}
                    todoState={todosByClient[draft.clientId]}
                    onPickClient={(id) => pickClient(date, id)}
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

        {data ? (
          <div className="ops-week-total">
            <strong>Week total</strong>
            <span>
              {data.hours}h / {data.capacity}h ·{" "}
              <strong style={{ color: allocationColor(data.allocationPct) }}>
                {data.allocationPct}% allocated
              </strong>
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
