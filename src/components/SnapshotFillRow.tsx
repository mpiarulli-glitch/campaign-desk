"use client";

import { useState } from "react";
import { SnapshotCatchUp } from "@/components/SnapshotCatchUp";
import {
  loggedForTargetsOtherPeriod,
} from "@/lib/snapshot-entry-date";
import { snapshotAuthorLabel, teamLabelFor } from "@/lib/people";
import {
  isSnapshotContractMet,
  SNAPSHOT_STATUSES,
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
  status: SnapshotStatus;
  work_done: string;
  next_steps: string;
  notes: string;
  logged_by: string;
  updated_at: string;
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

function ownershipChip(row: { team: string; category: string; name: string }): string | null {
  const ownership = inferDeliverableOwnership(row);
  if (ownership === "unknown") return null;
  return teamLabelFor(ownership);
}

export function SnapshotFillRow({
  row,
  viewWeek,
  loggedFor,
  overdue,
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
  viewWeek: string;
  loggedFor: string;
  overdue: boolean;
  open: boolean;
  saveState?: SnapshotFillSaveState;
  onToggle: () => void;
  onPatch: (patch: Partial<SnapshotFillRowData>) => void;
  onLoggedForChange: (loggedFor: string) => void;
  onSave: (patch: Partial<SnapshotFillRowData>, opts?: { loggedFor?: string }) => void;
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
  const [askingWhen, setAskingWhen] = useState(false);
  const [whenDate, setWhenDate] = useState(loggedFor);
  const met = isSnapshotContractMet(row.status);
  const author = snapshotAuthorLabel(row.logged_by);
  const now = new Date();
  const todayYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  function confirmDone() {
    const when = whenDate || loggedFor;
    onLoggedForChange(when);
    onPatch({ status: "completed" });
    onSave({ status: "completed" }, { loggedFor: when });
    setAskingWhen(false);
  }

  return (
    <div className={`snap-n-row ${overdue ? "is-overdue" : ""} ${open ? "is-open" : ""} ${met ? "is-met" : ""}`}>
      <div className="snap-n-cols">
        <button type="button" className="snap-n-title" onClick={onToggle}>
          <span className="snap-n-ico" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M4.5 2.5h5.2L12.5 5.3V13.5h-8v-11z" />
              <path d="M9.5 2.5V5.5h3" />
            </svg>
          </span>
          <span className="snap-n-name">
            {row.name}
            {overdue ? <span className="snap-desk-overdue">Overdue</span> : null}
          </span>
        </button>
        <span className={`snap-n-tag snap-n-tag-${categoryTagTone(row.category || "Other")}`}>
          {row.category.trim() || "Other"}
        </span>
        <select
          className={`snap-n-status status-${row.status}`}
          value={row.status}
          aria-label="Status"
          onChange={(e) => {
            const status = e.target.value as SnapshotStatus;
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
          {met ? (
            <span className="snap-done-mark">Done</span>
          ) : askingWhen ? (
            <form
              className="snap-when-ask"
              onSubmit={(e) => {
                e.preventDefault();
                confirmDone();
              }}
            >
              <label>
                <span>When?</span>
                <input
                  type="date"
                  value={whenDate}
                  min={launchDate || undefined}
                  max={todayYmd}
                  autoFocus
                  aria-label="When this work happened"
                  onChange={(e) => setWhenDate(e.target.value)}
                />
              </label>
              <button type="submit" className="snap-done-btn">
                Save
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setAskingWhen(false)}
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="snap-done-btn"
              onClick={() => {
                setWhenDate(loggedFor);
                setAskingWhen(true);
              }}
            >
              Mark done
            </button>
          )}
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
      {author ? (
        <p className="snap-n-meta">
          {author}
          {row.updated_at ? ` · ${relativeTime(row.updated_at)}` : ""}
        </p>
      ) : null}
      {backdateOther ? (
        <p className="snap-backdate-hint">
          Saves to the period containing {loggedFor}, not the week on screen.
        </p>
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
          <label>
            <span>What we did</span>
            <textarea
              value={row.work_done}
              onChange={(e) => onPatch({ work_done: e.target.value })}
              onBlur={(e) => onSave({ work_done: e.target.value })}
              placeholder="What got done this week"
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
