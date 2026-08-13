// A client turning down a cadence window from their own scheduling link.
//
// The outreach has always asked the client to leave a comment on the Basecamp
// card if the dates do not work, and nothing in the app ever read those
// comments. So a client who answered us kept getting nudged three times a week
// until the window closed, and then the window rolled forward silently with no
// record that a production had been missed. This is the answer path the app
// can actually see.
//
// A decline does two things and deliberately no more: it stops the reminder
// sweep for that one window (see runReminders), and it puts the client and the
// window on the production board so somebody picks it up. It never advances the
// cadence anchor and never counts as a production. If the client goes on to
// book a date outside the window, that out-of-cycle send is linked back here as
// the make-up, which is how a skipped window stays visible as owed rather than
// forgotten.
import { nanoid } from "nanoid";
import { getDb, nowIso, type ProductionWindowDecline } from "./db";
import type { DeclineReason } from "./scheduling-rules";

// The reason vocabulary itself lives in scheduling-rules, which the browser can
// import. Re-exported here so server code has one place to reach for.
export {
  DECLINE_REASONS,
  declineReasonLabel,
  isDeclineReason,
  type DeclineReason,
} from "./scheduling-rules";

export function getDecline(id: string): ProductionWindowDecline | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM production_window_declines WHERE id = ?`)
      .get(id) as ProductionWindowDecline | undefined) || null
  );
}

// The live decline for one window, if the client has turned it down and
// nobody has handed the window back since.
export function activeDecline(
  clientId: string,
  windowStart: string
): ProductionWindowDecline | null {
  return (
    (getDb()
      .prepare(
        `SELECT * FROM production_window_declines
         WHERE client_id = ? AND window_start = ? AND cancelled_at IS NULL`
      )
      .get(clientId, windowStart) as ProductionWindowDecline | undefined) || null
  );
}

// Whether the reminder sweep should leave this window alone. A resolved
// decline still counts: the make-up is booked elsewhere and the client is not
// going to book this window either way.
export function isWindowDeclined(
  clientId: string,
  windowStart: string
): boolean {
  return Boolean(activeDecline(clientId, windowStart));
}

// Every decline for a client, newest first, including the ones that were
// resolved or handed back.
export function listDeclinesForClient(
  clientId: string
): ProductionWindowDecline[] {
  return getDb()
    .prepare(
      `SELECT * FROM production_window_declines
       WHERE client_id = ? ORDER BY created_at DESC`
    )
    .all(clientId) as ProductionWindowDecline[];
}

// Declines nobody has closed out: the client said no and no make-up has been
// booked. This is the work list the production board reads.
export function listUnresolvedDeclines(): ProductionWindowDecline[] {
  return getDb()
    .prepare(
      `SELECT * FROM production_window_declines
       WHERE cancelled_at IS NULL AND resolved_at IS NULL
       ORDER BY window_start ASC`
    )
    .all() as ProductionWindowDecline[];
}

// Record the client's answer. Upserts, so a client who declines twice for the
// same window updates what they told us instead of stacking rows, and a window
// that was handed back and then declined again comes back to life.
export function declineWindow(input: {
  clientId: string;
  windowStart: string;
  windowEnd: string;
  reason: DeclineReason;
  note?: string;
  wantsOtherDate?: boolean;
}): ProductionWindowDecline {
  const db = getDb();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO production_window_declines
      (id, client_id, window_start, window_end, reason, note, wants_other_date,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (client_id, window_start) DO UPDATE SET
       window_end = excluded.window_end,
       reason = excluded.reason,
       note = excluded.note,
       wants_other_date = excluded.wants_other_date,
       resolved_send_id = NULL,
       resolved_at = NULL,
       cancelled_at = NULL,
       updated_at = excluded.updated_at`
  ).run(
    nanoid(12),
    input.clientId,
    input.windowStart,
    input.windowEnd,
    input.reason,
    (input.note || "").trim(),
    input.wantsOtherDate ? 1 : 0,
    ts,
    ts
  );
  return activeDecline(input.clientId, input.windowStart)!;
}

// Hand the window back: an admin reopened it, or the client changed their mind
// and booked it after all. Reminders resume from the next sweep.
export function clearDecline(clientId: string, windowStart: string): void {
  const ts = nowIso();
  getDb()
    .prepare(
      `UPDATE production_window_declines
       SET cancelled_at = ?, updated_at = ?
       WHERE client_id = ? AND window_start = ? AND cancelled_at IS NULL`
    )
    .run(ts, ts, clientId, windowStart);
}

export function clearDeclineById(id: string): void {
  const ts = nowIso();
  getDb()
    .prepare(
      `UPDATE production_window_declines
       SET cancelled_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(ts, ts, id);
}

// Link the out-of-cycle booking that made up for a declined window.
//
// Matches the client's oldest open decline rather than one keyed by date,
// because the make-up is by definition outside the window it settles, so
// there is no date to match on. In practice a client has at most one open
// decline at a time.
export function resolveDeclineWithSend(clientId: string, sendId: string): void {
  const open = getDb()
    .prepare(
      `SELECT id FROM production_window_declines
       WHERE client_id = ? AND cancelled_at IS NULL AND resolved_at IS NULL
       ORDER BY created_at ASC LIMIT 1`
    )
    .get(clientId) as { id: string } | undefined;
  if (!open) return;
  const ts = nowIso();
  getDb()
    .prepare(
      `UPDATE production_window_declines
       SET resolved_send_id = ?, resolved_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(sendId, ts, ts, open.id);
}
