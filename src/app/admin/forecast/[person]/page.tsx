"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Brand } from "@/components/Brand";
import { NavMenu } from "@/components/NavMenu";
import { addWeeks, currentWeek, isCurrentWeek, weekLabel } from "@/lib/week";

type Priority = "urgent" | "important" | "flexible";

type Task = {
  id: string;
  person: string;
  task_date: string;
  client: string;
  notes: string;
  hours: number;
  completed: number;
  priority: Priority;
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

const PRIORITIES: Priority[] = ["urgent", "important", "flexible"];
const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: "Urgent — can't be moved",
  important: "Important — move only if truly needed",
  flexible: "Flexible — reschedulable, still needs doing",
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

function dayName(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long" });
}
function dayShortDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const emptyDraft = { client: "", notes: "", hours: "" };

function PriorityPicker({
  value,
  onChange,
}: {
  value: Priority;
  onChange: (p: Priority) => void;
}) {
  return (
    <div className="priority-picker">
      {PRIORITIES.map((p) => (
        <button
          key={p}
          type="button"
          className={`priority-dot ${p} ${value === p ? "is-on" : ""}`}
          title={PRIORITY_LABEL[p]}
          aria-label={PRIORITY_LABEL[p]}
          onClick={() => onChange(p)}
        />
      ))}
    </div>
  );
}

type View = "list" | "week";

export default function PersonForecastPage() {
  const router = useRouter();
  const { person } = useParams<{ person: string }>();
  const searchParams = useSearchParams();

  const [week, setWeek] = useState(searchParams.get("week") || currentWeek());
  const [view, setView] = useState<View>("list");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { client: string; notes: string; hours: string }>>({});
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [role, setRole] = useState<"admin" | "forecast" | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);

  function draftFor(date: string) {
    return drafts[date] || emptyDraft;
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
    setDrafts((d) => ({ ...d, [date]: emptyDraft }));
    setAddingFor(null);
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

  async function setPriority(task: Task, priority: Priority) {
    if (priority === task.priority) return;
    const res = await fetch(`/api/forecast/${person}/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority }),
    });
    if (!res.ok) setError("Could not update priority.");
    load(week, { silent: true });
  }

  return (
    <div className="ops-scope">
      <header className="topbar">
        <Brand href="/admin" />
        <div className="row" style={{ gap: 10 }}>
          {role === "admin" ? (
            <Link className="btn btn-ghost btn-sm" href="/admin/forecast">All forecasts</Link>
          ) : null}
          <NavMenu current="/admin/forecast" />
        </div>
      </header>

      <div className="ops-page">
        <div className="ops-page-head">
          <div>
            <p className="ops-eyebrow">Weekly forecast</p>
            <h1 className="ops-title">{data?.label || person}</h1>
            <p className="ops-sub">Add what you expect to work on each day this week.</p>
          </div>
          <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
            <div className="view-toggle">
              <button className={`view-toggle-btn ${view === "list" ? "is-on" : ""}`} onClick={() => setView("list")}>
                List
              </button>
              <button className={`view-toggle-btn ${view === "week" ? "is-on" : ""}`} onClick={() => setView("week")}>
                Week
              </button>
            </div>
            <div className="ops-weeknav">
              <button onClick={() => setWeek((w) => addWeeks(w, -1))} aria-label="Previous week">‹</button>
              <strong>{weekLabel(week)}</strong>
              <button onClick={() => setWeek((w) => addWeeks(w, 1))} aria-label="Next week">›</button>
              {!isCurrentWeek(week) ? (
                <button
                  style={{ width: "auto", padding: "0 10px", fontSize: 12, fontWeight: 600 }}
                  onClick={() => setWeek(currentWeek())}
                >
                  This week
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {error ? <p className="error" style={{ marginBottom: 16 }}>{error}</p> : null}

        {loading ? (
          <p className="muted">Loading...</p>
        ) : view === "week" ? (
          <div className="ops-planner">
            {days.map((date) => {
              const tasks = tasksByDay.get(date) || [];
              const dayHours = tasks.reduce((sum, t) => sum + t.hours, 0);
              const draft = draftFor(date);
              const isAdding = addingFor === date;
              return (
                <div key={date} className="ops-day-col">
                  <div className="ops-day-head">
                    <div>
                      <div className="ops-day-name">{dayName(date)}</div>
                      <div className="ops-day-date">{dayShortDate(date)}</div>
                    </div>
                    <span className="ops-day-hours">{dayHours ? `${dayHours}h` : "—"}</span>
                  </div>

                  <div className="ops-day-tasks">
                    {tasks.map((t) => (
                      <div key={t.id} className={`ops-task-chip pri-${t.priority} ${t.completed ? "is-done" : ""}`}>
                        <input
                          type="checkbox"
                          className="done-check"
                          checked={!!t.completed}
                          onChange={() => toggleCompleted(t)}
                          aria-label="Mark complete"
                        />
                        <input
                          key={`${t.id}-client`}
                          defaultValue={t.client}
                          onBlur={(e) => saveField(t, "client", e.target.value)}
                          placeholder="Client"
                          className="client"
                          style={{ paddingLeft: 18 }}
                        />
                        <input
                          key={`${t.id}-notes`}
                          defaultValue={t.notes}
                          onBlur={(e) => saveField(t, "notes", e.target.value)}
                          placeholder="Task notes"
                          className="notes"
                          style={{ paddingLeft: 18 }}
                        />
                        <input
                          key={`${t.id}-hours`}
                          defaultValue={t.hours}
                          onBlur={(e) => saveField(t, "hours", e.target.value)}
                          type="number"
                          min="0"
                          step="0.5"
                          className="hrs"
                        />
                        <div style={{ marginTop: 6, paddingLeft: 18 }}>
                          <PriorityPicker value={t.priority} onChange={(p) => setPriority(t, p)} />
                        </div>
                        <button className="remove" onClick={() => removeTask(t.id)}>Remove</button>
                      </div>
                    ))}
                  </div>

                  <div className="ops-day-add">
                    {isAdding ? (
                      <div className="ops-day-add-form">
                        <input
                          autoFocus
                          value={draft.client}
                          onChange={(e) => setDraft(date, { client: e.target.value })}
                          placeholder="Client"
                        />
                        <input
                          value={draft.notes}
                          onChange={(e) => setDraft(date, { notes: e.target.value })}
                          placeholder="Task notes"
                        />
                        <div className="row" style={{ gap: 6 }}>
                          <input
                            value={draft.hours}
                            onChange={(e) => setDraft(date, { hours: e.target.value })}
                            placeholder="Hours"
                            type="number"
                            min="0"
                            step="0.5"
                            style={{ flex: 1 }}
                          />
                          <button className="btn btn-sm" onClick={() => addTask(date)}>Add</button>
                        </div>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => setAddingFor(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button className="ops-add-trigger" onClick={() => setAddingFor(date)}>
                        + Add task
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div>
            {days.map((date) => {
              const tasks = tasksByDay.get(date) || [];
              const dayHours = tasks.reduce((sum, t) => sum + t.hours, 0);
              const draft = draftFor(date);
              return (
                <div key={date} className="ops-list-day">
                  <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                    <strong>{dayName(date)} <span className="muted" style={{ fontWeight: 400 }}>{dayShortDate(date)}</span></strong>
                    <span className="muted">{dayHours || 0}h</span>
                  </div>

                  {tasks.length === 0 ? (
                    <p className="muted" style={{ margin: "0 0 10px", fontSize: 13 }}>Nothing forecasted yet.</p>
                  ) : (
                    tasks.map((t) => (
                      <div key={t.id} className={`ops-list-row pri-${t.priority}`}>
                        <input
                          type="checkbox"
                          checked={!!t.completed}
                          onChange={() => toggleCompleted(t)}
                          aria-label="Mark complete"
                        />
                        <input
                          key={`${t.id}-client`}
                          defaultValue={t.client}
                          onBlur={(e) => saveField(t, "client", e.target.value)}
                          placeholder="Client"
                          className="client"
                          style={{
                            textDecoration: t.completed ? "line-through" : "none",
                            opacity: t.completed ? 0.6 : 1,
                          }}
                        />
                        <input
                          key={`${t.id}-notes`}
                          defaultValue={t.notes}
                          onBlur={(e) => saveField(t, "notes", e.target.value)}
                          placeholder="Task notes"
                          className="notes"
                          style={{
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
                            className="hrs"
                          />
                          <span className="muted">h</span>
                        </div>
                        <PriorityPicker value={t.priority} onChange={(p) => setPriority(t, p)} />
                        <button className="btn btn-ghost btn-sm" onClick={() => removeTask(t.id)}>
                          Remove
                        </button>
                      </div>
                    ))
                  )}

                  <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}>
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
          <label className="field" style={{ marginTop: 18 }}>
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

        {data ? (
          <div className="ops-week-total">
            <strong>Week total</strong>
            <span>
              {data.hours}h / {data.capacity}h ·{" "}
              <strong style={{ color: allocationColor(data.allocationPct) }}>
                {data.allocationPct}% allocated
              </strong>
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
