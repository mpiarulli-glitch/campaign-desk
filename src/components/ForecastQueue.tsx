"use client";

import { useMemo, useState } from "react";
import {
  bookedRecordingIds,
  sortQueueTodos,
  type ForecastDrag,
  type QueueTodo,
} from "@/lib/forecast-queue";
import { isOnGrid, type CalendarTask } from "./ForecastCalendar";
import { formatTracked, isRunning, trackedSeconds } from "@/lib/forecast-timer";

export type QueueClient = { id: string; name: string; internal?: boolean };

// Basecamp todos for one client or internal project, as the picker endpoint
// returns them. `reason` explains an empty list.
export type QueueTodoSource = {
  loading: boolean;
  todos: Array<{
    id: string;
    title: string;
    list: string;
    dueOn: string | null;
    assigned?: boolean;
    kind?: "todo" | "step";
    parentId?: string;
    parentTitle?: string;
  }>;
  assignedCount: number;
  projectId: string;
  reason: string | null;
};

type Tab = "queue" | "basecamp";

function dueLabel(dueOn: string | null, today: string): string {
  if (!dueOn) return "";
  if (dueOn < today) return "overdue";
  if (dueOn === today) return "due today";
  return `due ${dueOn.slice(5)}`;
}

/**
 * The list beside the calendar: everything waiting for a slot.
 *
 * Two sources, one drag target. "Queue" is forecast rows that already exist but
 * have no time on them; "Basecamp" is open to-dos and subtasks that aren't on the
 * forecast at all. Both drag onto an hour on the grid, and a Basecamp item
 * becomes a forecast row at the moment it lands.
 */
