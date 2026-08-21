"use client";

import { useEffect, useRef, useState } from "react";
import {
  CAL_END_HOUR,
  CAL_PX_PER_HOUR,
  CAL_SNAP_MINUTES,
  CAL_START_HOUR,
  addHoursToTime,
  formatTimeLabel,
  hoursFromResize,
  layoutTimedBlocks,
  minutesFromMidnight,
  padTime,
  timeAtOffset,
} from "@/lib/forecast-time";
import type { ForecastDrag } from "@/lib/forecast-queue";
import {
  blockHours,
  formatTracked,
  isRunning,
  trackedSeconds,
} from "@/lib/forecast-timer";
import { normalizeTaskColor } from "@/lib/forecast-colors";

export type CalendarTask = {
  id: string;
  task_date: string;
  client: string;
  notes: string;
  hours: number;
  completed: number;
  color: string;
  start_time: string;
  basecamp_event_id: string;
  basecamp_todo_id: string;
  basecamp_step_id: string;
  actual_hours: number;
  basecamp_time_entry_id: string;
  tracked_seconds: number;
  timer_started_at: string;
};

// Three densities, because a block's height is set by how long the task runs and
// nothing else. Under COMPACT it holds one line total, so the title rides beside
// the time. Between the two it holds the title alone. Only at ROOMY is there room
// for the client underneath as well — at 64px (a one-hour task) that second line
// was rendering half-clipped by the block's own bottom edge.
const COMPACT_BLOCK_PX = 44;
const ROOMY_BLOCK_PX = 78;

