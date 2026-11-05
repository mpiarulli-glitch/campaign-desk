// Turn one Basecamp recording into a snapshot suggestion activity.
//
// Pure: no network. Weekly suggestions read Todo and Kanban::Card recordings
// instead of walking every list. A card counts when Basecamp marks it
// completed, parks it on a Done column, or moves it to a Sent-for-approval
// column. The week check itself stays in suggestionsForWeek.

import type { BasecampActivity } from "./snapshot-basecamp-suggestions";
import { pacificYmd } from "./snapshot-basecamp-suggestions";

export type BcRecordingParent = {
  id?: number | string;
  title?: string;
  name?: string;
  type?: string;
};

export type BcRecording = {
  id?: number | string;
  title?: string;
  content?: string;
  completed?: boolean;
  completed_at?: string | null;
  updated_at?: string | null;
  completion?: { created_at?: string | null } | null;
  parent?: BcRecordingParent | null;
  assignees?: Array<{ id?: number; name?: string } | null> | null;
};

/** Column Basecamp treats as finished, or a column titled Done / Complete. */
export function isDoneColumn(parent: BcRecordingParent | null | undefined): boolean {
  const type = (parent?.type || "").trim();
  if (type === "Kanban::DoneColumn") return true;
  const title = (parent?.title || parent?.name || "").trim();
  return /^(done|complete|completed)\b/i.test(title);
}

/**
 * A column the team uses once work has gone out for approval.
 * "Sent for Approval" and "Sent to client for approval" both count.
 * "Needs Approval" does not — that card has not been sent.
 */
export function isSentForApprovalColumn(parent: BcRecordingParent | null | undefined): boolean {
  const title = (parent?.title || parent?.name || "").trim();
  if (!title) return false;
  return /\bsent\b[\s\w'’-]{0,40}\bapproval\b/i.test(title);
}

/** completion.created_at on a recording, or the completed_at field on a list row. */
export function completionStamp(recording: BcRecording): string {
  const direct = (recording.completed_at || "").trim();
  if (direct) return direct;
  return (recording.completion?.created_at || "").trim();
}

/**
 * A card moved to a Done column, or marked completed.
 * An open card on Triage (or any other column) is not a suggestion.
 */
export function isCompletedCard(recording: BcRecording): boolean {
  if (recording.completed === true) return true;
  if (completionStamp(recording)) return true;
  return isDoneColumn(recording.parent);
}

export function isCompletedTodo(recording: BcRecording): boolean {
  if (recording.completed === true) return true;
  return Boolean(completionStamp(recording));
}

/**
 * When the work was finished. A real completion stamp wins. A Done-column
 * card often has none — Basecamp does not store the move — so the recording's
 * updated_at is the stand-in, and the week filter drops anything outside it.
 */
export function recordingCompletedAt(recording: BcRecording): string {
  return completionStamp(recording) || (recording.updated_at || "").trim();
}

/**
 * True when this recording was last touched before the Pacific week.
 * Recordings are read newest-first, so the walk stops at the first one.
 * A blank timestamp does not stop the walk.
 */
export function recordingOlderThanWeek(
  updatedAt: string | null | undefined,
  weekStart: string
): boolean {
  const ymd = pacificYmd(updatedAt || "");
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return false;
  return ymd < weekStart;
}

export function activityFromRecording(
  recording: BcRecording,
  kind: "todo" | "card"
): BasecampActivity | null {
  const sent = kind === "card" && isSentForApprovalColumn(recording.parent);
  const done = kind === "card" ? isCompletedCard(recording) : isCompletedTodo(recording);
  if (!sent && !done) return null;
  const title = (recording.title || recording.content || "").trim();
  const id = String(recording.id ?? "").trim();
  if (!title || !id) return null;
  const place = (recording.parent?.title || recording.parent?.name || "").trim();
  const assigneeNames = (recording.assignees || [])
    .map((person) => (person?.name || "").trim())
    .filter(Boolean);
  // A sent column wins over a completed flag. The move is updated_at, since
  // Basecamp does not record when a card changed columns.
  const completedAt = sent
    ? (recording.updated_at || "").trim() || recordingCompletedAt(recording)
    : recordingCompletedAt(recording);
  return {
    sourceKey: `${kind}:${id}`,
    title,
    place,
    assigneeNames,
    completedAt: completedAt || null,
    mark: sent ? "sent" : "done",
  };
}

export function activitiesFromRecordings(
  recordings: BcRecording[],
  kind: "todo" | "card"
): BasecampActivity[] {
  const out: BasecampActivity[] = [];
  const seen = new Set<string>();
  for (const recording of recordings) {
    const activity = activityFromRecording(recording, kind);
    if (!activity || seen.has(activity.sourceKey)) continue;
    seen.add(activity.sourceKey);
    out.push(activity);
  }
  return out;
}
