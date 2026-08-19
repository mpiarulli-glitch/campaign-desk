export const CALENDAR_STATUS_KEYS = [
  "requested",
  "planned",
  "scheduled",
  "sent",
] as const;
export type CalendarStatusKey = (typeof CALENDAR_STATUS_KEYS)[number];

export const CALENDAR_STATUS_LABEL: Record<CalendarStatusKey, string> = {
  requested: "Requested",
  planned: "Planned",
  scheduled: "Scheduled",
  sent: "Sent",
};

export function isCalendarStatusKey(value: string): value is CalendarStatusKey {
  return (CALENDAR_STATUS_KEYS as readonly string[]).includes(value);
}

/** Empty selection means every status. */
export function sendMatchesStatusFilter(
  status: string | null | undefined,
  selected: readonly CalendarStatusKey[]
): boolean {
  if (selected.length === 0) return true;
  return selected.includes((status || "") as CalendarStatusKey);
}
