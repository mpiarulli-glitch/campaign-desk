import { nanoid } from "nanoid";
import {
  getDb,
  nowIso,
  type BusinessModel,
  type ScheduledSend,
  type SendStatus,
} from "./db";

export type { ScheduledSend, SendStatus };

const STATUSES: SendStatus[] = ["requested", "planned", "scheduled", "sent"];
export const SEND_STATUSES = STATUSES;

// A send joined with its client's model (for calendar color-coding). model is
// null when the send has no linked client.
export interface SendWithClient extends ScheduledSend {
  business_model: BusinessModel | null;
}

function normalizeStatus(v: unknown): SendStatus {
  return STATUSES.includes(v as SendStatus) ? (v as SendStatus) : "planned";
}

// Sends whose date falls in [start, end] (inclusive), ascending. Dates are
// YYYY-MM-DD strings so lexical comparison is chronological.
export function listSends(start: string, end: string): SendWithClient[] {
  return getDb()
    .prepare(
      `SELECT s.*, c.business_model AS business_model
       FROM scheduled_sends s
       LEFT JOIN rev_clients c ON c.id = s.client_id
       WHERE s.send_date >= ? AND s.send_date <= ?
       ORDER BY s.send_date ASC, s.created_at ASC`
    )
    .all(start, end) as SendWithClient[];
}

export function getSend(id: string): ScheduledSend | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM scheduled_sends WHERE id = ?`)
      .get(id) as ScheduledSend | undefined) || null
  );
}

// Resolve the client display name from rev_clients when a client_id is given.
function resolveClientName(clientId: string | null, fallback: string): string {
  if (clientId) {
    const row = getDb()
      .prepare(`SELECT name FROM rev_clients WHERE id = ?`)
      .get(clientId) as { name: string } | undefined;
    if (row) return row.name;
  }
  return (fallback || "").trim();
}

export function createSend(input: {
  clientId?: string | null;
  clientName?: string;
  title: string;
  sendDate: string;
  sendTime?: string;
  status?: SendStatus;
  platform?: string;
  note?: string;
  audience?: string;
  purpose?: string;
  offer?: string;
  subject?: string;
  previewText?: string;
  productionBrief?: string;
  cadenceWindowStart?: string | null;
  requestedByClient?: boolean;
}): ScheduledSend {
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  const clientId = input.clientId || null;
  db.prepare(
    `INSERT INTO scheduled_sends
      (id, client_id, client_name, title, send_date, send_time, status, platform, note,
       audience, purpose, offer, subject, preview_text, production_brief,
       cadence_window_start, requested_by_client, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    clientId,
    resolveClientName(clientId, input.clientName || ""),
    input.title.trim(),
    input.sendDate,
    (input.sendTime || "").trim(),
    normalizeStatus(input.status),
    (input.platform || "").trim(),
    (input.note || "").trim(),
    (input.audience || "").trim(),
    (input.purpose || "").trim(),
    (input.offer || "").trim(),
    (input.subject || "").trim(),
    (input.previewText || "").trim(),
    input.productionBrief || "",
    input.cadenceWindowStart || null,
    input.requestedByClient ? 1 : 0,
    ts,
    ts
  );
  return getSend(id)!;
}

export function updateSend(
  id: string,
  updates: Partial<{
    clientId: string | null;
    clientName: string;
    title: string;
    sendDate: string;
    sendTime: string;
    status: SendStatus;
    platform: string;
    note: string;
    audience: string;
    purpose: string;
    offer: string;
    subject: string;
    previewText: string;
  }>
): ScheduledSend | null {
  const existing = getSend(id);
  if (!existing) return null;
  const db = getDb();
  const clientId =
    updates.clientId === undefined ? existing.client_id : updates.clientId;
  const clientName =
    updates.clientId !== undefined || updates.clientName !== undefined
      ? resolveClientName(clientId, updates.clientName ?? existing.client_name)
      : existing.client_name;
  db.prepare(
    `UPDATE scheduled_sends SET
       client_id = ?, client_name = ?, title = ?, send_date = ?, send_time = ?,
       status = ?, platform = ?, note = ?, audience = ?, purpose = ?,
       offer = ?, subject = ?, preview_text = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    clientId,
    clientName,
    updates.title?.trim() ?? existing.title,
    updates.sendDate ?? existing.send_date,
    updates.sendTime?.trim() ?? existing.send_time,
    updates.status ? normalizeStatus(updates.status) : existing.status,
    updates.platform?.trim() ?? existing.platform,
    updates.note?.trim() ?? existing.note,
    updates.audience?.trim() ?? existing.audience,
    updates.purpose?.trim() ?? existing.purpose,
    updates.offer?.trim() ?? existing.offer,
    updates.subject?.trim() ?? existing.subject,
    updates.previewText?.trim() ?? existing.preview_text,
    nowIso(),
    id
  );
  return getSend(id);
}

export function deleteSend(id: string): boolean {
  return getDb().prepare(`DELETE FROM scheduled_sends WHERE id = ?`).run(id).changes > 0;
}
