"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  assignedTaskHref,
  filterAssignedTasks,
  groupAssignedTasks,
  groupAssignedTasksByDue,
  isTodoRepeat,
  scheduleWeekDays,
  weekdayButtonLabel,
  type TasksFilter,
  type TasksLayout,
  type TodoRepeat,
} from "@/lib/forecast-tasks";
import { sortQueueTodos, type QueueTodo } from "@/lib/forecast-queue";
import type { AssignedSource } from "./ForecastQueue";

export type TaskClientOption = { id: string; name: string };

function shortDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd.slice(5);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function dueTone(
  dueOn: string | null,
  today: string
): "late" | "today" | "soon" | "muted" {
  if (!dueOn) return "muted";
  if (dueOn < today) return "late";
  if (dueOn === today) return "today";
  return "soon";
}

function dueDisplay(dueOn: string | null, today: string): string {
  if (!dueOn) return "Date";
  if (dueOn === today) return "Today";
  return shortDate(dueOn);
}

function repeatOf(
  todo: QueueTodo,
  repeats: Record<string, "weekly" | "monthly">
): TodoRepeat {
  const key = todo.kind === "step" && todo.parentId ? todo.parentId : todo.id;
  return repeats[key] || repeats[todo.id] || "once";
}

/**
 * Top-level Tasks view: everything Basecamp has assigned to this person.
 *
 * Check one off to complete it in Basecamp (and any matching forecast row).
 * Schedule books it onto a weekday of this week or a later one. Due dates and
 * weekly/monthly repeats can be edited here. New to-dos are created on this
 * page, assigned as you.
 */
