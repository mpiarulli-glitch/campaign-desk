"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Brand } from "@/components/Brand";
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

export default function PersonForecastPage() {
  const router = useRouter();
  const { person } = useParams<{ person: string }>();
  const searchParams = useSearchParams();

  const [week, setWeek] = useState(searchParams.get("week") || currentWeek());
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { client: string; notes: string; hours: string }>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ client: "", notes: "", hours: "" });

  function draftFor(date: string) {
    return drafts[date] || { client: "", notes: "", hours: "" };
  }
  function setDraft(date: string, patch: Partial<{ client: string; notes: string; hours: string }>) {
    setDrafts((d) => ({ ...d, [date]: { ...draftFor(date), ...patch } }));
  }

  function startEdit(task: Task) {
    setEditingId(task.id);
    setEditDraft({ client: task.client, notes: task.notes, hours: String(task.hours) });
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function load(w: string) {
    setLoading(true);
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
    setData(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    load(week);
    router.replace(`/admin/forecast/${person}?week=${week}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, person]);

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
    load(week);
  }

  async function removeTask(id: string) {
    const res = await fetch(`/api/forecast/${person}/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("Could not remove that task.");
      return;
    }
    load(week);
  }

  async function saveEdit(id: string) {
    const hours = Number(editDraft.hours);
    if (!editDraft.client.trim()) {
      setError("Add a client for that task.");
      return;
    }
    if (!Number.isFinite(hours) || hours <= 0) {
      setError("Enter how many hours that task should take.");
      return;
    }
    setError("");
    const res = await fetch(`/api/forecast/${person}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client: editDraft.client, notes: editDraft.notes, hours }),
    });
    if (!res.ok) {
      setError("Could not save that task.");
      return;
    }
    setEditingId(null);
    load(week);
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
    load(week);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand href="/admin" />
        <div className="row">
          <Link className="btn btn-ghost btn-sm" href="/admin/forecast">All forecasts</Link>
        </div>
      </header>

      <main className="container stack">
        <div className="page-hero">
          <p className="eyebrow">Weekly forecast</p>
          <h1 className="h1">{data?.label || person}</h1>
          <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
            Add what you expect to work on each day this week: the client, a note
            on the task, and how many hours it should take.
          </p>
        </div>

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
                      {tasks.map((t) =>
                        editingId === t.id ? (
                          <div
                            key={t.id}
                            className="row"
                            style={{ gap: 8, flexWrap: "wrap", borderBottom: "1px solid var(--border)", paddingBottom: 6 }}
                          >
                            <input
                              value={editDraft.client}
                              onChange={(e) => setEditDraft((d) => ({ ...d, client: e.target.value }))}
                              placeholder="Client"
                              style={{ flex: "1 1 160px" }}
                            />
                            <input
                              value={editDraft.notes}
                              onChange={(e) => setEditDraft((d) => ({ ...d, notes: e.target.value }))}
                              placeholder="Task notes"
                              style={{ flex: "2 1 240px" }}
                            />
                            <input
                              value={editDraft.hours}
                              onChange={(e) => setEditDraft((d) => ({ ...d, hours: e.target.value }))}
                              placeholder="Hours"
                              type="number"
                              min="0"
                              step="0.5"
                              style={{ width: 90 }}
                            />
                            <button className="btn btn-sm" onClick={() => saveEdit(t.id)}>Save</button>
                            <button className="btn btn-ghost btn-sm" onClick={cancelEdit}>Cancel</button>
                          </div>
                        ) : (
                          <div
                            key={t.id}
                            className="row"
                            style={{ justifyContent: "space-between", gap: 12, borderBottom: "1px solid var(--border)", paddingBottom: 6 }}
                          >
                            <label className="row" style={{ gap: 8, cursor: "pointer" }}>
                              <input
                                type="checkbox"
                                checked={!!t.completed}
                                onChange={() => toggleCompleted(t)}
                              />
                              <div style={{ textDecoration: t.completed ? "line-through" : "none", opacity: t.completed ? 0.6 : 1 }}>
                                <strong>{t.client}</strong>
                                {t.notes ? <span className="muted"> — {t.notes}</span> : null}
                              </div>
                            </label>
                            <div className="row" style={{ gap: 10 }}>
                              <span className="muted">{t.hours}h</span>
                              <button className="btn btn-ghost btn-sm" onClick={() => startEdit(t)}>
                                Edit
                              </button>
                              <button className="btn btn-ghost btn-sm" onClick={() => removeTask(t.id)}>
                                Remove
                              </button>
                            </div>
                          </div>
                        )
                      )}
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
