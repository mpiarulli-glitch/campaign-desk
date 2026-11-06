import { parseWeekStart } from "./week";

/**
 * Team-facing snapshot for one Friday-ask client and that ask's week.
 * The id is the row's own client, and the path is /admin/snapshot, not the
 * client portal at /snapshot.
 */
export function teamSnapshotHref(clientId: string, weekStart: string): string {
  const id = clientId.trim();
  const params = new URLSearchParams();
  const week = parseWeekStart(weekStart);
  if (week) params.set("week", week);
  params.set("from", "friday");
  return `/admin/snapshot/${encodeURIComponent(id)}?${params.toString()}`;
}

export function fridayAskReturnHref(): string {
  return "/admin/client-services?tab=friday";
}
