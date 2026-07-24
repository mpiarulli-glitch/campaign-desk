"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Priority = "urgent" | "important" | "flexible";
type Status = "open" | "done";

export type Todo = {
  id: string;
  title: string;
  notes: string;
  client_id: string | null;
  assignee: string;
  tags: string[];
  due_date: string | null;
  status: Status;
  priority: Priority;
  source: string;
};

type Member = { slug: string; label: string };
type ClientOpt = { id: string; name: string };

const PRIORITIES: Priority[] = ["urgent", "important", "flexible"];
const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: "Urgent",
  important: "Important",
  flexible: "Flexible",
};

function fmtDue(ymd: string | null): { text: string; overdue: boolean } | null {
  if (!ymd) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const due = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
  const text =
    diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : diff === -1 ? "Yesterday"
    : diff < 0 ? `${-diff}d overdue`
    : due.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return { text, overdue: diff < 0 };
}

// Reusable todo list, used both on the team-wide page (showClient) and inside a
// client hub (clientId fixed, client picker hidden). Polls nothing — refetches
// on mutation only, since todos aren't a live feed.
export function TodoList({
  clientId = null,
  showClient = false,
  title = "To-dos",
}: {
  clientId?: string | null;
  showClient?: boolean;
  title?: string;
}) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [team, setTeam] = useState<Member[]>([]);
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const [filterAssignee, setFilterAssignee] = useState("");

  const [draft, setDraft] = useState({
    title: "",
    assignee: "",
    clientId: clientId || "",
    dueDate: "",
    priority: "flexible" as Priority,
    tags: [] as string[],
  });
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const scope = clientId ? `?client_id=${clientId}` : showClient ? "" : "?client_id=none";
    const res = await fetch(`/api/todos${scope}`);
    if (res.ok) setTodos((await res.json()).todos || []);
    setLoading(false);
  }, [clientId, showClient]);

  useEffect(() => {
    load();
    fetch("/api/team")
      .then((r) => (r.ok ? r.json() : { team: [] }))
      .then((d) => setTeam(d.team || []));
    if (showClient) {
      fetch("/api/revenue/clients")
        .then((r) => (r.ok ? r.json() : { clients: [] }))
        .then((d) => setClients((d.clients || []).map((c: ClientOpt) => ({ id: c.id, name: c.name }))));
    }
  }, [load, showClient]);

  const label = useCallback(
    (slug: string) => team.find((m) => m.slug === slug)?.label || slug,
    [team]
  );
  const clientName = useCallback(
    (id: string | null) => (id ? clients.find((c) => c.id === id)?.name || "" : ""),
    [clients]
  );

  async function add() {
    const t = draft.title.trim();
    if (!t) return;
    setAdding(true);
    await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: t,
        assignee: draft.assignee,
        clientId: clientId || draft.clientId || null,
        dueDate: draft.dueDate || null,
        priority: draft.priority,
        tags: draft.tags,
      }),
    });
    setDraft({ title: "", assignee: "", clientId: clientId || "", dueDate: "", priority: "flexible", tags: [] });
    setAdding(false);
    load();
  }

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/todos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    load();
  }

  async function remove(id: string) {
    await fetch(`/api/todos/${id}`, { method: "DELETE" });
    load();
  }

  const visible = useMemo(() => {
    let rows = todos;
    if (!showDone) rows = rows.filter((t) => t.status === "open");
    if (filterAssignee) rows = rows.filter((t) => t.assignee === filterAssignee || t.tags.includes(filterAssignee));
    return rows;
  }, [todos, showDone, filterAssignee]);

  const openCount = todos.filter((t) => t.status === "open").length;

  return (
    <div className="todo-list">
      <div className="todo-head">
        <h2>{title} {openCount > 0 ? <span className="todo-count">{openCount}</span> : null}</h2>
        <div className="row" style={{ gap: 8 }}>
          {showClient ? (
            <select value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)} className="todo-mini-select">
              <option value="">Everyone</option>
              {team.map((m) => (
                <option key={m.slug} value={m.slug}>{m.label}</option>
              ))}
            </select>
          ) : null}
          <button className="btn btn-ghost btn-sm" onClick={() => setShowDone((v) => !v)}>
            {showDone ? "Hide done" : "Show done"}
          </button>
        </div>
      </div>

      <div className="todo-add">
        <input
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          placeholder="Add a to-do and press Enter…"
          className="todo-add-title"
        />
        <select value={draft.assignee} onChange={(e) => setDraft((d) => ({ ...d, assignee: e.target.value }))}>
          <option value="">Unassigned</option>
          {team.map((m) => (
            <option key={m.slug} value={m.slug}>{m.label}</option>
          ))}
        </select>
        {showClient ? (
          <select value={draft.clientId} onChange={(e) => setDraft((d) => ({ ...d, clientId: e.target.value }))}>
            <option value="">Team-wide</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        ) : null}
        <select value={draft.priority} onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value as Priority }))}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
          ))}
        </select>
        <input
          type="date"
          value={draft.dueDate}
          onChange={(e) => setDraft((d) => ({ ...d, dueDate: e.target.value }))}
        />
        <button className="btn btn-sm" disabled={adding || !draft.title.trim()} onClick={add}>Add</button>
      </div>

      {loading ? (
        <p className="muted" style={{ padding: "8px 0" }}>Loading…</p>
      ) : visible.length === 0 ? (
        <p className="muted todo-empty">{showDone ? "No to-dos yet." : "Nothing open. Nice."}</p>
      ) : (
        <div className="todo-rows">
          {visible.map((t) => {
            const due = fmtDue(t.due_date);
            return (
              <div key={t.id} className={`todo-row pri-${t.priority} ${t.status === "done" ? "is-done" : ""}`}>
                <input
                  type="checkbox"
                  checked={t.status === "done"}
                  onChange={() => patch(t.id, { status: t.status === "done" ? "open" : "done" })}
                  aria-label="Mark done"
                />
                <div className="todo-body">
                  <span className="todo-title">{t.title}</span>
                  <div className="todo-meta">
                    {t.assignee ? <span className="todo-chip todo-who">{label(t.assignee)}</span> : <span className="todo-chip todo-unassigned">Unassigned</span>}
                    {t.tags.map((tg) => (
                      <span key={tg} className="todo-chip todo-tag">@{label(tg)}</span>
                    ))}
                    {showClient && t.client_id ? <span className="todo-chip todo-client">{clientName(t.client_id)}</span> : null}
                    {due ? <span className={`todo-chip todo-due ${due.overdue ? "is-overdue" : ""}`}>{due.text}</span> : null}
                  </div>
                </div>
                <div className="todo-actions">
                  <select
                    value={t.assignee}
                    onChange={(e) => patch(t.id, { assignee: e.target.value })}
                    title="Assign"
                    className="todo-assign-select"
                  >
                    <option value="">— </option>
                    {team.map((m) => (
                      <option key={m.slug} value={m.slug}>{m.label}</option>
                    ))}
                  </select>
                  <button className="todo-del" onClick={() => remove(t.id)} title="Delete" aria-label="Delete">✕</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
