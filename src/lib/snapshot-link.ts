// Client snapshot URLs. Safe to import from client components: no database.
//
// A Friday send pins the week in the query string so the same account token
// can be opened years later and still show the week that email was about.
// The token stays the access grant. The week only chooses which saved
// snapshot to read, and every read is still limited to that one client.

import { parseWeekStart } from "./week";

/** Path a client opens. `weekStart` is normalized to the Monday of that week. */
export function snapshotSharePath(token: string, weekStart: string): string {
  const week = parseWeekStart(weekStart);
  const path = `/snapshot/${encodeURIComponent(token)}`;
  return week ? `${path}?week=${week}` : path;
}

export function snapshotShareUrl(appUrl: string, token: string, weekStart: string): string {
  const base = (appUrl || "").replace(/\/$/, "");
  return `${base}${snapshotSharePath(token, weekStart)}`;
}

/** Monday encoded in a snapshot URL, or null when the link has no usable week. */
export function weekFromSnapshotSearch(search: string): string | null {
  const q = search.startsWith("?") ? search.slice(1) : search;
  return parseWeekStart(new URLSearchParams(q).get("week"));
}

/**
 * Previous or next week in an ascending list of this client's own weeks.
 * Weeks that are not in the list are skipped, so the arrows move between
 * snapshots rather than through empty calendar weeks.
 */
export function adjacentClientSnapshotWeek(
  weeks: string[],
  week: string,
  direction: -1 | 1
): string | null {
  const ordered = [...new Set(weeks.filter((item) => parseWeekStart(item) === item))].sort();
  if (!ordered.length || !week) return null;
  const idx = ordered.indexOf(week);
  if (idx === -1) {
    if (direction < 0) {
      const earlier = ordered.filter((item) => item < week);
      return earlier.length ? earlier[earlier.length - 1] : null;
    }
    return ordered.find((item) => item > week) || null;
  }
  return ordered[idx + direction] || null;
}
