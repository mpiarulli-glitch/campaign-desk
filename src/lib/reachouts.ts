// The log of every outbound contact with a client.
//
// The reminder sweep can reach a client three ways: a scheduling email, a
// Basecamp card on their project, and a follow-up comment on that card. The
// Basecamp card and comment both assign and @mention the client's contact, so
// Basecamp emails them. All three are a reachout as far as the client is
// concerned, and all three belong in one list.

import { nanoid } from "nanoid";
import { getDb, nowIso, type Reachout, type ReachoutChannel } from "./db";

export const REACHOUT_CHANNEL_LABEL: Record<ReachoutChannel, string> = {
  email: "Email",
  basecamp_card: "Basecamp card",
  basecamp_comment: "Basecamp follow-up",
};

export function recordReachout(args: {
  clientId: string;
  clientName: string;
  channel: ReachoutChannel;
  windowStart?: string | null;
  ymd: string;
  detail?: string | null;
}): Reachout {
  const row: Reachout = {
    id: nanoid(16),
    client_id: args.clientId,
    client_name: args.clientName,
    channel: args.channel,
    window_start: args.windowStart ?? null,
    ymd: args.ymd,
    detail: args.detail ?? null,
    created_at: nowIso(),
  };
  getDb()
    .prepare(
      `INSERT INTO reachouts
         (id, client_id, client_name, channel, window_start, ymd, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.id,
      row.client_id,
      row.client_name,
      row.channel,
      row.window_start,
      row.ymd,
      row.detail,
      row.created_at
    );
  return row;
}

// Most recent reachouts across the whole book, newest first.
export function listRecentReachouts(limit = 200): Reachout[] {
  return getDb()
    .prepare(
      `SELECT * FROM reachouts ORDER BY created_at DESC, rowid DESC LIMIT ?`
    )
    .all(limit) as Reachout[];
}

// Every reachout for one client, newest first. Powers the per-client history on
// the production console.
export function listReachoutsForClient(
  clientId: string,
  limit = 50
): Reachout[] {
  return getDb()
    .prepare(
      `SELECT * FROM reachouts WHERE client_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT ?`
    )
    .all(clientId, limit) as Reachout[];
}

// The last time we contacted a client at all, on any channel. This is the
// number the console should show, rather than the last email specifically.
export function lastReachoutForClient(clientId: string): Reachout | null {
  return (
    (getDb()
      .prepare(
        `SELECT * FROM reachouts WHERE client_id = ?
         ORDER BY created_at DESC, rowid DESC LIMIT 1`
      )
      .get(clientId) as Reachout | undefined) || null
  );
}

// What outreach has gone out for one specific window, on any channel.
//
// Distinct from lastReachoutForClient, which answers "have we ever contacted
// them". The console needs the per-window answer: a client chased hard for
// July's window has not been asked about August's.
export function reachoutsForWindow(
  clientId: string,
  windowStart: string
): { count: number; last: Reachout | null } {
  const rows = getDb()
    .prepare(
      `SELECT * FROM reachouts WHERE client_id = ? AND window_start = ?
       ORDER BY created_at DESC, rowid DESC`
    )
    .all(clientId, windowStart) as Reachout[];
  return { count: rows.length, last: rows[0] || null };
}

export function listReachoutsOn(ymd: string): Reachout[] {
  return getDb()
    .prepare(
      `SELECT * FROM reachouts WHERE ymd = ? ORDER BY created_at ASC, rowid ASC`
    )
    .all(ymd) as Reachout[];
}