export function ForecastTasksPanel({
  person,
  assigned,
  today,
  clients,
  bookedIds,
  forecastTaskByRecording,
  busyId,
  schedulingId,
  onComplete,
  onSchedule,
  onUpdate,
  onCreate,
  onRefresh,
}: {
  person: string;
  assigned: AssignedSource;
  today: string;
  clients: TaskClientOption[];
  bookedIds: Set<string>;
  forecastTaskByRecording: Map<string, { id: string; completed: boolean; taskDate: string }>;
  busyId: string | null;
  schedulingId: string | null;
  onComplete: (todo: QueueTodo, completed: boolean) => void;
  onSchedule: (todo: QueueTodo, date: string) => void;
  onUpdate: (todo: QueueTodo, patch: { dueOn?: string | null; repeat?: TodoRepeat }) => void;
  onCreate: (input: {
    title: string;
    clientId: string;
    listId: string;
    dueOn: string | null;
    repeat: TodoRepeat;
  }) => Promise<boolean>;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState<TasksFilter>("all");
  const [layout, setLayout] = useState<TasksLayout>("due");
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [pickerWeek, setPickerWeek] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);

  const repeats = assigned.repeats || {};
  const groups = useMemo(() => {
    const filtered = sortQueueTodos(
      filterAssignedTasks(assigned.assignments, filter)
    );
    return layout === "due"
      ? groupAssignedTasksByDue(filtered, today)
      : groupAssignedTasks(filtered);
  }, [assigned.assignments, filter, layout, today]);

  const totalShown = groups.reduce((n, g) => n + g.items.length, 0);
  const datedCount = assigned.assignments.filter((a) => a.dueOn).length;
  const overdueCount = assigned.assignments.filter(
    (a) => a.dueOn && a.dueOn < today
  ).length;
  const showClientInMeta = layout === "due";
  const scheduleWeek = scheduleWeekDays(today, pickerWeek);

  return (
    <div className="fc-tasks">
      <div className="fc-tasks-toolbar">
        <div className="fc-tasks-controls">
          <div className="view-toggle" role="group" aria-label="Task filter">
            <button
              type="button"
              className={`view-toggle-btn ${filter === "all" ? "is-on" : ""}`}
              onClick={() => setFilter("all")}
            >
              All
              {!assigned.loading ? (
                <span className="fc-tasks-count">{assigned.assignments.length}</span>
              ) : null}
            </button>
            <button
              type="button"
              className={`view-toggle-btn ${filter === "dated" ? "is-on" : ""}`}
              onClick={() => setFilter("dated")}
            >
              Dated
              {!assigned.loading ? (
                <span className="fc-tasks-count">{datedCount}</span>
              ) : null}
            </button>
          </div>
          <div className="view-toggle" role="group" aria-label="Task layout">
            <button
              type="button"
              className={`view-toggle-btn ${layout === "due" ? "is-on" : ""}`}
              onClick={() => setLayout("due")}
            >
              By due date
            </button>
            <button
              type="button"
              className={`view-toggle-btn ${layout === "project" ? "is-on" : ""}`}
              onClick={() => setLayout("project")}
            >
              By project
            </button>
          </div>
          {!assigned.loading && overdueCount > 0 ? (
            <span className="fc-tasks-overdue-chip">
              {overdueCount} overdue
            </span>
          ) : null}
        </div>
        <div className="fc-tasks-toolbar-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setComposerOpen((open) => !open)}
          >
            {composerOpen ? "Cancel" : "New to-do"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm fc-tasks-refresh"
            onClick={onRefresh}
            disabled={assigned.loading}
          >
            {assigned.loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {composerOpen ? (
        <NewTodoForm
          person={person}
          clients={clients}
          onCancel={() => setComposerOpen(false)}
          onCreate={async (input) => {
            const ok = await onCreate(input);
            if (ok) setComposerOpen(false);
            return ok;
          }}
        />
      ) : null}

      {assigned.loading && assigned.assignments.length === 0 ? (
        <p className="fc-tasks-empty">Loading your Basecamp tasks…</p>
      ) : totalShown === 0 ? (
        <p className="fc-tasks-empty">
          {assigned.reason === "person-not-connected"
            ? "Connect your own Basecamp account to see your tasks here."
            : assigned.reason === "not-connected"
              ? "Basecamp isn't connected."
              : assigned.reason === "none-assigned"
                ? "Nothing is assigned to you in Basecamp right now."
                : filter === "dated"
                  ? "None of your open tasks have due dates."
                  : "No open tasks to show."}
        </p>
      ) : (
        <div className="fc-tasks-groups">
          {groups.map((group) => {
            const dueBucket =
              group.key === "overdue" ||
              group.key === "today" ||
              group.key === "upcoming" ||
              group.key === "none"
                ? group.key
                : "project";

            return (
              <section
                key={group.key}
                className={`fc-tasks-group is-${dueBucket}`}
              >
                <header className="fc-tasks-group-head">
                  <h2 className="fc-tasks-group-title">{group.label}</h2>
                  <span className="fc-tasks-group-count">{group.items.length}</span>
                </header>
                <ul className="fc-tasks-list">
                  {group.items.map((todo) => {
                    const booked = bookedIds.has(todo.id);
                    const forecast = forecastTaskByRecording.get(todo.id);
                    const picking = pickerFor === todo.id;
                    const rowBusy =
                      busyId === todo.id || schedulingId === todo.id;
                    const tone = dueTone(todo.dueOn, today);
                    const repeat = repeatOf(todo, repeats);
                    const context =
                      todo.kind === "step" && todo.parentTitle
                        ? todo.parentTitle
                        : todo.list || "";
                    const planned =
                      forecast && !forecast.completed
                        ? weekdayButtonLabel(forecast.taskDate)
                        : "";

                    return (
                      <li
                        key={todo.id}
                        className={[
                          "fc-tasks-row",
                          forecast?.completed ? "is-done" : "",
                          picking ? "is-picking" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <label className="fc-tasks-check">
                          <input
                            type="checkbox"
                            checked={Boolean(forecast?.completed)}
                            disabled={rowBusy}
                            onChange={(e) =>
                              onComplete(todo, e.target.checked)
                            }
                            aria-label={`Mark “${todo.title}” complete`}
                          />
                        </label>

                        <div className="fc-tasks-main">
                          <div className="fc-tasks-title-row">
                            <a
                              className="fc-tasks-title"
                              href={assignedTaskHref(todo)}
                              target="_blank"
                              rel="noreferrer"
                              title="Open in Basecamp"
                            >
                              {todo.title}
                            </a>
                            {todo.kind === "step" ? (
                              <span className="fc-queue-tag">subtask</span>
                            ) : todo.kind === "card" ? (
                              <span className="fc-queue-tag">card</span>
                            ) : null}
                          </div>
                          <div className="fc-tasks-meta">
                            {showClientInMeta && todo.clientName ? (
                              <span className="fc-tasks-client">
                                {todo.clientName}
                              </span>
                            ) : null}
                            {context ? <span>{context}</span> : null}
                          </div>
                        </div>

                        <label className={`fc-tasks-due-edit is-${tone}`}>
                          <span aria-hidden="true">
                            {dueDisplay(todo.dueOn, today)}
                          </span>
                          <input
                            type="date"
                            value={todo.dueOn || ""}
                            disabled={rowBusy}
                            aria-label={`Due date for ${todo.title}`}
                            onChange={(e) =>
                              onUpdate(todo, {
                                dueOn: e.target.value || null,
                              })
                            }
                          />
                        </label>

                        <select
                          className={`fc-tasks-repeat ${repeat !== "once" ? "is-on" : ""}`}
                          value={repeat}
                          disabled={rowBusy || (!todo.dueOn && repeat === "once")}
                          title="Forecast opens the next to-do when you complete this. Basecamp does not let apps set its Repeat control."
                          aria-label={`Repeat for ${todo.title}`}
                          onChange={(e) => {
                            const next = e.target.value;
                            if (!isTodoRepeat(next)) return;
                            onUpdate(todo, { repeat: next });
                          }}
                        >
                          <option value="once">Once</option>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                        </select>

                        {booked ? (
                          <span className="fc-tasks-booked" title="Already on the forecast">
                            {planned || "Planned"}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="fc-tasks-schedule"
                            disabled={rowBusy}
                            aria-expanded={picking}
                            onClick={() => {
                              setPickerWeek(0);
                              setPickerFor((id) =>
                                id === todo.id ? null : todo.id
                              );
                            }}
                          >
                            {schedulingId === todo.id
                              ? "…"
                              : picking
                                ? "Close"
                                : "Plan"}
                          </button>
                        )}

                        {picking && !booked ? (
                          <div
                            className="fc-tasks-picker"
                            role="group"
                            aria-label="Pick a day"
                          >
                            <div className="fc-tasks-week-nav">
                              <button
                                type="button"
                                className="fc-tasks-week-btn"
                                disabled={pickerWeek <= 0 || rowBusy}
                                onClick={() =>
                                  setPickerWeek((n) => Math.max(0, n - 1))
                                }
                              >
                                Earlier
                              </button>
                              <span className="fc-tasks-week-label">
                                {scheduleWeek.label}
                              </span>
                              <button
                                type="button"
                                className="fc-tasks-week-btn"
                                disabled={pickerWeek >= 8 || rowBusy}
                                onClick={() =>
                                  setPickerWeek((n) => Math.min(8, n + 1))
                                }
                              >
                                Later
                              </button>
                            </div>
                            {scheduleWeek.days.map((day) => (
                              <button
                                key={day.ymd}
                                type="button"
                                className={`fc-tasks-day ${
                                  day.ymd === today ? "is-today" : ""
                                }`}
                                disabled={rowBusy}
                                onClick={() => {
                                  setPickerFor(null);
                                  setPickerWeek(0);
                                  onSchedule(todo, day.ymd);
                                }}
                              >
                                {day.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NewTodoForm({
  person,
  clients,
  onCancel,
  onCreate,
}: {
  person: string;
  clients: TaskClientOption[];
  onCancel: () => void;
  onCreate: (input: {
    title: string;
    clientId: string;
    listId: string;
    dueOn: string | null;
    repeat: TodoRepeat;
  }) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState(clients[0]?.id || "");
  const [listId, setListId] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [repeat, setRepeat] = useState<TodoRepeat>("once");
  const [saving, setSaving] = useState(false);
  const [lists, setLists] = useState<Array<{ id: string; name: string }>>([]);
  const [listsLoading, setListsLoading] = useState(false);

  useEffect(() => {
    if (!clientId) {
      setLists([]);
      setListId("");
      return;
    }
    let cancelled = false;
    setListsLoading(true);
    fetch(
      `/api/forecast/todolists?person=${encodeURIComponent(person)}&client=${encodeURIComponent(clientId)}`
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled) return;
        const next = Array.isArray(json?.lists) ? json.lists : [];
        setLists(next);
        setListId((current) =>
          next.some((l: { id: string }) => l.id === current) ? current : ""
        );
      })
      .catch(() => {
        if (!cancelled) setLists([]);
      })
      .finally(() => {
        if (!cancelled) setListsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, person]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !clientId || saving) return;
    if (repeat !== "once" && !dueOn) return;
    setSaving(true);
    const ok = await onCreate({
      title: title.trim(),
      clientId,
      listId,
      dueOn: dueOn || null,
      repeat,
    });
    setSaving(false);
    if (ok) {
      setTitle("");
      setDueOn("");
      setRepeat("once");
    }
  }

  return (
    <form className="fc-tasks-composer" onSubmit={(e) => void submit(e)}>
      <div className="fc-tasks-composer-title">New to-do</div>
      <div className="fc-tasks-composer-grid">
        <label className="fc-tasks-field fc-tasks-field-wide">
          <span>Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing?"
            autoFocus
            required
          />
        </label>
        <label className="fc-tasks-field">
          <span>Client</span>
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            required
          >
            {clients.length === 0 ? (
              <option value="">No clients loaded</option>
            ) : null}
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="fc-tasks-field">
          <span>List</span>
          <select
            value={listId}
            onChange={(e) => setListId(e.target.value)}
            disabled={listsLoading || !clientId}
          >
            <option value="">
              {listsLoading ? "Loading lists…" : "Tasks (default)"}
            </option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="fc-tasks-field">
          <span>Due</span>
          <input
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
          />
        </label>
        <label className="fc-tasks-field">
          <span>Repeat</span>
          <select
            value={repeat}
            onChange={(e) => {
              const next = e.target.value;
              if (isTodoRepeat(next)) setRepeat(next);
            }}
            title="Forecast opens the next to-do when you complete this. Basecamp does not let apps set its Repeat control."
            disabled={!dueOn && repeat === "once"}
          >
            <option value="once">One-time</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
      </div>
      <div className="fc-tasks-composer-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-sm"
          disabled={saving || !title.trim() || !clientId}
        >
          {saving ? "Creating…" : "Create to-do"}
        </button>
      </div>
    </form>
  );
}
