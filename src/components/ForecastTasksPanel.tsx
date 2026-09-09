"use client";

import { useMemo, useState } from "react";
import {
  assignedTaskHref,
  filterAssignedTasks,
  groupAssignedTasks,
  groupAssignedTasksByDue,
  type TasksFilter,
  type TasksLayout,
} from "@/lib/forecast-tasks";
import { sortQueueTodos, type QueueTodo } from "@/lib/forecast-queue";
import type { AssignedSource } from "./ForecastQueue";

export type ForecastDay = { ymd: string; label: string };

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

function dueText(dueOn: string | null, today: string): string {
  if (!dueOn) return "No date";
  if (dueOn < today) return `Overdue · ${shortDate(dueOn)}`;
  if (dueOn === today) return "Due today";
  return `Due ${shortDate(dueOn)}`;
}

/**
 * Top-level Tasks view: everything Basecamp has assigned to this person.
 *
 * Check one off to complete it in Basecamp (and any matching forecast row).
 * Schedule opens a Mon–Fri picker and books the item onto that day of the
 * week being planned. Titles open the to-do in Basecamp.
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
  const [layout, setLayout] = useState<TasksLayout>("due");
  const [pickerFor, setPickerFor] = useState<string | null>(null);

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
        <button
          type="button"
          className="btn btn-ghost btn-sm fc-tasks-refresh"
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
                    const context =
                      todo.kind === "step" && todo.parentTitle
                        ? todo.parentTitle
                        : todo.list || "";

                    return (
                      <li
                        key={todo.id}
                        className={[
                          "fc-tasks-row",
                          forecast?.completed ? "is-done" : "",
                          picking ? "is-picking" : "",
                          tone === "late" ? "is-late" : "",
                          tone === "today" ? "is-today" : "",
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
                              <span className="fc-tasks-ext" aria-hidden="true">
                                ↗
                              </span>
                            </a>
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
                            {showClientInMeta && todo.clientName ? (
                              <span className="fc-tasks-client">
                                {todo.clientName}
                              </span>
                            ) : null}
                            {context ? <span>{context}</span> : null}
                            {forecast && !forecast.completed ? (
                              <span>
                                Planned{" "}
                                {days.find((d) => d.ymd === forecast.taskDate)
                                  ?.label || forecast.taskDate}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div className="fc-tasks-side">
                          <span className={`fc-tasks-due is-${tone}`}>
                            {dueText(todo.dueOn, today)}
                          </span>
                          {booked ? (
                            <span className="fc-tasks-scheduled-label">
                              Scheduled
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="fc-tasks-schedule"
                              disabled={rowBusy}
                              aria-expanded={picking}
                              onClick={() =>
                                setPickerFor((id) =>
                                  id === todo.id ? null : todo.id
                                )
                              }
                            >
                              {schedulingId === todo.id
                                ? "Scheduling…"
                                : picking
                                  ? "Cancel"
                                  : "Schedule"}
                            </button>
                          )}
                        </div>

                        {picking && !booked ? (
                          <div
                            className="fc-tasks-picker"
                            role="group"
                            aria-label="Pick a day"
                          >
                            {days.map((day) => (
                              <button
                                key={day.ymd}
                                type="button"
                                className={`fc-tasks-day ${
                                  day.ymd === today ? "is-today" : ""
                                }`}
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
            );
          })}
        </div>
      )}
    </div>
  );
}
