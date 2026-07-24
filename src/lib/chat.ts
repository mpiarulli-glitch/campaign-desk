import { nanoid } from "nanoid";
import { getDb, nowIso, type ChatMessage } from "./db";

export type { ChatMessage };

export function listMessages(room: string, limit = 200): ChatMessage[] {
  return getDb()
    .prepare(
      `SELECT * FROM chat_messages WHERE room = ? ORDER BY created_at ASC LIMIT ?`
    )
    .all(room, limit) as ChatMessage[];
}

export function postMessage(input: {
  room: string;
  body: string;
  authorName: string;
  authorSlug?: string;
  isClient?: boolean;
}): ChatMessage {
  const db = getDb();
  const id = nanoid(14);
  const ts = nowIso();
  db.prepare(
    `INSERT INTO chat_messages (id, room, author_name, author_slug, is_client, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.room,
    input.authorName.trim() || "Someone",
    (input.authorSlug || "").trim(),
    input.isClient ? 1 : 0,
    input.body.trim(),
    ts
  );
  return db.prepare(`SELECT * FROM chat_messages WHERE id = ?`).get(id) as ChatMessage;
}

// Count of messages in a room newer than a given ISO timestamp — used for the
// internal unread-ish badge on client hubs.
export function countSince(room: string, sinceIso: string): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM chat_messages WHERE room = ? AND created_at > ?`)
    .get(room, sinceIso) as { n: number };
  return row.n;
}