// Where "now" sits on the grid, or null when the current time is outside the
// hours the calendar shows. Recomputed on a timer rather than per render so the
// line moves on its own while the page is left open.
function useNowOffset(): number | null {
  const [offset, setOffset] = useState<number | null>(null);
  useEffect(() => {
    function tick() {
      const now = new Date();
      const minutes = now.getHours() * 60 + now.getMinutes();
      const start = CAL_START_HOUR * 60;
      const end = CAL_END_HOUR * 60;
      setOffset(
        minutes < start || minutes > end ? null : ((minutes - start) / 60) * CAL_PX_PER_HOUR
      );
    }
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);
  return offset;
}

export function ForecastCalendar({
  days,
  today,
  tasksByDay,
  capacityPerDay,
  dayName,
  dayShortDate,
  drag,
  dropDay,
  onToggle,
  onRemove,
  onSlotClick,
  onDropAt,
  onDragOverDay,
  onDragLeaveDay,
  onTaskDragStart,
  onDragEnd,
  onResize,
  onOpenEditor,
  onToggleTimer,
  timerBusyId,
  nowMs,
}: {
  days: string[];
  today: string;
  tasksByDay: { get(date: string): CalendarTask[] | undefined };
  // Hours in a normal working day, used to flag an overbooked column.
  capacityPerDay: number;
  dayName: (ymd: string) => string;
  dayShortDate: (ymd: string) => string;
  drag: ForecastDrag | null;
  dropDay: string | null;
  onToggle: (task: CalendarTask) => void;
  onRemove: (id: string) => void;
  // Reports the clicked cell's position as well as its time, so the add form can
  // open where the click landed instead of at the bottom of a 768px grid.
  onSlotClick: (date: string, startTime: string, at: { x: number; y: number }) => void;
  onDropAt: (date: string, startTime: string) => void;
  onDragOverDay: (e: React.DragEvent, date: string) => void;
  onDragLeaveDay: (e: React.DragEvent, date: string) => void;
  onTaskDragStart: (e: React.DragEvent, task: CalendarTask, grabOffsetMin: number) => void;
  onDragEnd: () => void;
  onResize: (task: CalendarTask, hours: number) => void;
  // Clicking a block opens its editor. A click never fires after a drag, so this
  // does not fight dragging the block to a new time.
  onOpenEditor: (task: CalendarTask, at: { x: number; y: number }) => void;
  onToggleTimer: (task: CalendarTask) => void;
  timerBusyId: string | null;
  // Ticking clock, owned by the page so one timer drives every view at once.
  nowMs: number;
}) {
  const hours: number[] = [];
  for (let h = CAL_START_HOUR; h < CAL_END_HOUR; h++) hours.push(h);
  const gridHeight = (CAL_END_HOUR - CAL_START_HOUR) * CAL_PX_PER_HOUR;
  const nowOffset = useNowOffset();
  const dragId = drag?.kind === "task" ? drag.id : null;

  // Live resize: which block is being stretched and what it currently reads, so
  // the block shows its new length under the cursor and only saves on release.
  const [resizing, setResizing] = useState<{ id: string; hours: number } | null>(null);
  const resizeRef = useRef<{ task: CalendarTask; hours: number } | null>(null);

  function startResize(e: React.PointerEvent, task: CalendarTask, column: HTMLElement | null) {
    if (!column) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = column.getBoundingClientRect();
    resizeRef.current = { task, hours: task.hours };
    setResizing({ id: task.id, hours: task.hours });

    function move(ev: PointerEvent) {
      const next = hoursFromResize(ev.clientY - rect.top, task.start_time);
      if (!next) return;
      resizeRef.current = { task, hours: next };
      setResizing({ id: task.id, hours: next });
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const held = resizeRef.current;
      resizeRef.current = null;
      setResizing(null);
      if (held && held.hours !== task.hours) onResize(task, held.hours);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div className="fc-cal">
      <div
        className="fc-cal-grid"
        style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}
      >
        <div className="fc-cal-gutter-head" />
        {days.map((date) => {
          const all = tasksByDay.get(date) || [];
          const dayHours = all.reduce((s, t) => s + t.hours, 0);
          const unplaced = all.filter((t) => !t.start_time).length;
          return (
            <div
              key={`h-${date}`}
              className={`fc-cal-day-head ${date === today ? "is-today" : ""} ${
                dayHours > capacityPerDay ? "is-over" : ""
              }`}
            >
              <div className="fc-cal-dow">{dayName(date).slice(0, 3)}</div>
              <div className="fc-cal-dom">{dayShortDate(date).split(" ")[1]}</div>
              <span className="ops-day-hours">
                {dayHours ? `${Math.round(dayHours * 10) / 10}h` : ""}
                {unplaced ? <em> · {unplaced} queued</em> : null}
              </span>
            </div>
          );
        })}

        <div className="fc-cal-gutter" style={{ height: gridHeight }}>
          {hours.map((h) => (
            <div key={h} className="fc-cal-hour-label" style={{ height: CAL_PX_PER_HOUR }}>
              {formatTimeLabel(padTime(h, 0)).toLowerCase()}
            </div>
          ))}
        </div>

        {days.map((date) => {
          const all = tasksByDay.get(date) || [];
          const timed = all.filter((t) => t.start_time);
          // Measured time, not the estimate: a task that has run long overlaps
          // whatever was planned after it, and should be columned accordingly.
          const blocks = layoutTimedBlocks(
            timed,
            (t) => t.start_time,
            (t) => blockHours(t, nowMs)
          );
          return (
            <div
              key={date}
              className={`fc-cal-day ${date === today ? "is-today" : ""} ${
                dropDay === date ? "is-drop-target" : ""
              } ${drag ? "is-dragging-over-cal" : ""}`}
              style={{ height: gridHeight }}
              onDragOver={(e) => onDragOverDay(e, date)}
              onDragLeave={(e) => onDragLeaveDay(e, date)}
              onDrop={(e) => {
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                onDropAt(
                  date,
                  timeAtOffset(e.clientY - rect.top, {
                    grabOffsetMin: drag?.kind === "task" ? drag.grabOffsetMin : 0,
                    durationMin: drag?.durationMin || 0,
                  })
                );
              }}
            >
              {hours.map((h) => (
                <button
                  key={h}
                  type="button"
                  className="fc-cal-slot"
                  style={{ top: (h - CAL_START_HOUR) * CAL_PX_PER_HOUR, height: CAL_PX_PER_HOUR }}
                  aria-label={`Add at ${formatTimeLabel(padTime(h, 0))} on ${dayName(date)}`}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    onSlotClick(date, padTime(h, 0), { x: r.left + r.width / 2, y: r.bottom });
                  }}
                />
              ))}
              {date === today && nowOffset != null ? (
                <div className="fc-cal-now" style={{ top: nowOffset }} aria-hidden="true" />
              ) : null}
              {blocks.map((b) => {
                // A running or overrun task draws as long as it has actually
                // taken, so the calendar shows the day that happened. Resizing
                // takes over while the handle is held.
                const live =
                  resizing?.id === b.item.id
                    ? resizing.hours
                    : blockHours(b.item, nowMs);
                const timing = isRunning(b.item);
                const top = ((b.startMin - CAL_START_HOUR * 60) / 60) * CAL_PX_PER_HOUR;
                const height = Math.max(28, live * CAL_PX_PER_HOUR);
                // Overlapping blocks cascade rather than share the column
                // equally. Two 50% columns left titles like "Department
                // Internal Check In" breaking mid-word; letting the earlier
                // block keep most of the width and the later one sit on top of
                // it is what a calendar normally does, and both stay readable.
                const slot = 100 / b.cols;
                const widthPct = Math.min(slot * 1.8, 100 - slot * b.col);
                const width = `calc(${widthPct}% - 4px)`;
                const left = `calc(${slot * b.col}% + 2px)`;
                const end = addHoursToTime(b.item.start_time, live);
                const compact = height < COMPACT_BLOCK_PX;
                const roomy = height >= ROOMY_BLOCK_PX;
                const logged = Boolean(b.item.basecamp_time_entry_id);
                return (
                  <div
                    key={b.item.id}
                    className={`fc-cal-block col-${normalizeTaskColor(b.item.color)} ${
                      b.item.completed ? "is-done" : ""
                    } ${dragId === b.item.id ? "is-dragging" : ""} ${
                      resizing?.id === b.item.id ? "is-resizing" : ""
                    } ${compact ? "is-compact" : ""} ${
                      b.item.basecamp_event_id ? "is-meeting" : ""
                    } ${timing ? "is-timing" : ""} ${
                      timing || logged ? "has-stamp" : ""
                    }`}
                    style={{
                      top: Math.max(0, top),
                      height,
                      left,
                      width,
                      zIndex: 2 + b.col,
                    }}
                    title={
                      [
                        `${formatTimeLabel(b.item.start_time)}${
                          end ? `–${formatTimeLabel(end)}` : ""
                        }`,
                        b.item.notes,
                        b.item.client,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    }
                    draggable
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      onOpenEditor(b.item, {
                        x: r.left + r.width / 2,
                        y: r.bottom,
                      });
                    }}
                    onDragStart={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const grabbedPx = e.clientY - rect.top;
                      onTaskDragStart(
                        e,
                        b.item,
                        Math.round((grabbedPx / CAL_PX_PER_HOUR) * 60)
                      );
                    }}
                    onDragEnd={onDragEnd}
                  >
                    {/* Content first. Every control here is hover-only: a
                        calendar is read far more often than it is edited, and a
                        checkbox plus a timer plus a remove on the face of every
                        block is most of what made this look busy. */}
                    <div className="fc-cal-block-main">
                      <strong className="fc-cal-block-title">
                        {b.item.notes || b.item.client || "Task"}
                      </strong>
                      {compact ? null : (
                        <span className="fc-cal-block-when">
                          {formatTimeLabel(b.item.start_time)}
                          {end ? ` – ${formatTimeLabel(end)}` : ""}
                        </span>
                      )}
                      {roomy && b.item.notes && b.item.client ? (
                        <span className="fc-cal-block-client">{b.item.client}</span>
                      ) : null}
                    </div>

                    <div className="fc-cal-block-foot">
                      {timing ? (
                        <span className="fc-cal-block-stamp is-running">
                          <em>Running</em>
                          {formatTracked(trackedSeconds(b.item, nowMs), true)}
                        </span>
                      ) : logged ? (
                        <span
                          className="fc-cal-block-stamp"
                          title={`${b.item.actual_hours}h logged to Basecamp`}
                        >
                          {b.item.actual_hours}h logged
                        </span>
                      ) : null}
                      <div className="fc-cal-block-tools">
                      <input
                        type="checkbox"
                        checked={!!b.item.completed}
                        onChange={() => onToggle(b.item)}
                        aria-label="Mark complete"
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      />
                      <button
                        type="button"
                        className={`fc-cal-block-timer ${timing ? "is-running" : ""}`}
                        disabled={timerBusyId === b.item.id}
                        aria-label={timing ? "Stop the timer" : "Start timing this task"}
                        title={timing ? "Stop the timer" : "Start timing this task"}
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleTimer(b.item);
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        draggable={false}
                        onDragStart={(e) => e.preventDefault()}
                      />
                      <button
                        type="button"
                        className="fc-cal-block-x"
                        aria-label="Remove task"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemove(b.item.id);
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        ×
                      </button>
                      </div>
                    </div>

                    <span
                      className="fc-cal-block-grip"
                      role="presentation"
                      title={`Drag to change length (${CAL_SNAP_MINUTES} min steps)`}
                      onPointerDown={(e) =>
                        startResize(e, b.item, e.currentTarget.closest(".fc-cal-day"))
                      }
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Whether a task is inside the hours the calendar renders. A row timed at 6am
// exists but would sit above the grid, so the queue keeps showing it.
export function isOnGrid(startTime: string): boolean {
  const mins = minutesFromMidnight(startTime);
  if (mins == null) return false;
  return mins >= CAL_START_HOUR * 60 && mins < CAL_END_HOUR * 60;
}
