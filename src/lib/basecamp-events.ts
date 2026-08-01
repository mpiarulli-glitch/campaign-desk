// Basecamp Schedule::Entry sync.
//
// The schedule API can't filter by date and pages at 15 records, so this
// account's ~1,400 entries need ~95 requests to read in full — impossible to do
// while a calendar page loads. Instead a background sweep mirrors them into
// basecamp_events and the calendar reads that table directly.

import { getDb, nowIso, type BasecampEvent } from "./db";
import { basecampConnected, listAllScheduleEntries } from "./basecamp";
import { APP_TIME_ZONE } from "./cadence";
import { listRevClients } from "./revenue";

export type { BasecampEvent };

// All-day entries arrive as a plain "2026-08-05"; timed ones as UTC ISO. Only
// the latter need converting, and they need the app's timezone rather than the
// server's, or a 5pm Pacific meeting lands on the next day.
function localDateOf(startsAt: string): string {
  if (!startsAt) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(startsAt)) return startsAt;
  const d = new Date(startsAt);
  if (Number.isNaN(d.getTime())) return "";
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export interface EventSyncResult {
  ok: boolean;
  error?: string;
  fetched: number;
  stored: number;
  removed: number;
}

/**
 * Replace the cached events with a fresh sweep of the account.
 *
 * Entries are matched to a client by their project id. Events from projects
 * with no client (internal MEG workspaces) are kept but left unattached, so the
 * calendar can choose whether to show them rather than losing them at sync time.
 */
export async function syncBasecampEvents(): Promise<EventSyncResult> {
  if (!basecampConnected()) {
    return { ok: false, error: "Basecamp isn't connected.", fetched: 0, stored: 0, removed: 0 };
  }
  const entries = await listAllScheduleEntries();
  if (!entries.length) {
    return { ok: false, error: "No schedule entries returned.", fetched: 0, stored: 0, removed: 0 };
  }

  const byProject = new Map<string, { id: string; name: string }>();
  for (const c of listRevClients(true)) {
    if (c.basecamp_project_id) byProject.set(String(c.basecamp_project_id), { id: c.id, name: c.name });
  }

  const db = getDb();
  const ts = nowIso();
  const upsert = db.prepare(
    `INSERT INTO basecamp_events
       (id, project_id, client_id, client_name, project_name, title, event_date,
        starts_at, ends_at, all_day, participants, app_url, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       project_id = excluded.project_id,
       client_id = excluded.client_id,
       client_name = excluded.client_name,
       project_name = excluded.project_name,
       title = excluded.title,
       event_date = excluded.event_date,
       starts_at = excluded.starts_at,
       ends_at = excluded.ends_at,
       all_day = excluded.all_day,
       participants = excluded.participants,
       app_url = excluded.app_url,
       synced_at = excluded.synced_at`
  );

  let stored = 0;
  const seen: string[] = [];
  const run = db.transaction(() => {
    for (const e of entries) {
      const date = localDateOf(e.startsAt);
      if (!date) continue;
      const client = byProject.get(String(e.projectId));
      upsert.run(
        e.id,
        String(e.projectId),
        client?.id ?? null,
        client?.name || "",
        e.projectName || "",
        e.title,
        date,
        e.startsAt,
        e.endsAt,
        e.allDay ? 1 : 0,
        e.participants.join(", "),
        e.appUrl || "",
        ts
      );
      seen.push(e.id);
      stored++;
    }
  });
  run();

  // Anything not in this sweep was deleted or trashed in Basecamp. Comparing
  // synced_at is simpler than diffing ids and works with the transaction above.
  const removed = db
    .prepare(`DELETE FROM basecamp_events WHERE synced_at <> ?`)
    .run(ts).changes;

  return { ok: true, fetched: entries.length, stored, removed };
}

// Cached events in a date range, newest-first within each day.
export function listEventsBetween(
  start: string,
  end: string,
  opts?: { clientsOnly?: boolean }
): BasecampEvent[] {
  const where = opts?.clientsOnly ? "AND client_id IS NOT NULL" : "";
  return getDb()
    .prepare(
      `SELECT * FROM basecamp_events
       WHERE event_date >= ? AND event_date <= ? ${where}
       ORDER BY event_date ASC, all_day DESC, starts_at ASC`
    )
    .all(start, end) as BasecampEvent[];
}

// How long a meeting runs, in hours, rounded to the nearest quarter so it drops
// straight into a forecast row. All-day entries have no real duration, so they
// return 0 and the person types their own estimate.
export function eventHours(event: BasecampEvent): number {
  if (event.all_day) return 0;
  const start = new Date(event.starts_at).getTime();
  const end = new Date(event.ends_at).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round(((end - start) / 3_600_000) * 4) / 4;
}

// Does this Basecamp event list the given person as a participant?
//
// Basecamp stores full names ("Piarulli Michael") while the app knows people by
// a short label ("Michael") or a slug ("mike_hines"), so this compares the parts
// rather than the whole. Deliberately loose: a false positive puts one extra
// meeting in a list the person is already choosing from, whereas a false
// negative hides the meeting they are trying to book.
export function eventHasParticipant(
  event: BasecampEvent,
  names: string[]
): boolean {
  const haystack = event.participants.toLowerCase();
  if (!haystack) return false;
  return names.some((name) => {
    for (const part of name.toLowerCase().split(/[\s_]+/)) {
      // Skip initials and short fragments, which would match far too much.
      if (part.length < 3) continue;
      if (haystack.includes(part)) return true;
    }
    return false;
  });
}

/**
 * Meetings on one day, split into the person's own and everything else.
 *
 * Reads the local cache, so this is a table scan rather than a Basecamp call and
 * is safe to hit while someone opens the add form. Events are deliberately NOT
 * restricted to clients: internal MEG meetings are exactly the ones people were
 * otherwise faking a todo for.
 */
export function listEventsForDay(
  date: string,
  names: string[]
): { mine: BasecampEvent[]; others: BasecampEvent[] } {
  const all = getDb()
    .prepare(
      `SELECT * FROM basecamp_events
       WHERE event_date = ?
       ORDER BY all_day DESC, starts_at ASC`
    )
    .all(date) as BasecampEvent[];

  const mine: BasecampEvent[] = [];
  const others: BasecampEvent[] = [];
  for (const event of all) {
    (eventHasParticipant(event, names) ? mine : others).push(event);
  }
  return { mine, others };
}

export function lastEventSyncAt(): string | null {
  const row = getDb()
    .prepare(`SELECT MAX(synced_at) AS at FROM basecamp_events`)
    .get() as { at: string | null } | undefined;
  return row?.at || null;
}

const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

/**
 * Refresh the cache on boot when it's empty or old.
 *
 * There's no scheduler in this app, so without this the table would stay empty
 * until someone pressed the button. Deploys and restarts are frequent enough to
 * keep it reasonably fresh; the admin button and the cron-secret endpoint cover
 * the rest. Errors are logged and swallowed — the server must still start if
 * Basecamp is down.
 */
export async function syncBasecampEventsIfStale(): Promise<void> {
  try {
    const last = lastEventSyncAt();
    if (last && Date.now() - new Date(last).getTime() < STALE_AFTER_MS) return;
    if (!basecampConnected()) return;
    const result = await syncBasecampEvents();
    console.log(
      `[basecamp-events] ${result.ok ? "synced" : "failed"} fetched=${result.fetched} stored=${result.stored} removed=${result.removed}${result.error ? ` error=${result.error}` : ""}`
    );
  } catch (err) {
    console.error("[basecamp-events] sync failed", (err as Error).message);
  }
}
