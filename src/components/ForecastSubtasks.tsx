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
  if (!bc || bc.synced || bc.skipped) return "";
  if (bc.needsBasecamp) {
    return "Saved here, but connect your Basecamp account so this shows as a subtask on the todo.";
  }
  return `Saved here, but Basecamp didn't get the subtask${
    bc.error ? `: ${bc.error}` : "."
  }`;
}

export function ForecastSubtasks({
  person,
  taskId,
  subtasks,
  compact,
  onChanged,
  onNotice,
}: {
  person: string;
  taskId: string;
  subtasks: ForecastSubtaskRow[];
  compact?: boolean;
  onChanged: () => void;
  onNotice?: (message: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(!compact);

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
      body: JSON.stringify({ notes, completed: true }),
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

  const showForm = open || subtasks.length > 0;

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
            aria-label={s.completed ? "Mark step incomplete" : "Mark step complete"}
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
            aria-label="Remove step"
            title="Remove step"
            onClick={() => void remove(s.id)}
          >
            ×
          </button>
        </div>
      ))}

      {showForm ? (
        <div className="ops-subtask is-add">
          <span className="ops-subtask-mark" aria-hidden>
            ✓
          </span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
              if (e.key === "Escape") {
                setDraft("");
                if (compact && subtasks.length === 0) setOpen(false);
              }
            }}
            placeholder="What did you finish? e.g. Built the welcome-series popup"
            className="ops-subtask-notes"
            disabled={busy}
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
      ) : (
        <button
          type="button"
          className="ops-subtask-trigger"
          onClick={() => setOpen(true)}
        >
          + Step
        </button>
      )}
    </div>
  );
}
