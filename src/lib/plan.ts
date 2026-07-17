import { nanoid } from "nanoid";
import {
  getDb,
  nowIso,
  type CalendarFeedback,
  type RevClient,
  type ScheduledSend,
} from "./db";

export type { CalendarFeedback };

/* ------------------------------------------------------- share tokens */

function getClient(id: string): RevClient | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM rev_clients WHERE id = ?`)
      .get(id) as RevClient | undefined) || null
  );
}

// Returns the client's editorial-plan share token, creating one on first use.
export function getOrCreateCalendarToken(clientId: string): string | null {
  const client = getClient(clientId);
  if (!client) return null;
  if (client.calendar_token) return client.calendar_token;
  const token = nanoid(24);
  getDb()
    .prepare(`UPDATE rev_clients SET calendar_token = ? WHERE id = ?`)
    .run(token, clientId);
  return token;
}

export function rotateCalendarToken(clientId: string): string | null {
  if (!getClient(clientId)) return null;
  const token = nanoid(24);
  getDb()
    .prepare(`UPDATE rev_clients SET calendar_token = ? WHERE id = ?`)
    .run(token, clientId);
  return token;
}

export function getClientByCalendarToken(token: string): RevClient | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM rev_clients WHERE calendar_token = ?`)
      .get(token) as RevClient | undefined) || null
  );
}

/* ------------------------------------------------------------- sends */

// A client's planned sends inside [start, end] (inclusive), ascending.
export function planSends(
  clientId: string,
  start: string,
  end: string
): ScheduledSend[] {
  return getDb()
    .prepare(
      `SELECT * FROM scheduled_sends
       WHERE client_id = ? AND send_date >= ? AND send_date <= ?
       ORDER BY send_date ASC, send_time ASC, created_at ASC`
    )
    .all(clientId, start, end) as ScheduledSend[];
}

/* ---------------------------------------------------------- feedback */

export function listFeedback(clientId: string): CalendarFeedback[] {
  return getDb()
    .prepare(`SELECT * FROM calendar_feedback WHERE client_id = ?`)
    .all(clientId) as CalendarFeedback[];
}

// One note per send. Empty body clears the note.
export function upsertFeedback(
  sendId: string,
  clientId: string,
  body: string
): CalendarFeedback | null {
  const db = getDb();
  const trimmed = body.trim();
  const ts = nowIso();
  if (!trimmed) {
    db.prepare(`DELETE FROM calendar_feedback WHERE send_id = ?`).run(sendId);
    return null;
  }
  const existing = db
    .prepare(`SELECT * FROM calendar_feedback WHERE send_id = ?`)
    .get(sendId) as CalendarFeedback | undefined;
  if (existing) {
    db.prepare(
      `UPDATE calendar_feedback SET body = ?, updated_at = ? WHERE send_id = ?`
    ).run(trimmed, ts, sendId);
  } else {
    db.prepare(
      `INSERT INTO calendar_feedback (id, send_id, client_id, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(nanoid(12), sendId, clientId, trimmed, ts, ts);
  }
  return db
    .prepare(`SELECT * FROM calendar_feedback WHERE send_id = ?`)
    .get(sendId) as CalendarFeedback;
}

/* --------------------------------------------------------- approval */

export interface PlanApproval {
  approvedAt: string | null;
  approvedBy: string | null;
}

export function approvePlan(clientId: string, name: string): PlanApproval | null {
  const client = getClient(clientId);
  if (!client) return null;
  const ts = nowIso();
  getDb()
    .prepare(
      `UPDATE rev_clients SET calendar_approved_at = ?, calendar_approved_by = ? WHERE id = ?`
    )
    .run(ts, name.trim() || "Client", clientId);
  return { approvedAt: ts, approvedBy: name.trim() || "Client" };
}

// Clear approval — used when the plan changes materially and needs re-sign-off.
export function clearApproval(clientId: string): boolean {
  return (
    getDb()
      .prepare(
        `UPDATE rev_clients SET calendar_approved_at = NULL, calendar_approved_by = NULL WHERE id = ?`
      )
      .run(clientId).changes > 0
  );
}
