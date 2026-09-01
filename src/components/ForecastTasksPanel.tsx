"use client";

import { useMemo, useState } from "react";
import {
  filterAssignedTasks,
  groupAssignedTasks,
  type TasksFilter,
} from "@/lib/forecast-tasks";
import { sortQueueTodos, type QueueTodo } from "@/lib/forecast-queue";
import type { AssignedSource } from "./ForecastQueue";

export type ForecastDay = { ymd: string; label: string };

function dueLabel(dueOn: string | null, today: string): string {
  if (!dueOn) return "";
  if (dueOn < today) return "overdue";
  if (dueOn === today) return "due today";
  return `due ${dueOn.slice(5)}`;
}

/**
 * Top-level Tasks view: everything Basecamp has assigned to this person.
 *
 * Check one off to complete it in Basecamp (and any matching forecast row).
 * Schedule opens a Mon–Fri picker and books the item onto that day of the
 * week being planned.
 */
export function ForecastTasksPanel({
  assigned,
  today,
  days,
  bookedIds,
  forecastTaskByRecording,
  busyId,
  schedulingId,
  onComplete,
  onSchedule,
  onRefresh,
}: {
  assigned: AssignedSource;
  today: string;
  days: ForecastDay[];
  bookedIds: Set<string>;
  // Recording id → forecast task id when that assignment is already on this week.
  forecastTaskByRecording: Map<string, { id: string; completed: boolean; taskDate: string }>;
  busyId: string | null;
  schedulingId: string | null;
  onComplete: (todo: QueueTodo, completed: boolean) => void;
  onSchedule: (todo: QueueTodo, date: string) => void;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState<TasksFilter>("all");
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const groups = useMemo(() => {
    const filtered = filterAssignedTasks(assigned.assignments, filter);
    return groupAssignedTasks(sortQueueTodos(filtered));
  }, [assigned.assignments, filter]);

  const totalShown = groups.reduce((n, g) => n + g.items.length, 0);
  const datedCount = assigned.assignments.filter((a) => a.dueOn).length;

  return (
    <div className="fc-tasks">
      <div className="fc-tasks-toolbar">
        <div className="view-toggle" role="group" aria-label="Task filter">
          <button
            type="button"
            className={`view-toggle-btn ${filter === "all" ? "is-on" : ""}`}
            onClick={() => setFilter("all")}
          >
            All tasks
            {!assigned.loading ? (
              <span className="fc-tasks-count">{assigned.assignments.length}</span>
            ) : null}
          </button>
          <button
            type="button"
            className={`view-toggle-btn ${filter === "dated" ? "is-on" : ""}`}
            onClick={() => setFilter("dated")}
          >
            With dates
            {!assigned.loading ? (
              <span className="fc-tasks-count">{datedCount}</span>
            ) : null}
          </button>
        </div>
        <p className="fc-tasks-hint muted">
          Check one off in Basecamp, or schedule it onto a day this week.
        </p>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onRefresh}
          disabled={assigned.loading}
        >
          {assigned.loading ? "Loading…" : "Refresh"}
        </button>
      </div>

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
          {groups.map((group) => (
            <section key={group.key} className="fc-tasks-group">
              <h2 className="fc-tasks-group-title">{group.label}</h2>
              <ul className="fc-tasks-list">
                {group.items.map((todo) => {
                  const booked = bookedIds.has(todo.id);
                  const forecast = forecastTaskByRecording.get(todo.id);
                  const picking = pickerFor === todo.id;
                  const rowBusy = busyId === todo.id || schedulingId === todo.id;

                  return (
                    <li
                      key={todo.id}
                      className={`fc-tasks-row ${forecast?.completed ? "is-done" : ""} ${
                        picking ? "is-picking" : ""
                      }`}
                    >
                      <label className="fc-tasks-check">
                        <input
                          type="checkbox"
                          checked={Boolean(forecast?.completed)}
                          disabled={rowBusy}
                          onChange={(e) => onComplete(todo, e.target.checked)}
                          aria-label={`Mark “${todo.title}” complete`}
                        />
                      </label>
                      <div className="fc-tasks-main">
                        <div className="fc-tasks-title-row">
                          <strong className="fc-tasks-title">{todo.title}</strong>
                          {todo.kind === "step" ? (
                            <span className="fc-queue-tag">subtask</span>
                          ) : todo.kind === "card" ? (
                            <span className="fc-queue-tag">card</span>
                          ) : null}
                          {booked ? (
                            <span className="fc-tasks-on">On forecast</span>
                          ) : null}
                        </div>
                        <div className="fc-tasks-meta">
                          {todo.kind === "step" && todo.parentTitle ? (
                            <span>{todo.parentTitle}</span>
                          ) : todo.list ? (
                            <span>{todo.list}</span>
                          ) : null}
                          {todo.dueOn ? (
                            <span className={todo.dueOn < today ? "fc-queue-late" : ""}>
                              {dueLabel(todo.dueOn, today)}
                            </span>
                          ) : (
                            <span className="muted">no date</span>
                          )}
                          {forecast && !forecast.completed ? (
                            <span className="muted">
                              {days.find((d) => d.ymd === forecast.taskDate)?.label ||
                                forecast.taskDate}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="fc-tasks-actions">
                        {booked ? (
                          <span className="muted fc-tasks-scheduled-label">Scheduled</span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={rowBusy}
                            aria-expanded={picking}
                            onClick={() =>
                              setPickerFor((id) => (id === todo.id ? null : todo.id))
                            }
                          >
                            {schedulingId === todo.id ? "Scheduling…" : "Schedule"}
                          </button>
                        )}
                      </div>
                      {picking && !booked ? (
                        <div className="fc-tasks-picker" role="group" aria-label="Pick a day">
                          {days.map((day) => (
                            <button
                              key={day.ymd}
                              type="button"
                              className={`fc-tasks-day ${day.ymd === today ? "is-today" : ""}`}
                              disabled={rowBusy}
                              onClick={() => {
                                setPickerFor(null);
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
          ))}
        </div>
      )}
    </div>
  );
}
