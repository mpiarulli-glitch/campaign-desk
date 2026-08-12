// Snapshot metric periods. Pure functions, no DB, so client components can share
// the same rules the API validates against.
//
// A period is stored as canonical `YYYY-MM`. Before that it was stored as whatever
// was typed, and two things went wrong silently:
//
//   - The charts order points as text, so "Jan 2026" sorted before "Feb 2025" and
//     the trend line ran through time in the wrong order.
//   - "2026-04" and "April 2026" are the same month to a reader but two different
//     keys to the UNIQUE (client_id, metric, period) index, so one inconsistent
//     entry forked a series in two and each chart plotted half the data.
//
// Canonicalising on the way in fixes both. Reading the common spellings on the way
// in means it costs nobody their habits.

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const pad2 = (n: number) => String(n).padStart(2, "0");
const inRange = (y: number, m: number) => y >= 1900 && y <= 2999 && m >= 1 && m <= 12;

/** A metric period as canonical `YYYY-MM`, or "" if it is not a month. */
export function normalizeMetricPeriod(raw: string): string {
  const text = (raw || "").trim();
  if (!text) return "";

  // 2026-04, 2026-4, 2026/04, and the 2026-04-01 a date picker submits.
  const iso = text.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?$/);
  if (iso) {
    const [y, m] = [Number(iso[1]), Number(iso[2])];
    return inRange(y, m) ? `${y}-${pad2(m)}` : "";
  }
  // 4/2026, 04-2026
  const monthYear = text.match(/^(\d{1,2})[-/](\d{4})$/);
  if (monthYear) {
    const [m, y] = [Number(monthYear[1]), Number(monthYear[2])];
    return inRange(y, m) ? `${y}-${pad2(m)}` : "";
  }
  // April 2026, Apr 2026, Apr-2026, April '26
  const named = text.match(/^([a-z]{3,9})\.?[\s-]+'?(\d{2,4})$/i);
  if (named) {
    const m = MONTH_NAMES[named[1].toLowerCase()];
    let y = Number(named[2]);
    if (y < 100) y += 2000;
    if (m && inRange(y, m)) return `${y}-${pad2(m)}`;
  }
  // 2026 April
  const yearNamed = text.match(/^(\d{4})[\s-]+([a-z]{3,9})\.?$/i);
  if (yearNamed) {
    const m = MONTH_NAMES[yearNamed[2].toLowerCase()];
    const y = Number(yearNamed[1]);
    if (m && inRange(y, m)) return `${y}-${pad2(m)}`;
  }
  return "";
}

/** "2026-04" as "Apr 2026". Anything not canonical is returned as-is. */
export function metricPeriodLabel(period: string): string {
  const m = (period || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return period || "";
  return `${SHORT_MONTHS[Number(m[2]) - 1] || m[2]} ${m[1]}`;
}

/** "2026-04" as "Apr", for a chart axis where the year is stated elsewhere. */
export function metricPeriodShortLabel(period: string): string {
  const m = (period || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return period || "";
  return SHORT_MONTHS[Number(m[2]) - 1] || m[2];
}
