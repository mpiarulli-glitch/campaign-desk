/**
 * Hours tracked this week, matching the forecast week gauge.
 *
 * Basecamp timesheet hours live in `loggedByDate`, keyed by the day they were
 * written. SEO Ops actuals add once via `syncTrackedHours`. Synced day bars
 * (`syncByDate`) are a separate slice and must not be added again.
 */
export function trackedHoursFromForecast(
  data: {
    loggedByDate?: Record<string, number> | null;
    syncTrackedHours?: number | null;
  } | null
): number | null {
  if (!data) return null;
  const loggedFromDays = Object.values(data.loggedByDate || {}).reduce(
    (sum, n) => sum + (typeof n === "number" && Number.isFinite(n) ? n : 0),
    0
  );
  const sync = typeof data.syncTrackedHours === "number" && Number.isFinite(data.syncTrackedHours)
    ? data.syncTrackedHours
    : 0;
  return Math.round((loggedFromDays + sync) * 100) / 100;
}

/** One decimal, with a trailing .0 dropped. Same shape as the forecast gauge. */
export function formatTrackedHours(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function trackedHoursSentence(n: number): string {
  const shown = formatTrackedHours(n);
  const unit = shown === "1" ? "hour" : "hours";
  return `You've tracked ${shown} ${unit} this week.`;
}
