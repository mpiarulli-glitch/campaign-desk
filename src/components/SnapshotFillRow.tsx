"use client";

import { useEffect, useState } from "react";
import { SnapshotCatchUp } from "@/components/SnapshotCatchUp";
import {
  CompletedTodoPicker,
  type CompletedTodoOption,
} from "@/components/CompletedTodoPicker";
import { weekLabel } from "@/lib/week";
import { catchUpPeriodLabel } from "@/lib/snapshot-catchup";
import {
  loggedForTargetsOtherPeriod,
  periodStartFor,
} from "@/lib/snapshot-entry-date";
import { snapshotAuthorLabel, teamLabelFor } from "@/lib/people";
import {
  isSnapshotContractMet,
  SNAPSHOT_STATUSES,
  snapshotStatusLabel,
  type SnapshotStatus,
} from "@/lib/snapshot-status";
import {
  categoryTagTone,
  fillPeriodHint,
  inferDeliverableOwnership,
} from "@/lib/snapshot-fill";

export type SnapshotFillSaveState = "saving" | "saved" | "failed";

export type SnapshotFillRowData = {
  deliverable_id: string;
  category: string;
  team: string;
  name: string;
  cadence: string;
  kind: "recurring" | "one_time";
  cadence_unit: "weekly" | "monthly" | "quarterly";
  due_date: string | null;
  period_start: string;
  week_start?: string;
  status: SnapshotStatus;
  work_done: string;
  next_steps: string;
  notes: string;
  logged_by: string;
  updated_at: string;
  basecamp_todo_id: string;
  basecamp_project_id: string;
  basecamp_todo_title: string;
  basecamp_todo_url: string;
  basecamp_todo_completed_at: string;
};

export type SnapshotBasecampTodoPatch = {
  id: string;
  projectId: string;
  title: string;
  url: string;
  completedAt: string;
} | null;

export type SnapshotOverdueDetail = {
  due_date: string;
  kind: "recurring" | "one_time";
  cadence_unit: "weekly" | "monthly" | "quarterly" | null;
  status: SnapshotStatus;
};

