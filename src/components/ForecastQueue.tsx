"use client";

import { useMemo, useState } from "react";
import {
  bookedRecordingIds,
  sortQueueTodos,
  type ForecastDrag,
  type QueueTodo,
  type QueueTodoKind,
} from "@/lib/forecast-queue";
import { isOnGrid, type CalendarTask } from "./ForecastCalendar";
import { formatTracked, isRunning, trackedSeconds } from "@/lib/forecast-timer";
import { normalizeTaskColor } from "@/lib/forecast-colors";

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
    kind?: QueueTodoKind;
    parentId?: string;
    parentTitle?: string;
  }>;
  assignedCount: number;
  projectId: string;
  reason: string | null;
};

// Everything Basecamp says is assigned to this person, across every project.
export type AssignedSource = {
  loading: boolean;
  assignments: QueueTodo[];
  reason: string | null;
};

type Tab = "queue" | "basecamp";

// Why the Basecamp tab has nothing to show. Split out because the honest answer
// depends on the scope, the filter, the search box, and three separate Basecamp
// failure modes, and inlining all of that made the JSX unreadable.
function emptyReason({
  scoped,
  query,
  assignedOnly,
  source,
  assigned,
  onSyncProjects,
  syncing,
}: {
  scoped: boolean;
  query: string;
  assignedOnly: boolean;
  source: QueueTodoSource | undefined;
  assigned: AssignedSource;
  onSyncProjects: () => void;
  syncing: boolean;
}): React.ReactNode {
  const reason = scoped ? source?.reason : assigned.reason;
  if (reason === "person-not-connected") {
    return "Connect your own Basecamp account to see your work here.";
  }
  if (reason === "not-connected") return "Basecamp isn't connected.";
  if (query.trim()) return `Nothing matching “${query.trim()}”.`;

  if (!scoped) {
    if (reason === "none-assigned") {
      return "Nothing is assigned to you in Basecamp right now.";
    }
    return "Everything assigned to you is already on this week's forecast.";
  }
  if (reason === "no-project") {
    return (
      <>
        This client has no Basecamp project set.{" "}
        <button type="button" className="linklike" onClick={onSyncProjects} disabled={syncing}>
          {syncing ? "Syncing projects…" : "Sync projects."}
        </button>
      </>
    );
  }
  if (assignedOnly && (source?.assignedCount || 0) > 0) {
    return "Nothing assigned to you is left here. Untick the filter to see the rest.";
  }
  return "Nothing open left here that isn't already on the forecast.";
}

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
  assigned,
  hoursDraft,
  onPickClient,
  onHoursDraft,
  onSyncProjects,
  onSyncMeetings,
  syncing,
  syncingMeetings,
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
  assigned: AssignedSource;
  hoursDraft: string;
  onPickClient: (clientId: string) => void;
  onHoursDraft: (value: string) => void;
  onSyncProjects: () => void;
  onSyncMeetings: () => void;
  syncing: boolean;
  syncingMeetings: boolean;
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
  // No client picked means "show me my own work, wherever it lives". Picking one
  // narrows to that project, where the assigned-only filter is worth having
  // because the list is everything open in the project, not just yours.
  const scoped = Boolean(clientId);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (t: QueueTodo) =>
      !q ||
      t.title.toLowerCase().includes(q) ||
      (t.parentTitle || "").toLowerCase().includes(q) ||
      t.list.toLowerCase().includes(q) ||
      t.clientName.toLowerCase().includes(q);

    if (!scoped) {
      return sortQueueTodos(
        assigned.assignments.filter((t) => !booked.has(t.id) && matches(t))
      );
    }
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
    const filtered = mapped.filter((t) => {
      if (assignedOnly && source.assignedCount > 0 && !t.assigned) return false;
      return matches(t);
    });
    return sortQueueTodos(filtered);
  }, [scoped, assigned, source, client, booked, query, assignedOnly]);

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
              {unplaced.map((t) => (
                <div
                  key={t.id}
                  className={`fc-queue-card col-${normalizeTaskColor(t.color)} ${
                    t.completed ? "is-done" : ""
                  } ${
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
                    <button
                      type="button"
                      className="fc-queue-remove"
                      onClick={() => onRemove(t.id)}
                      aria-label="Remove task"
                    >
                      ×
                    </button>
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
            <option value="">Everything assigned to me</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.internal ? " (internal)" : ""}
              </option>
            ))}
          </select>

          {scoped && source?.loading ? (
            <p className="fc-queue-empty">Loading to-dos…</p>
          ) : !scoped && assigned.loading ? (
            <p className="fc-queue-empty">Loading your work…</p>
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
              {scoped && source && source.assignedCount > 0 ? (
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
                  {emptyReason({
                    scoped,
                    query,
                    assignedOnly,
                    source,
                    assigned,
                    onSyncProjects,
                    syncing,
                  })}
                </p>
              ) : (
                <>
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
                        ) : t.kind === "card" ? (
                          <span className="fc-queue-tag">card</span>
                        ) : null}
                        {/* Account-wide, which project it belongs to matters more
                            than which list inside that project. */}
                        <span>
                          {scoped
                            ? t.kind === "step" && t.parentTitle
                              ? t.parentTitle
                              : t.list
                            : t.clientName}
                        </span>
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

      {/* Both refreshes sit here rather than in the page header: they exist to
          fill the pickers directly above them, and that is the only place anyone
          notices something missing. */}
      <div className="fc-queue-foot">
        <button type="button" onClick={onSyncProjects} disabled={syncing}>
          {syncing ? "Syncing…" : "Sync projects"}
        </button>
        <button type="button" onClick={onSyncMeetings} disabled={syncingMeetings}>
          {syncingMeetings ? "Syncing…" : "Sync meetings"}
        </button>
      </div>
    </aside>
  );
}
