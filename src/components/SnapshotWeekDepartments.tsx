"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SNAPSHOT_DEPARTMENTS,
  type SnapshotDepartmentSlug,
} from "@/lib/snapshot-department-list";

type Note = {
  department: SnapshotDepartmentSlug;
  label: string;
  body: string;
};

/**
 * The six department notes for one client-week. Every section is always on
 * screen here. Empty ones are omitted only on the client snapshot.
 */
export function SnapshotWeekDepartments({
  clientId,
  weekStart,
}: {
  clientId: string;
  weekStart: string;
}) {
  const [notes, setNotes] = useState<Note[]>(
    SNAPSHOT_DEPARTMENTS.map((dept) => ({
      department: dept.slug,
      label: dept.label,
      body: "",
    }))
  );
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, "saving" | "saved" | "failed" | "">>({});
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch(
        `/api/snapshot/departments?clientId=${encodeURIComponent(clientId)}&week=${weekStart}`
      );
      if (!res.ok) {
        setError("Could not load this week's departments.");
        return;
      }
      const data = await res.json();
      const next = (data.departments || []) as Note[];
      if (next.length) {
        setNotes(next);
        setSaved(Object.fromEntries(next.map((note) => [note.department, note.body])));
      }
      setStatus({});
    } catch {
      setError("Network error. Try again.");
    }
  }, [clientId, weekStart]);

  useEffect(() => {
    void load();
  }, [load]);

  function edit(department: SnapshotDepartmentSlug, body: string) {
    setNotes((cur) => cur.map((note) => (note.department === department ? { ...note, body } : note)));
  }

  async function commit(department: SnapshotDepartmentSlug) {
    const note = notes.find((row) => row.department === department);
    if (!note || note.body === (saved[department] ?? "")) return;
    setStatus((cur) => ({ ...cur, [department]: "saving" }));
    setError("");
    try {
      const res = await fetch("/api/snapshot/departments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          weekStart,
          department,
          body: note.body,
        }),
      });
      if (!res.ok) {
        setStatus((cur) => ({ ...cur, [department]: "failed" }));
        setError("Could not save that department.");
        return;
      }
      setSaved((cur) => ({ ...cur, [department]: note.body }));
      setStatus((cur) => ({ ...cur, [department]: "saved" }));
    } catch {
      setStatus((cur) => ({ ...cur, [department]: "failed" }));
      setError("Network error. Try again.");
    }
  }

  return (
    <div className="snap-dept-list">
      {error ? <p className="error">{error}</p> : null}
      {notes.map((note) => (
        <label key={note.department} className="snap-dept">
          <span className="snap-dept-head">
            <strong>{note.label}</strong>
            <span>
              {status[note.department] === "saving"
                ? "Saving…"
                : status[note.department] === "saved"
                  ? "Saved"
                  : status[note.department] === "failed"
                    ? "Not saved"
                    : "What we did this week"}
            </span>
          </span>
          <textarea
            value={note.body}
            aria-label={`${note.label}: what we did this week`}
            placeholder="What we did this week"
            onChange={(e) => edit(note.department, e.target.value)}
            onBlur={() => void commit(note.department)}
          />
        </label>
      ))}
    </div>
  );
}