function relativeTime(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function overduePeriodLabel(detail: SnapshotOverdueDetail): string {
  if (detail.kind === "one_time" || !detail.cadence_unit) {
    return `due ${fmtDate(detail.due_date)}`;
  }
  return catchUpPeriodLabel(
    detail.cadence_unit,
    periodStartFor(detail.cadence_unit, detail.due_date)
  );
}

function ownershipChip(row: { team: string; category: string; name: string }): string | null {
  const ownership = inferDeliverableOwnership(row);
  if (ownership === "unknown") return null;
  return teamLabelFor(ownership);
}

function todayYmd(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}


type TodoCache = {
  todos: CompletedTodoOption[];
  reason: string | null;
  projectName: string | null;
  clientName: string | null;
  loading: boolean;
};

const todoCache = new Map<string, TodoCache>();
const todoListeners = new Map<string, Set<() => void>>();

function notifyTodoCache(clientId: string) {
  const listeners = todoListeners.get(clientId);
  if (!listeners) return;
  for (const fn of listeners) fn();
}

function loadCompletedTodos(clientId: string) {
  const existing = todoCache.get(clientId);
  if (existing && (existing.loading || existing.todos.length || existing.reason)) {
    return;
  }
  todoCache.set(clientId, {
    todos: existing?.todos || [],
    reason: null,
    projectName: existing?.projectName || null,
    clientName: existing?.clientName || null,
    loading: true,
  });
  notifyTodoCache(clientId);
  fetch(`/api/snapshot/completed-todos?client=${encodeURIComponent(clientId)}`)
    .then(async (res) => {
      if (!res.ok) {
        todoCache.set(clientId, {
          todos: [],
          reason: "failed",
          projectName: null,
          clientName: null,
          loading: false,
        });
        notifyTodoCache(clientId);
        return;
      }
      const data = await res.json();
      const expectedProject =
        typeof data.projectId === "string" ? data.projectId.trim() : "";
      const todos = Array.isArray(data.todos)
        ? (data.todos as CompletedTodoOption[]).filter(
            (t) =>
              t &&
              typeof t.id === "string" &&
              typeof t.title === "string" &&
              // Drop anything that isn't from this client's linked project.
              (!expectedProject || t.projectId === expectedProject)
          )
        : [];
      todoCache.set(clientId, {
        todos,
        reason: typeof data.reason === "string" ? data.reason : null,
        projectName: typeof data.projectName === "string" ? data.projectName : null,
        clientName: typeof data.clientName === "string" ? data.clientName : null,
        loading: false,
      });
      notifyTodoCache(clientId);
    })
    .catch(() => {
      todoCache.set(clientId, {
        todos: [],
        reason: "failed",
        projectName: null,
        clientName: null,
        loading: false,
      });
      notifyTodoCache(clientId);
    });
}

function useCompletedTodos(clientId: string, enabled: boolean): TodoCache {
  const [state, setState] = useState<TodoCache>(
    () =>
      todoCache.get(clientId) || {
        todos: [],
        reason: null,
        projectName: null,
        clientName: null,
        loading: false,
      }
  );

  useEffect(() => {
    if (!enabled || !clientId) return;
    const onChange = () => {
      setState(
        todoCache.get(clientId) || {
          todos: [],
          reason: null,
          projectName: null,
          clientName: null,
          loading: false,
        }
      );
    };
    let listeners = todoListeners.get(clientId);
    if (!listeners) {
      listeners = new Set();
      todoListeners.set(clientId, listeners);
    }
    listeners.add(onChange);
    onChange();
    loadCompletedTodos(clientId);
    return () => {
      listeners?.delete(onChange);
    };
  }, [clientId, enabled]);

  return state;
}

export function SnapshotFillRow({
  row,
  clientId,
  viewWeek,
  loggedFor,
  overdue,
  overdueDetail,
  open,
  saveState,
  onToggle,
  onPatch,
  onLoggedForChange,
  onSave,
  onRetry,
  onCatchUpDone,
  launchDate,
}: {
  row: SnapshotFillRowData;
  clientId: string;
  viewWeek: string;
  loggedFor: string;
  overdue: boolean;
  overdueDetail?: SnapshotOverdueDetail | null;
  open: boolean;
  saveState?: SnapshotFillSaveState;
  onToggle: () => void;
  onPatch: (patch: Partial<SnapshotFillRowData>) => void;
  onLoggedForChange: (loggedFor: string) => void;
  onSave: (
    patch: Partial<SnapshotFillRowData>,
    opts?: { loggedFor?: string; basecampTodo?: SnapshotBasecampTodoPatch }
  ) => void;
  onRetry: () => void;
  onCatchUpDone: () => void;
  launchDate: string | null;
}) {
  const chip = ownershipChip(row);
  const hint = fillPeriodHint({
    kind: row.kind,
    cadence_unit: row.cadence_unit,
    cadence: row.cadence,
    period_start: row.period_start,
    due_date: row.due_date,
  });
  const backdateOther = loggedForTargetsOtherPeriod({
    kind: row.kind,
    cadence_unit: row.cadence_unit,
    viewWeek,
    loggedFor,
  });
  const [catchUpOpen, setCatchUpOpen] = useState(false);
  const [overdueOpen, setOverdueOpen] = useState(false);
  const [askingWhen, setAskingWhen] = useState(false);
  const [whenDate, setWhenDate] = useState(loggedFor);
  const [pendingStatus, setPendingStatus] = useState<SnapshotStatus | null>(null);
  const [overdueNote, setOverdueNote] = useState("");
  const [overdueWhen, setOverdueWhen] = useState("");
  const [overdueBusy, setOverdueBusy] = useState(false);
  const [overdueError, setOverdueError] = useState("");
  const met = isSnapshotContractMet(row.status);
  const author = snapshotAuthorLabel(row.logged_by);
  const today = todayYmd();
  const shownStatus = pendingStatus ?? row.status;
  const todoState = useCompletedTodos(clientId, open);

  function selectCompletedTodo(todo: CompletedTodoOption) {
    // Never attach a to-do from a different Basecamp project than this client.
    if (
      todoState.todos.length &&
      !todoState.todos.some((t) => t.id === todo.id && t.projectId === todo.projectId)
    ) {
      return;
    }
    const linkPatch: Partial<SnapshotFillRowData> = {
      basecamp_todo_id: todo.id,
      basecamp_project_id: todo.projectId,
      basecamp_todo_title: todo.title,
      basecamp_todo_url: todo.url,
      basecamp_todo_completed_at: todo.completedAt || "",
    };
    if (!row.work_done.trim()) {
      linkPatch.work_done = todo.title;
    }
    onPatch(linkPatch);
    onSave(linkPatch, {
      basecampTodo: {
        id: todo.id,
        projectId: todo.projectId,
        title: todo.title,
        url: todo.url,
        completedAt: todo.completedAt || "",
      },
    });
  }

  function clearCompletedTodo() {
    const linkPatch: Partial<SnapshotFillRowData> = {
      basecamp_todo_id: "",
      basecamp_project_id: "",
      basecamp_todo_title: "",
      basecamp_todo_url: "",
      basecamp_todo_completed_at: "",
    };
    onPatch(linkPatch);
    onSave(linkPatch, { basecampTodo: null });
  }

  function startAskWhen() {
    setPendingStatus("completed");
    setWhenDate(loggedFor);
    setAskingWhen(true);
  }

  function confirmDone() {
    const when = whenDate || loggedFor;
    onLoggedForChange(when);
    onPatch({ status: "completed" });
    onSave({ status: "completed" }, { loggedFor: when });
    setPendingStatus(null);
    setAskingWhen(false);
  }

  function cancelAskWhen() {
    setPendingStatus(null);
    setAskingWhen(false);
  }

  async function recordOverdue(status: "completed" | "canceled") {
    if (!overdueDetail) return;
    setOverdueBusy(true);
    setOverdueError("");
    const when = status === "completed" ? overdueWhen || overdueDetail.due_date : overdueDetail.due_date;
    try {
      const res = await fetch("/api/snapshot/entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliverableId: row.deliverable_id,
          weekStart: overdueDetail.due_date,
          loggedFor: when,
          status,
          workDone: status === "completed" ? overdueNote : undefined,
        }),
      });
      if (!res.ok) {
        setOverdueError("Could not save that period.");
        return;
      }
      setOverdueOpen(false);
      setOverdueNote("");
      onCatchUpDone();
    } catch {
      setOverdueError("Network error. Try again.");
    } finally {
      setOverdueBusy(false);
    }
  }

  return (
    <div className={`snap-n-row ${overdue ? "is-overdue" : ""} ${open ? "is-open" : ""} ${met ? "is-met" : ""}`}>
      <div className="snap-n-cols">
        <div className="snap-n-title-wrap">
          <div className="snap-n-title-stack">
            <button type="button" className="snap-n-title" onClick={onToggle}>
              <span className="snap-n-ico" aria-hidden="true">
                <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <path d="M4.5 2.5h5.2L12.5 5.3V13.5h-8v-11z" />
                  <path d="M9.5 2.5V5.5h3" />
                </svg>
              </span>
              <span className="snap-n-name">{row.name}</span>
            </button>
            {author ? (
              <p className="snap-n-meta">
                {author}
                {row.updated_at ? ` · ${relativeTime(row.updated_at)}` : ""}
              </p>
            ) : null}
            {row.basecamp_todo_title.trim() && !open ? (
              <div className="snap-n-todo-linked">
                <p className="snap-n-meta snap-n-todo-meta">
                  Linked: {row.basecamp_todo_title.trim()}
                </p>
                <button
                  type="button"
                  className="link-button snap-todo-unlink"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearCompletedTodo();
                  }}
                >
                  Unlink
                </button>
              </div>
            ) : null}
          </div>
          {overdue ? (
            <button
              type="button"
              className={`snap-desk-overdue ${overdueOpen ? "is-on" : ""}`}
              aria-expanded={overdueOpen}
              onClick={() => {
                setOverdueOpen((v) => !v);
                setOverdueWhen(overdueDetail?.due_date || "");
                setOverdueError("");
              }}
            >
              Overdue
            </button>
          ) : null}
        </div>
        <span className={`snap-n-tag snap-n-tag-${categoryTagTone(row.category || "Other")}`}>
          {row.category.trim() || "Other"}
        </span>
        <select
          className={`snap-n-status status-${shownStatus}`}
          value={shownStatus}
          aria-label="Status"
          onChange={(e) => {
            const status = e.target.value as SnapshotStatus;
            if (status === "completed" && row.status !== "completed") {
              startAskWhen();
              return;
            }
            cancelAskWhen();
            onPatch({ status });
            onSave({ status });
          }}
        >
          {SNAPSHOT_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <span className="snap-n-date">
          {hint}
          {chip ? ` · ${chip}` : ""}
        </span>
        <div className="snap-n-actions" onClick={(e) => e.stopPropagation()}>
          {saveState === "saving" ? (
            <span className="snap-save snap-save-busy">Saving…</span>
          ) : saveState === "saved" ? (
            <span className="snap-save snap-save-ok">Saved</span>
          ) : saveState === "failed" ? (
            <span className="snap-save snap-save-bad">
              Not saved
              <button type="button" className="link-button" onClick={onRetry}>Retry</button>
            </span>
          ) : null}
          {row.kind === "recurring" ? (
            <button
              type="button"
              className={`snap-catchup-toggle ${catchUpOpen ? "is-on" : ""}`}
              aria-expanded={catchUpOpen}
              onClick={() => setCatchUpOpen((v) => !v)}
            >
              Catch up
            </button>
          ) : null}
        </div>
      </div>
      {askingWhen ? (
        <form
          className="snap-overdue-pop"
          role="dialog"
          aria-label="When this work was completed"
          onSubmit={(e) => {
            e.preventDefault();
            confirmDone();
          }}
        >
          <strong>When was this completed?</strong>
          <p>Status stays Completed. Pick the date the work actually happened.</p>
          <label>
            <span>Date</span>
            <input
              type="date"
              value={whenDate}
              min={launchDate || undefined}
              max={today}
              autoFocus
              required
              aria-label="When this work happened"
              onChange={(e) => setWhenDate(e.target.value)}
            />
          </label>
          <div className="snap-overdue-actions">
            <button type="submit" className="snap-done-btn">
              Save date
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={cancelAskWhen}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {backdateOther ? (
        <p className="snap-backdate-hint">
          Saves to the period containing {loggedFor}, not the week on screen.
        </p>
      ) : null}
      {overdueOpen && overdueDetail ? (
        <div className="snap-overdue-pop" role="dialog" aria-label="Overdue period">
          <strong>{overduePeriodLabel(overdueDetail)} is overdue</strong>
          <p>
            This is the last closed {overdueDetail.kind === "one_time" ? "deadline" : overdueDetail.cadence_unit || "period"}
            , due {fmtDate(overdueDetail.due_date)}. It is not the period in the Status column
            {overdueDetail.status !== "not_started"
              ? ` · last logged as ${snapshotStatusLabel(overdueDetail.status)}`
              : " · nothing was logged"}
            .
          </p>
          <label>
            <span>If it was done, when?</span>
            <input
              type="date"
              value={overdueWhen}
              min={launchDate || undefined}
              max={today}
              aria-label="When the overdue work happened"
              onChange={(e) => setOverdueWhen(e.target.value)}
            />
          </label>
          <label>
            <span>What we did (optional)</span>
            <textarea
              value={overdueNote}
              onChange={(e) => setOverdueNote(e.target.value)}
              rows={2}
              placeholder="Leave blank if you only need to close the period"
            />
          </label>
          {overdueError ? <p className="error" style={{ margin: 0 }}>{overdueError}</p> : null}
          <div className="snap-overdue-actions">
            <button
              type="button"
              className="snap-done-btn"
              disabled={overdueBusy}
              onClick={() => void recordOverdue("completed")}
            >
              It was done
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={overdueBusy}
              onClick={() => void recordOverdue("canceled")}
            >
              It was not done
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setOverdueOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      ) : overdueOpen && !overdueDetail ? (
        <p className="snap-backdate-hint">Could not load the missed period. Refresh and try again.</p>
      ) : null}
      {catchUpOpen ? (
        <SnapshotCatchUp
          deliverableId={row.deliverable_id}
          kind={row.kind}
          cadenceUnit={row.cadence_unit}
          launchDate={launchDate}
          onDone={onCatchUpDone}
        />
      ) : null}
      {open ? (
        <div className="snap-fields">
          {row.week_start && row.week_start !== viewWeek ? (
            <p className="snap-backdate-hint">
              Showing the note from {weekLabel(row.week_start)}. Saving this week
              keeps that week&apos;s note as it is.
            </p>
          ) : null}
          <label className="snap-todo-field">
            <span>Completed Basecamp to-do</span>
            <CompletedTodoPicker
              todos={todoState.todos}
              selectedId={row.basecamp_todo_id}
              selectedTitle={row.basecamp_todo_title}
              selectedUrl={row.basecamp_todo_url}
              loading={todoState.loading}
              reason={todoState.reason}
              projectName={todoState.projectName}
              clientName={todoState.clientName}
              onSelect={selectCompletedTodo}
              onClear={clearCompletedTodo}
            />
          </label>
          <label>
            <span>What we did</span>
            <textarea
              value={row.work_done}
              onChange={(e) => onPatch({ work_done: e.target.value })}
              onBlur={(e) => onSave({ work_done: e.target.value })}
              placeholder="What got done this week — or pick a Basecamp to-do above"
            />
          </label>
          <label>
            <span>Next steps</span>
            <textarea
              value={row.next_steps}
              onChange={(e) => onPatch({ next_steps: e.target.value })}
              onBlur={(e) => onSave({ next_steps: e.target.value })}
              placeholder="What's coming next"
            />
          </label>
          <label>
            <span>Notes</span>
            <textarea
              value={row.notes}
              onChange={(e) => onPatch({ notes: e.target.value })}
              onBlur={(e) => onSave({ notes: e.target.value })}
              placeholder="Anything the client should know"
            />
          </label>
          <label className="snap-logged-for snap-logged-for-field">
            <span>Logged for</span>
            <input
              type="date"
              value={loggedFor}
              aria-label="Logged for date"
              title="When this work actually happened"
              onChange={(e) => onLoggedForChange(e.target.value)}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
