"use client";

import { useState } from "react";
import {
  CAL_END_HOUR,
  CAL_PX_PER_HOUR,
  CAL_START_HOUR,
  addHoursToTime,
  formatTimeLabel,
  layoutTimedBlocks,
  padTime,
} from "@/lib/forecast-time";

export type CalendarTask = {
  id: string;
  task_date: string;
  client: string;
  notes: string;
  hours: number;
  completed: number;
  priority: string;
  start_time: string;
  basecamp_event_id: string;
};

export function ForecastCalendar({
  days,
  today,
  tasksByDay,
  dayName,
  dayShortDate,
  dragId,
  dropDay,
  onToggle,
  onRemove,
  onSlotClick,
  onDrop,
  onDragOver,
  onDragLeave,
  dragProps,
}: {
  days: string[];
  today: string;
  tasksByDay: { get(date: string): CalendarTask[] | undefined };
  dayName: (ymd: string) => string;
  dayShortDate: (ymd: string) => string;
  dragId: string | null;
  dropDay: string | null;
  onToggle: (task: CalendarTask) => void;
  onRemove: (id: string) => void;
  onSlotClick: (date: string, startTime: string) => void;
  onDrop: (date: string, startTime: string | null, id?: string) => void;
  onDragOver: (e: React.DragEvent, date: string) => void;
  onDragLeave: (e: React.DragEvent, date: string) => void;
  dragProps: (task: CalendarTask) => {
    draggable: boolean;
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: () => void;
  };
}) {
  const hours: number[] = [];
  for (let h = CAL_START_HOUR; h < CAL_END_HOUR; h++) hours.push(h);
  const gridHeight = (CAL_END_HOUR - CAL_START_HOUR) * CAL_PX_PER_HOUR;
  const [trayDrop, setTrayDrop] = useState<string | null>(null);
  const hasUnscheduled = days.some((date) =>
    (tasksByDay.get(date) || []).some((t) => !t.start_time)
  );
  const showUnscheduled = hasUnscheduled || Boolean(dragId);

  return (
    <div className="fc-cal">
      <div className="fc-cal-grid" style={{ gridTemplateColumns: `52px repeat(${days.length}, 1fr)` }}>
        <div className="fc-cal-gutter-head" />
        {days.map((date) => {
          const dayHours = (tasksByDay.get(date) || []).reduce((s, t) => s + t.hours, 0);
          return (
            <div
              key={`h-${date}`}
              className={`fc-cal-day-head ${date === today ? "is-today" : ""}`}
            >
              <div className="ops-day-name">{dayName(date)}</div>
              <div className="ops-day-date">{dayShortDate(date)}</div>
              <span className="ops-day-hours">{dayHours ? `${dayHours}h` : "—"}</span>
            </div>
          );
        })}

        <div className="fc-cal-gutter" style={{ height: gridHeight }}>
          {hours.map((h) => (
            <div key={h} className="fc-cal-hour-label" style={{ height: CAL_PX_PER_HOUR }}>
              {formatTimeLabel(padTime(h, 0))}
            </div>
          ))}
        </div>

        {days.map((date) => {
          const all = tasksByDay.get(date) || [];
          const timed = all.filter((t) => t.start_time);
          const blocks = layoutTimedBlocks(timed, (t) => t.start_time, (t) => t.hours);
          return (
            <div
              key={date}
              className={`fc-cal-day ${date === today ? "is-today" : ""} ${
                dropDay === date ? "is-drop-target" : ""
              }`}
              style={{ height: gridHeight }}
              onDragOver={(e) => onDragOver(e, date)}
              onDragLeave={(e) => onDragLeave(e, date)}
              onDrop={(e) => {
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const y = e.clientY - rect.top;
                const hour = CAL_START_HOUR + Math.floor(y / CAL_PX_PER_HOUR);
                const clamped = Math.min(CAL_END_HOUR - 1, Math.max(CAL_START_HOUR, hour));
                onDrop(date, padTime(clamped, 0), e.dataTransfer.getData("text/plain"));
              }}
            >
              {hours.map((h) => (
                <button
                  key={h}
                  type="button"
                  className="fc-cal-slot"
                  style={{ top: (h - CAL_START_HOUR) * CAL_PX_PER_HOUR, height: CAL_PX_PER_HOUR }}
                  aria-label={`Add at ${formatTimeLabel(padTime(h, 0))} on ${dayName(date)}`}
                  onClick={() => onSlotClick(date, padTime(h, 0))}
                />
              ))}
              {blocks.map((b) => {
                const top = ((b.startMin - CAL_START_HOUR * 60) / 60) * CAL_PX_PER_HOUR;
                const height = Math.max(76, ((b.endMin - b.startMin) / 60) * CAL_PX_PER_HOUR);
                const width = `calc(${100 / b.cols}% - 4px)`;
                const left = `calc(${(100 / b.cols) * b.col}% + 2px)`;
                const end = addHoursToTime(b.item.start_time, b.item.hours);
                return (
                  <div
                    key={b.item.id}
                    className={`fc-cal-block pri-${b.item.priority} ${b.item.completed ? "is-done" : ""} ${
                      dragId === b.item.id ? "is-dragging" : ""
                    }`}
                    style={{ top: Math.max(0, top), height, left, width }}
                    title={[b.item.client, b.item.notes].filter(Boolean).join(" — ") || "Drag to another time or day"}
                    {...dragProps(b.item)}
                  >
                    <div className="fc-cal-block-top">
                      <input
                        type="checkbox"
                        checked={!!b.item.completed}
                        onChange={() => onToggle(b.item)}
                        aria-label="Mark complete"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="fc-cal-block-time">
                        {formatTimeLabel(b.item.start_time)}
                        {end ? `–${formatTimeLabel(end)}` : ""}
                      </span>
                      <button
                        type="button"
                        className="remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemove(b.item.id);
                        }}
                      >
                        Remove
                      </button>
                    </div>
                    <div className="fc-cal-block-body">
                      <strong>{b.item.client || "Task"}</strong>
                      {b.item.notes ? <div className="fc-cal-block-notes">{b.item.notes}</div> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {showUnscheduled ? (
      <div className="fc-cal-unscheduled">
        <p className="fc-cal-unscheduled-label">No start time — drop onto an hour to place it, or drop a timed task here to unschedule it</p>
        <div className="fc-cal-unscheduled-days" style={{ gridTemplateColumns: `52px repeat(${days.length}, 1fr)` }}>
          <div />
          {days.map((date) => {
            const loose = (tasksByDay.get(date) || []).filter((t) => !t.start_time);
            return (
              <div
                key={`u-${date}`}
                className={`fc-cal-unscheduled-col ${trayDrop === date ? "is-drop-target" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (trayDrop !== date) setTrayDrop(date);
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                  setTrayDrop((d) => (d === date ? null : d));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setTrayDrop(null);
                  onDrop(date, null, e.dataTransfer.getData("text/plain"));
                }}
              >
                {loose.map((t) => (
                  <div
                    key={t.id}
                    className={`ops-task-chip pri-${t.priority} ${t.completed ? "is-done" : ""} ${
                      dragId === t.id ? "is-dragging" : ""
                    }`}
                    title={[t.client, t.notes].filter(Boolean).join(" — ") || "Drag onto the calendar to give this a start time"}
                    {...dragProps(t)}
                  >
                    <div className="chip-top">
                      <input
                        type="checkbox"
                        className="done-check"
                        checked={!!t.completed}
                        onChange={() => onToggle(t)}
                        aria-label="Mark complete"
                      />
                      <span className="client">{t.client || "Task"}</span>
                      <span className="hrs">{t.hours}h</span>
                    </div>
                    {t.notes ? (
                      <div className="fc-cal-chip-copy">
                        <div className="notes">{t.notes}</div>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      ) : null}
    </div>
  );
}
