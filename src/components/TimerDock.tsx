"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FORECAST_TIMER_CHANGED,
  formatTracked,
  notifyForecastTimerChanged,
  trackedSeconds,
} from "@/lib/forecast-timer";

type RunningTask = {
  id: string;
  person: string;
  notes: string;
  client: string;
  tracked_seconds: number;
  timer_started_at: string;
};

const LIVE_POLL_MS = 1000;
const IDLE_POLL_MS = 20_000;

export function TimerDock() {
  const pathname = usePathname();
  const [tasks, setTasks] = useState<RunningTask[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/forecast/running");
      if (res.status === 401) {
        tasksRef.current = [];
        setTasks([]);
        return;
      }
      if (!res.ok) return;
      const json = await res.json().catch(() => null);
      const next: RunningTask[] = Array.isArray(json?.tasks) ? json.tasks : [];
      tasksRef.current = next;
      setTasks(next);
    } catch {
      // Keep whatever is on screen; a blip should not hide a running clock.
    }
  }, []);

  useEffect(() => {
    let on = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function schedule() {
      if (timer) clearTimeout(timer);
      const ms = tasksRef.current.length ? LIVE_POLL_MS : IDLE_POLL_MS;
      timer = setTimeout(async () => {
        if (!on) return;
        await load();
        if (on) schedule();
      }, ms);
    }

    void load().then(() => {
      if (on) schedule();
    });

    function refresh() {
      void load().then(() => {
        if (on) schedule();
      });
    }
    function onVisibility() {
      if (document.visibilityState === "visible") refresh();
    }

    window.addEventListener("focus", refresh);
    window.addEventListener(FORECAST_TIMER_CHANGED, refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      on = false;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(FORECAST_TIMER_CHANGED, refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, pathname]);

  const running = tasks.length > 0;
  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [running]);

  async function stop(task: RunningTask) {
    setBusyId(task.id);
    const res = await fetch(`/api/forecast/${task.person}/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timer: "stop" }),
    });
    setBusyId(null);
    if (!res.ok) return;
    const next = tasksRef.current.filter((row) => row.id !== task.id);
    tasksRef.current = next;
    setTasks(next);
    notifyForecastTimerChanged();
    await load();
  }

  if (tasks.length === 0) return null;

  return (
    <div className="fc-timer-docks" role="status" aria-live="off">
      {tasks.map((task) => (
        <div
          key={task.id}
          className="fc-timer-dock"
          title={`Timing: ${task.notes || task.client || "Task"}`}
        >
          <span className="fc-timer-dock-pulse" aria-hidden="true" />
          <div className="fc-timer-dock-what">
            <strong>{task.notes || task.client || "Task"}</strong>
            {task.client && task.notes ? <span>{task.client}</span> : null}
          </div>
          <span className="fc-timer-dock-clock">
            {formatTracked(trackedSeconds(task, nowMs), true)}
          </span>
          <button
            type="button"
            className="fc-timer-dock-stop"
            disabled={busyId === task.id}
            aria-label={`Stop the timer on ${task.notes || task.client || "this task"}`}
            title="Stop the timer"
            onClick={() => void stop(task)}
          />
        </div>
      ))}
    </div>
  );
}