export function ForecastQueue({
  tasks,
  today,
  clients,
  clientId,
  source,
  hoursDraft,
  onPickClient,
  onHoursDraft,
  onSyncProjects,
  syncing,
  drag,
  onTaskDragStart,
  onTodoDragStart,
  onDragEnd,
  onToggle,
  onRemove,
  onQueueTodo,
  onToggleTimer,
  timerBusyId,
  nowMs,
  dayLabel,
  busy,
}: {
  // Forecast rows for the whole week, placed and unplaced.
  tasks: CalendarTask[];
  today: string;
  clients: QueueClient[];
  clientId: string;
  source: QueueTodoSource | undefined;
  hoursDraft: string;
  onPickClient: (clientId: string) => void;
  onHoursDraft: (value: string) => void;
  onSyncProjects: () => void;
  syncing: boolean;
  drag: ForecastDrag | null;
  onTaskDragStart: (e: React.DragEvent, task: CalendarTask) => void;
  onTodoDragStart: (e: React.DragEvent, todo: QueueTodo) => void;
  onDragEnd: () => void;
  onToggle: (task: CalendarTask) => void;
  onRemove: (id: string) => void;
  // Add a Basecamp item to the forecast without a slot, so it joins the queue.
  onQueueTodo: (todo: QueueTodo) => void;
  // Starting a queue card's timer also gives it a slot, so the block it grows
  // into is somewhere on the calendar you can watch.
  onToggleTimer: (task: CalendarTask) => void;
  timerBusyId: string | null;
  nowMs: number;
  dayLabel: (ymd: string) => string;
  busy: boolean;
}) {
  const [tab, setTab] = useState<Tab>("queue");
  const [query, setQuery] = useState("");
  const [assignedOnly, setAssignedOnly] = useState(true);

  // No start time, or a time the grid doesn't reach — a 6am row is real work
  // that would otherwise sit above the visible hours and look lost.
  const unplaced = useMemo(
    () =>
      tasks
        .filter((t) => !isOnGrid(t.start_time))
        .sort(
          (a, b) =>
            a.task_date.localeCompare(b.task_date) ||
            a.start_time.localeCompare(b.start_time)
        ),
    [tasks]
  );
  const booked = useMemo(() => bookedRecordingIds(tasks), [tasks]);

  const client = clients.find((c) => c.id === clientId);

  // Basecamp items, minus anything already booked this week, then filtered and
  // sorted for picking. Subtasks keep their parent's name beside them so a
  // one-word subtask still says what it belongs to.
  const candidates = useMemo(() => {
    if (!source || !client) return [];
    const projectId = source.projectId;
    const mapped: QueueTodo[] = source.todos
      .filter((t) => !booked.has(t.id))
      .map((t) => ({
        ...t,
        projectId,
        clientId: client.id,
        clientName: client.name,
      }));
    const q = query.trim().toLowerCase();
    const filtered = mapped.filter((t) => {
      if (assignedOnly && source.assignedCount > 0 && !t.assigned) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        (t.parentTitle || "").toLowerCase().includes(q) ||
        t.list.toLowerCase().includes(q)
      );
    });
    return sortQueueTodos(filtered);
  }, [source, client, booked, query, assignedOnly]);

  const queueCount = unplaced.length;

  return (
    <aside className={`fc-queue ${drag ? "is-dragging" : ""}`}>
      <div className="fc-queue-tabs" role="tablist" aria-label="Task queue">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "queue"}
          className={`fc-queue-tab ${tab === "queue" ? "is-on" : ""}`}
          onClick={() => setTab("queue")}
        >
          Unplaced
          {queueCount ? <span className="fc-queue-count">{queueCount}</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "basecamp"}
          className={`fc-queue-tab ${tab === "basecamp" ? "is-on" : ""}`}
          onClick={() => setTab("basecamp")}
        >
          Basecamp
        </button>
      </div>

      {tab === "queue" ? (
        <div className="fc-queue-body">
          {unplaced.length === 0 ? (
            <p className="fc-queue-empty">
              Everything on this week&apos;s forecast has a slot. Pull more work in from the
              Basecamp tab.
            </p>
          ) : (
            <>
              <p className="fc-queue-hint">Drag one onto an hour to give it a time.</p>
              {unplaced.map((t) => (
                <div
                  key={t.id}
                  className={`fc-queue-card pri-${t.priority} ${t.completed ? "is-done" : ""} ${
                    drag?.kind === "task" && drag.id === t.id ? "is-dragging" : ""
                  } ${isRunning(t) ? "is-timing" : ""}`}
                  draggable
                  onDragStart={(e) => onTaskDragStart(e, t)}
                  onDragEnd={onDragEnd}
                  title="Drag onto the calendar to give this a start time"
                >
                  <div className="fc-queue-card-top">
                    <input
                      type="checkbox"
                      checked={!!t.completed}
                      onChange={() => onToggle(t)}
                      aria-label="Mark complete"
                      onMouseDown={(e) => e.stopPropagation()}
                    />
                    <strong>{t.notes || t.client || "Task"}</strong>
                    <span className="fc-queue-hrs">{t.hours}h</span>
                  </div>
                  <div className="fc-queue-card-meta">
                    <span>{dayLabel(t.task_date)}</span>
                    {t.client && t.notes ? <span>{t.client}</span> : null}
                    {t.basecamp_step_id ? <span className="fc-queue-tag">subtask</span> : null}
                    <button
                      type="button"
                      className={`fc-timer-btn is-compact ${
                        isRunning(t) ? "is-running" : ""
                      }`}
                      style={{ marginLeft: "auto" }}
                      disabled={timerBusyId === t.id}
                      onClick={() => onToggleTimer(t)}
                      onMouseDown={(e) => e.stopPropagation()}
                      draggable={false}
                      onDragStart={(e) => e.preventDefault()}
                      title={
                        isRunning(t)
                          ? "Stop the timer and keep the time"
                          : "Start timing this task"
                      }
                    >
                      <span className="fc-timer-icon" aria-hidden="true" />
                      {isRunning(t) || t.tracked_seconds
                        ? formatTracked(trackedSeconds(t, nowMs), isRunning(t))
                        : "Start"}
                    </button>
                    <button
                      type="button"
                      className="fc-queue-remove"
                      onClick={() => onRemove(t.id)}
                      aria-label="Remove task"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      ) : (
        <div className="fc-queue-body">
          <select
            className="fc-queue-select"
            value={clientId}
            onChange={(e) => onPickClient(e.target.value)}
            aria-label="Client or internal project"
          >
            <option value="">Pick a client or project</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.internal ? " (internal)" : ""}
              </option>
            ))}
          </select>

          {!clientId ? (
            <p className="fc-queue-empty">
              Pick a client to see its open Basecamp to-dos and subtasks.{" "}
              <button type="button" className="linklike" onClick={onSyncProjects} disabled={syncing}>
                {syncing ? "Syncing projects…" : "Missing one? Sync projects."}
              </button>
            </p>
          ) : source?.loading ? (
            <p className="fc-queue-empty">Loading to-dos…</p>
          ) : (
            <>
              <div className="fc-queue-controls">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter to-dos"
                  aria-label="Filter to-dos"
                />
                <label className="fc-queue-hours">
                  <span>Hours</span>
                  <input
                    value={hoursDraft}
                    onChange={(e) => onHoursDraft(e.target.value)}
                    type="number"
                    min="0"
                    step="0.25"
                    aria-label="Hours for items dragged in"
                  />
                </label>
              </div>
              {source && source.assignedCount > 0 ? (
                <label className="fc-queue-check">
                  <input
                    type="checkbox"
                    checked={assignedOnly}
                    onChange={(e) => setAssignedOnly(e.target.checked)}
                  />
                  <span>Only work assigned to me ({source.assignedCount})</span>
                </label>
              ) : null}

              {candidates.length === 0 ? (
                <p className="fc-queue-empty">
                  {source?.reason === "person-not-connected"
                    ? "Connect your own Basecamp account to pick from your to-dos."
                    : source?.reason === "no-project"
                      ? "This client has no Basecamp project set."
                      : source?.reason === "not-connected"
                        ? "Basecamp isn't connected."
                        : assignedOnly && (source?.assignedCount || 0) > 0
                          ? "Nothing assigned to you is left here. Untick the filter to see the rest."
                          : "Nothing open left here that isn't already on the forecast."}
                </p>
              ) : (
                <>
                  <p className="fc-queue-hint">
                    Drag one onto an hour to book it, or queue it for later.
                  </p>
                  {candidates.map((t) => (
                    <div
                      key={t.id}
                      className={`fc-queue-card is-todo ${t.kind === "step" ? "is-step" : ""} ${
                        drag?.kind === "todo" && drag.todo.id === t.id ? "is-dragging" : ""
                      }`}
                      draggable
                      onDragStart={(e) => onTodoDragStart(e, t)}
                      onDragEnd={onDragEnd}
                      title="Drag onto the calendar to book it"
                    >
                      <div className="fc-queue-card-top">
                        <strong>{t.title}</strong>
                      </div>
                      <div className="fc-queue-card-meta">
                        {t.kind === "step" ? (
                          <span className="fc-queue-tag">subtask</span>
                        ) : null}
                        {t.kind === "step" && t.parentTitle ? (
                          <span>{t.parentTitle}</span>
                        ) : (
                          <span>{t.list}</span>
                        )}
                        {t.dueOn ? (
                          <span className={t.dueOn < today ? "fc-queue-late" : ""}>
                            {dueLabel(t.dueOn, today)}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          className="fc-queue-add"
                          disabled={busy}
                          onClick={() => onQueueTodo(t)}
                        >
                          Queue
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      )}
    </aside>
  );
}
