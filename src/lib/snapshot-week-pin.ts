// Which week an unpinned client snapshot link should open, and which of
// this client's weeks the public page may browse.
//
// The account token is reused every Friday. A link that already went out
// without a week cannot name the email it came from. The send log can
// recover that week only when every send for the client was the same week.
// The token column has no created-at, so there is nothing else to recover
// from. Anything ambiguous keeps today's behavior and opens the current week.

import { getDb } from "./db";
import { mondayOf, parseWeekStart } from "./week";

function mondays(rows: Array<{ week_start: string }>, cap?: string): string[] {
  const weeks = new Set<string>();
  for (const row of rows) {
    const week = parseWeekStart(row.week_start);
    if (!week) continue;
    if (cap && week > cap) continue;
    weeks.add(week);
  }
  return [...weeks].sort();
}

/** Distinct weeks a snapshot link was actually sent for this client. */
export function sentSnapshotWeeks(clientId: string): string[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT week_start FROM snapshot_outreach
       WHERE client_id = ? AND week_start != ''`
    )
    .all(clientId) as Array<{ week_start: string }>;
  return mondays(rows);
}

/**
 * Week to open when the URL has no `week`.
 *
 * One sent week (email and Basecamp for that same Monday count as one) is
 * recovered from the send record. Zero sends, or more than one week, fall
 * back to the current week. The snapshot token itself is not dated.
 */
export function resolveUnpinnedSnapshotWeek(clientId: string, today = new Date()): string {
  const sent = sentSnapshotWeeks(clientId);
  if (sent.length === 1) return sent[0];
  return mondayOf(today);
}

/**
 * Weeks this client can move between: sends, saved wins, department lines,
 * and deliverable entries, plus the current week and the week on screen.
 * Future weeks stay off the list unless that is the week being viewed.
 * Another client's rows are never included.
 */
export function clientSnapshotWeeks(
  clientId: string,
  viewing?: string | null,
  today = new Date()
): string[] {
  const cap = mondayOf(today);
  const rows = getDb()
    .prepare(
      `SELECT week_start FROM snapshot_entries
        WHERE client_id = ? AND week_start != ''
       UNION
       SELECT week_start FROM snapshot_department_items
        WHERE client_id = ? AND week_start != ''
       UNION
       SELECT week_start FROM snapshot_wins
        WHERE client_id = ? AND week_start != ''
       UNION
       SELECT week_start FROM snapshot_outreach
        WHERE client_id = ? AND week_start != ''`
    )
    .all(clientId, clientId, clientId, clientId) as Array<{ week_start: string }>;
  const weeks = new Set(mondays(rows, cap));
  weeks.add(cap);
  const extra = viewing ? parseWeekStart(viewing) : null;
  if (extra) weeks.add(extra);
  return [...weeks].sort();
}
