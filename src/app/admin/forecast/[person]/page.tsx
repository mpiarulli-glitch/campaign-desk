"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Brand } from "@/components/Brand";
import { NavMenu } from "@/components/NavMenu";
import { addWeeks, currentWeek, isCurrentWeek, weekLabel } from "@/lib/week";

type Task = {
  id: string;
  person: string;
  task_date: string;
  client: string;
  notes: string;
  hours: number;
  completed: number;
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

function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function shortDow(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short" });
}

export default function PersonForecastPage() {
  const router = useRouter();
  const { person } = useParams<{ person: string }>();
  const searchParams = useSearchParams();

  const [week, setWeek] = useState(searchParams.get("week") || currentWeek());
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { client: string; notes: string; hours: string }>>({});
  const [role, setRole] = useState<"admin" | "forecast" | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);

  function draftFor(date: string) {
    return drafts[date] || { client: "", notes: "", hours: "" };
  }
  function setDraft(date: string, patch: Partial<{ client: string; notes: string; hours: string }>) {
    setDrafts((d) => ({ ...d, [date]: { ...draftFor(date), ...patch } }));
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

  const days = useMemo(() => weekdays(week), [week]);
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
      setError("Add a client for that task.");
      return;
    }
    if (!Number.isFinite(hours) || hours <= 0) {
      setError("Enter how many hours that task should take.");
      return;
    }
    setError("");
    const res = await fetch(`/api/forecast/${person}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskDate: date, client: draft.client, notes: draft.notes, hours }),
    });
    if (!res.ok) {
      setError("Could not add that task.");
      return;
    }
    setDrafts((d) => ({ ...d, [date]: { client: "", notes: "", hours: "" } }));
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
    load(week, { silent: true });
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand href="/admin" />
        <div className="row">
          {role === "admin" ? (
            <Link className="btn btn-ghost btn-sm" href="/admin/forecast">All forecasts</Link>
          ) : null}
          <NavMenu current="/admin/forecast" />
        </div>
      </header>

      <section className="snap-hero">
        <div className="snap-hero-inner">
          <p className="snap-hero-eyebrow">Weekly forecast</p>
          <h1 className="snap-hero-title">{data?.label || person}</h1>
          <p className="snap-hero-sub">
            Add what you expect to work on each day this week: the client, a note
            on the task, and how many hours it should take.
          </p>
        </div>
      </section>

      <main className="container stack">
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setWeek((w) => addWeeks(w, -1))}>
            ← Prev
          </button>
          <strong>{weekLabel(week)}</strong>
          {!isCurrentWeek(week) ? (
            <button className="btn btn-ghost btn-sm" onClick={() => setWeek(currentWeek())}>
              This week
            </button>
          ) : null}
          <button className="btn btn-ghost btn-sm" onClick={() => setWeek((w) => addWeeks(w, 1))}>
            Next →
          </button>
        </div>

        {error ? <p className="error">{error}</p> : null}

        {data && days.length ? (
          <div className="card card-pad week-glance">
            {days.map((date) => {
              const dayHours = (tasksByDay.get(date) || []).reduce((sum, t) => sum + t.hours, 0);
              const perDayCapacity = data.capacity / days.length || 8;
              const pct = Math.min(100, (dayHours / (perDayCapacity * 1.25)) * 100);
              return (
                <div key={date} className="week-glance-col">
                  <div className="week-glance-bar-wrap">
                    <div
                      className="week-glance-bar"
                      style={{
                        height: `${Math.max(4, pct)}%`,
                        background: dayHours > perDayCapacity ? "var(--warning)" : "var(--accent)",
                      }}
                    />
                  </div>
                  <span className="week-glance-hours">{dayHours || "—"}{dayHours ? "h" : ""}</span>
                  <span className="week-glance-day">{shortDow(date)}</span>
                </div>
              );
            })}
          </div>
        ) : null}

        {data ? (
          <label className="field">
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

        {loading ? (
          <p className="muted">Loading...</p>
        ) : (
          <div className="stack">
            {days.map((date) => {
              const tasks = tasksByDay.get(date) || [];
              const dayHours = tasks.reduce((sum, t) => sum + t.hours, 0);
              const draft = draftFor(date);
              return (
                <div key={date} className="card card-pad stack">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <strong>{dayLabel(date)}</strong>
                    <span className="muted">{dayHours}h</span>
                  </div>

                  {tasks.length === 0 ? (
                    <p className="muted" style={{ margin: 0, fontSize: 13 }}>Nothing forecasted yet.</p>
                  ) : (
                    <div className="stack" style={{ gap: 6 }}>
                      {tasks.map((t) => (
                        <div
                          key={t.id}
                          className="row"
                          style={{ gap: 8, flexWrap: "wrap", alignItems: "center", borderBottom: "1px solid var(--border)", paddingBottom: 6 }}
                        >
                          <input
                            type="checkbox"
                            checked={!!t.completed}
                            onChange={() => toggleCompleted(t)}
                          />
                          <input
                            key={`${t.id}-client`}
                            defaultValue={t.client}
                            onBlur={(e) => saveField(t, "client", e.target.value)}
                            placeholder="Client"
                            className="input-inline"
                            style={{
                              flex: "1 1 160px",
                              fontWeight: 600,
                              textDecoration: t.completed ? "line-through" : "none",
                              opacity: t.completed ? 0.6 : 1,
                            }}
                          />
                          <input
                            key={`${t.id}-notes`}
                            defaultValue={t.notes}
                            onBlur={(e) => saveField(t, "notes", e.target.value)}
                            placeholder="Task notes"
                            className="input-inline"
                            style={{
                              flex: "2 1 240px",
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
                              className="input-inline input-hours"
                              style={{ width: 32, padding: "3px 0 3px 5px", textAlign: "right" }}
                            />
                            <span className="muted">h</span>
                          </div>
                          <button className="btn btn-ghost btn-sm" onClick={() => removeTask(t.id)}>
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <input
                      value={draft.client}
                      onChange={(e) => setDraft(date, { client: e.target.value })}
                      placeholder="Client"
                      style={{ flex: "1 1 160px" }}
                    />
                    <input
                      value={draft.notes}
                      onChange={(e) => setDraft(date, { notes: e.target.value })}
                      placeholder="Task notes"
                      style={{ flex: "2 1 240px" }}
                    />
                    <input
                      value={draft.hours}
                      onChange={(e) => setDraft(date, { hours: e.target.value })}
                      placeholder="Hours"
                      type="number"
                      min="0"
                      step="0.5"
                      style={{ width: 90 }}
                    />
                    <button className="btn btn-sm" onClick={() => addTask(date)}>Add task</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {data ? (
          <div className="card card-pad row" style={{ justifyContent: "space-between" }}>
            <strong>Week total</strong>
            <span>
              {data.hours}h / {data.capacity}h ·{" "}
              <strong style={{ color: allocationColor(data.allocationPct) }}>
                {data.allocationPct}% allocated
              </strong>
            </span>
          </div>
        ) : null}
      </main>
    </div>
  );
}
