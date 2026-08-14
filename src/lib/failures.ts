// Things the app tried and failed to do.
//
// Every integration here swallows its own failures deliberately. A Campfire
// outage must never cost a client their booking, so the code logs and carries on.
// The cost is that a failure leaves no trace anybody reads: a reminder sweep that
// never ran for months looked exactly like one with nothing to do, four Basecamp
// cards 403'd in silence, and a production notification reached nobody because
// the service account was not on the project.
//
// Recording is best effort and never throws. A failure surfacing is worth
// something; a failure in the failure recorder taking down a booking is not.

import { getDb, nowIso, type AppFailure } from "./db";
import { nanoid } from "nanoid";

export type FailureKind =
  | "email"
  | "basecamp_card"
  | "basecamp_card_move"
  | "basecamp_campfire"
  | "basecamp_comment"
  | "basecamp_approval"
  | "basecamp_project"
  | "contact_unresolved";

export interface RecordFailureInput {
  kind: FailureKind;
  // Usually the client name. Together with kind this is the dedupe key, so the
  // same thing failing nightly is one row with a count.
  subject: string;
  detail: string;
  // What the reader should do about it. Worth writing properly: the person
  // reading this list is trying to decide whether to act.
  hint?: string;
}

export function recordFailure(input: RecordFailureInput): void {
  try {
    const db = getDb();
    const ts = nowIso();
    const existing = db
      .prepare(
        `SELECT id FROM app_failures
         WHERE kind = ? AND subject = ? AND dismissed_at IS NULL`
      )
      .get(input.kind, input.subject) as { id: string } | undefined;

    if (existing) {
      // Refresh the detail: the most recent error is more useful than the first,
      // and a changed message often means the cause changed.
      db.prepare(
        `UPDATE app_failures
         SET detail = ?, hint = ?, last_seen_at = ?, seen_count = seen_count + 1
         WHERE id = ?`
      ).run(input.detail.slice(0, 500), input.hint || "", ts, existing.id);
      return;
    }
    db.prepare(
      `INSERT INTO app_failures
         (id, kind, subject, detail, hint, occurred_at, last_seen_at, seen_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(
      nanoid(12),
      input.kind,
      input.subject,
      input.detail.slice(0, 500),
      input.hint || "",
      ts,
      ts
    );
  } catch (err) {
    // Deliberately swallowed. See the module comment.
    console.error("[failures] could not record a failure:", err);
  }
}

// Something that was failing now works, so stop showing it. Called on the
// success path, which is what keeps the list honest without anybody tidying it.
export function clearFailure(kind: FailureKind, subject: string): void {
  try {
    getDb()
      .prepare(
        `UPDATE app_failures SET dismissed_at = ?
         WHERE kind = ? AND subject = ? AND dismissed_at IS NULL`
      )
      .run(nowIso(), kind, subject);
  } catch {
    // Not worth surfacing: the entry simply stays visible.
  }
}

export function listOpenFailures(limit = 100): AppFailure[] {
  return getDb()
    .prepare(
      `SELECT * FROM app_failures
       WHERE dismissed_at IS NULL
       ORDER BY last_seen_at DESC
       LIMIT ?`
    )
    .all(limit) as AppFailure[];
}

export function openFailureCount(): number {
  const row = getDb()
    .prepare(`SELECT count(*) c FROM app_failures WHERE dismissed_at IS NULL`)
    .get() as { c: number };
  return row.c;
}

export function dismissFailure(id: string): boolean {
  return (
    getDb()
      .prepare(
        `UPDATE app_failures SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL`
      )
      .run(nowIso(), id).changes > 0
  );
}
