"use client";

import { useCallback, useEffect, useState } from "react";
import { Avatar } from "./Avatar";
import { avatarFor } from "@/lib/team";

type Priority = "urgent" | "important" | "flexible";
type Todo = {
  id: string;
  title: string;
  assignee: string;
  due_date: string | null;
  status: "open" | "done";
  priority: Priority;
};
type Member = { slug: string; label: string };

function fmtDue(ymd: string | null): { text: string; overdue: boolean } | null {
  if (!ymd) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const due = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
  const text =
    diff === 0 ? "Today" : diff === 1 ? "Tomorrow"
    : diff < 0 ? `${-diff}d overdue`
    : due.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return { text, overdue: diff < 0 };
}

// Internal (non-client) to-dos, with a dedicated list per team member plus an
// Unassigned bucket. Each person's list has its own quick-add that pre-fills
// the assignee. Reads/writes the shared /api/todos with client_id = none.
export function TeamTodos() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [team, setTeam] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/todos?client_id=none");
    if (res.ok) setTodos((await res.json()).todos || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    fetch("/api/team")
      .then((r) => (r.ok ? r.json() : { team: [] }))
      .then((d) => setTeam(d.team || []));
  }, [load]);

  async function add(assignee: string) {
    const key = assignee || "__none__";
    const title = (drafts[key] || "").trim();
    if (!title) return;
    await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, assignee, clientId: null }),
    });
    setDrafts((d) => ({ ...d, [key]: "" }));
    load();
  }
  async function toggle(t: Todo) {
    await fetch(`/api/todos/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: t.status === "done" ? "open" : "done" }),
    });
    load();
  }
  async function remove(id: string) {
    await fetch(`/api/todos/${id}`, { method: "DELETE" });
    load();
  }

  const buckets: { slug: string; label: string }[] = [
    ...team.map((m) => ({ slug: m.slug, label: m.label })),
    { slug: "", label: "Unassigned" },
  ];

  function listFor(slug: string) {
    return todos.filter(
      (t) => t.assignee === slug && (showDone || t.status === "open")
    );
  }
  function openCount(slug: string) {
    return todos.filter((t) => t.assignee === slug && t.status === "open").length;
  }

  if (loading) return <p className="muted">Loading…</p>;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Internal team tasks, not client work. Each person has their own list.</p>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowDone((v) => !v)}>
          {showDone ? "Hide done" : "Show done"}
        </button>
      </div>

      <div className="team-todo-grid">
        {buckets.map((b) => {
          const rows = listFor(b.slug);
          const key = b.slug || "__none__";
          return (
            <div key={key} className="team-todo-col">
              <div className="team-todo-head">
                <Avatar label={b.label} src={b.slug ? avatarFor(b.slug) : null} size={22} />
                <span className="team-todo-name">{b.label}</span>
                {openCount(b.slug) > 0 ? <span className="todo-count">{openCount(b.slug)}</span> : null}
              </div>

              <div className="team-todo-rows">
                {rows.length === 0 ? (
                  <p className="muted team-todo-empty">Nothing open.</p>
                ) : (
                  rows.map((t) => {
                    const due = fmtDue(t.due_date);
                    return (
                      <div key={t.id} className={`team-todo-row pri-${t.priority} ${t.status === "done" ? "is-done" : ""}`}>
                        <input type="checkbox" checked={t.status === "done"} onChange={() => toggle(t)} aria-label="Done" />
                        <span className="team-todo-title">{t.title}</span>
                        {due ? <span className={`todo-chip todo-due ${due.overdue ? "is-overdue" : ""}`}>{due.text}</span> : null}
                        <button className="todo-del" onClick={() => remove(t.id)} aria-label="Delete">✕</button>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="team-todo-add">
                <input
                  value={drafts[key] || ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") add(b.slug); }}
                  placeholder="Add a task…"
                />
                <button className="btn btn-sm" onClick={() => add(b.slug)}>Add</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
