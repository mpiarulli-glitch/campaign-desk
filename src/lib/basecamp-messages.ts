// Basecamp message-board sync, scoped to threads a client has spoken on.
//
// Same shape and same reason as basecamp-events.ts: reading this live would be
// one request per project plus one per thread, on every page load. A sweep
// mirrors the threads into basecamp_client_messages and the report reads that.

import { getDb, nowIso, type BasecampClientMessage } from "./db";
import { basecampConnected, listProjectMessages, type BcMessageThread } from "./basecamp";
import { listRevClients } from "./revenue";

export type { BasecampClientMessage };

export interface ThreadVerdict {
  /** The client has spoken and nobody on our side has answered since. */
  awaitingReply: boolean;
  /** Last time anyone client-side posted, "" if never. */
  lastClientAt: string;
  /** Last time anyone of ours posted, "" if never. */
  lastTeamAt: string;
  /** True if a client ever appears on the thread at all. */
  clientInvolved: boolean;
}

/**
 * Decide whether a thread is still waiting on us.
 *
 * The rule is simply who spoke last: if the most recent post from a client is
 * newer than the most recent post from our side, nobody has answered them.
 *
 * That deliberately re-opens a thread when a client replies again after we
 * answered, because they are waiting on us a second time. It also covers a
 * client post with no comments at all, which is the common case and the one
 * worth catching.
 *
 * Threads no client has touched are not our concern here and are dropped by
 * clientInvolved, so internal posts between our own people never show up.
 *
 * Pure on purpose: this is the whole judgement of the feature, and it can be
 * tested without a Basecamp connection.
 */
export function judgeThread(thread: BcMessageThread): ThreadVerdict {
  const posts = [
    { at: thread.createdAt, isClient: thread.authorIsClient },
    ...thread.replies.map((r) => ({ at: r.createdAt, isClient: r.authorIsClient })),
  ].filter((p) => Boolean(p.at));

  const newest = (isClient: boolean) =>
    posts
      .filter((p) => p.isClient === isClient)
      .map((p) => p.at)
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || "";

  const lastClientAt = newest(true);
  const lastTeamAt = newest(false);

  return {
    clientInvolved: Boolean(lastClientAt),
    lastClientAt,
    lastTeamAt,
    awaitingReply:
      Boolean(lastClientAt) &&
      (!lastTeamAt || Date.parse(lastClientAt) > Date.parse(lastTeamAt)),
  };
}

export interface MessageSyncResult {
  ok: boolean;
  error?: string;
  projects: number;
  threads: number;
  awaiting: number;
}

/**
 * Refresh the cache from every client project that has a Basecamp project id.
 *
 * Clients without one are skipped rather than guessed at — see the report,
 * which says how many were skipped so an empty result is never mistaken for
 * "nothing is waiting".
 */
export async function syncClientMessages(): Promise<MessageSyncResult> {
  if (!basecampConnected()) {
    return { ok: false, error: "Basecamp isn't connected.", projects: 0, threads: 0, awaiting: 0 };
  }

  const clients = listRevClients(true).filter((c) => c.basecamp_project_id);
  if (!clients.length) {
    return {
      ok: false,
      error: "No client has a Basecamp project id set.",
      projects: 0,
      threads: 0,
      awaiting: 0,
    };
  }

  const db = getDb();
  const ts = nowIso();
  const rows: BasecampClientMessage[] = [];

  for (const client of clients) {
    const projectId = String(client.basecamp_project_id);
    const threads = await listProjectMessages(projectId);
    for (const t of threads) {
      const verdict = judgeThread(t);
      // Threads our own people talk on among themselves aren't the point.
      if (!verdict.clientInvolved) continue;
      rows.push({
        id: `${projectId}:${t.id}`,
        project_id: projectId,
        client_id: client.id,
        client_name: client.name,
        title: t.title,
        app_url: t.url,
        author_name: t.authorName,
        created_at: t.createdAt,
        last_client_at: verdict.lastClientAt,
        last_team_at: verdict.lastTeamAt,
        reply_count: t.replies.length,
        awaiting_reply: verdict.awaitingReply ? 1 : 0,
        synced_at: ts,
      });
    }
  }

  // Replaced wholesale rather than merged: a thread we've since answered must
  // stop being reported, and a diff would leave stale rows behind.
  const write = db.transaction((batch: BasecampClientMessage[]) => {
    db.prepare(`DELETE FROM basecamp_client_messages`).run();
    const ins = db.prepare(
      `INSERT INTO basecamp_client_messages
         (id, project_id, client_id, client_name, title, app_url, author_name,
          created_at, last_client_at, last_team_at, reply_count, awaiting_reply, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const r of batch) {
      ins.run(
        r.id, r.project_id, r.client_id, r.client_name, r.title, r.app_url,
        r.author_name, r.created_at, r.last_client_at, r.last_team_at,
        r.reply_count, r.awaiting_reply, r.synced_at
      );
    }
  });
  write(rows);

  return {
    ok: true,
    projects: clients.length,
    threads: rows.length,
    awaiting: rows.filter((r) => r.awaiting_reply).length,
  };
}

export function listCachedClientMessages(): BasecampClientMessage[] {
  return getDb()
    .prepare(
      `SELECT * FROM basecamp_client_messages ORDER BY last_client_at DESC`
    )
    .all() as BasecampClientMessage[];
}

export function lastMessageSyncAt(): string | null {
  const row = getDb()
    .prepare(`SELECT MAX(synced_at) AS at FROM basecamp_client_messages`)
    .get() as { at: string | null } | undefined;
  return row?.at || null;
}

/** How many clients have no Basecamp project id, so are invisible to the sweep. */
export function clientsMissingProjectId(): string[] {
  return listRevClients(true)
    .filter((c) => !c.basecamp_project_id)
    .map((c) => c.name);
}
