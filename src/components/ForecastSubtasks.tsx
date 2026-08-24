"use client";

import { useState } from "react";

export type ForecastSubtaskRow = {
  id: string;
  notes: string;
  completed: number;
};

function noticeFromBasecamp(json: {
  basecamp?: {
    synced?: boolean;
    skipped?: boolean;
    error?: string;
    needsBasecamp?: boolean;
  };
} | null): string {
  const bc = json?.basecamp;
  if (!bc || bc.synced) return "";
  if (bc.skipped) {
    return "Saved here, but this row isn't linked to a Basecamp to-do, so nothing was added there.";
  }
  if (bc.needsBasecamp) {
    return "Saved here, but connect your Basecamp account so this shows as a subtask on the todo.";
  }
  return `Saved here, but Basecamp didn't get the subtask${
    bc.error ? `: ${bc.error}` : "."
  }`;
}

export function ForecastSubtaskButton({
  open,
  onClick,
}: {
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`fc-subtask-btn ${open ? "is-open" : ""}`}
      aria-expanded={open}
      title="Add a subtask"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      Subtask
    </button>
  );
}

export function ForecastSubtasks({
  person,
  taskId,
  subtasks,
  compact,
  adding,
  onAddingChange,
  hideTrigger,
  onChanged,
  onNotice,
}: {
  person: string;
  taskId: string;
  subtasks: ForecastSubtaskRow[];
  compact?: boolean;
  adding?: boolean;
  onAddingChange?: (open: boolean) => void;
  hideTrigger?: boolean;
  onChanged: () => void;
  onNotice?: (message: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [openUncontrolled, setOpenUncontrolled] = useState(!compact);

  const open = adding ?? openUncontrolled;

  function setOpen(next: boolean) {
    onAddingChange?.(next);
    if (adding === undefined) setOpenUncontrolled(next);
  }

  function report(json: Parameters<typeof noticeFromBasecamp>[0]) {
    onNotice?.(noticeFromBasecamp(json));
  }

  async function add() {
    const notes = draft.trim();
    if (!notes || busy) return;
    setBusy(true);
    const res = await fetch(`/api/forecast/${person}/${taskId}/subtasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes, completed: false }),
    });
    setBusy(false);
    if (!res.ok) return;
    report(await res.json().catch(() => null));
    setDraft("");
    onChanged();
  }

  async function patch(id: string, body: { notes?: string; completed?: boolean }) {
    const res = await fetch(`/api/forecast/${person}/${taskId}/subtasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return;
    report(await res.json().catch(() => null));
    onChanged();
  }

  async function remove(id: string) {
    const res = await fetch(`/api/forecast/${person}/${taskId}/subtasks/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) return;
    report(await res.json().catch(() => null));
    onChanged();
  }

  const showForm = open;
  if (subtasks.length === 0 && !showForm && hideTrigger) return null;

  return (
    <div
      className={`ops-subtasks ${compact ? "is-compact" : ""}`}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {subtasks.map((s) => (
        <div key={s.id} className={`ops-subtask ${s.completed ? "is-done" : ""}`}>
          <input
            type="checkbox"
            checked={!!s.completed}
            onChange={() => void patch(s.id, { completed: !s.completed })}
            aria-label={s.completed ? "Mark subtask incomplete" : "Mark subtask complete"}
          />
          <input
            key={`${s.id}-notes`}
            defaultValue={s.notes}
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (!next || next === s.notes) {
                if (!next) e.target.value = s.notes;
                return;
              }
              void patch(s.id, { notes: next });
            }}
            className="ops-subtask-notes"
          />
          <button
            type="button"
            className="ops-subtask-remove"
            aria-label="Remove subtask"
            title="Remove subtask"
            onClick={() => void remove(s.id)}
          >
            ×
          </button>
        </div>
      ))}

      {showForm ? (
        <div className="ops-subtask is-add">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
              if (e.key === "Escape") {
                setDraft("");
                setOpen(false);
              }
            }}
            placeholder="New subtask"
            className="ops-subtask-notes"
            disabled={busy}
            aria-label="New subtask"
          />
          <button
            type="button"
            className="ops-subtask-add-go"
            disabled={busy || !draft.trim()}
            onClick={() => void add()}
          >
            Add
          </button>
        </div>
      ) : hideTrigger ? null : (
        <button
          type="button"
          className="ops-subtask-trigger"
          onClick={() => setOpen(true)}
        >
          + Subtask
        </button>
      )}
    </div>
  );
}
