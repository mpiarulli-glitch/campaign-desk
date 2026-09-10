import { addWeeks, mondayOf } from "./week";
import type { CadenceUnit, DeliverableKind } from "./db";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(v: string): boolean {
  return YMD_RE.test(v);
}

// The period key a given date rolls up to for a cadence unit: the Monday for
// weekly, the 1st of the month for monthly, the 1st month of the quarter for
// quarterly.
export function periodStartFor(unit: CadenceUnit, ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  if (unit === "weekly") {
    const [yy, mm, dd] = ymd.split("-").map(Number);
    return mondayOf(new Date(yy, mm - 1, dd));
  }
  if (unit === "quarterly") {
    const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
    return `${y}-${String(qStartMonth).padStart(2, "0")}-01`;
  }
  return `${y}-${String(m).padStart(2, "0")}-01`; // monthly
}

// Exclusive end of the period containing ymd (first key of the NEXT period).
export function periodEndExclusiveFor(unit: CadenceUnit, ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  if (unit === "weekly") return addWeeks(periodStartFor("weekly", ymd), 1);
  if (unit === "quarterly") {
    const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
    const nextQStartMonth = qStartMonth + 3;
    return nextQStartMonth > 12
      ? `${y + 1}-01-01`
      : `${y}-${String(nextQStartMonth).padStart(2, "0")}-01`;
  }
  return m + 1 > 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`; // monthly
}

export function weekOfYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return mondayOf(new Date(y, (m || 1) - 1, d || 1));
}

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Default "logged for" date when filling a deliverable while viewing `viewWeek`
 * (a Monday). Today when it falls inside the viewed week; otherwise the Monday
 * of that week.
 */
export function defaultLoggedForDate(viewWeek: string, today = todayYmd()): string {
  const weekEnd = addWeeks(viewWeek, 1);
  if (today >= viewWeek && today < weekEnd) return today;
  return viewWeek;
}

/**
 * Map an actual calendar date to the `week_start` key upsertEntry should write.
 * Always the Monday of that week (clamped into the month/quarter for longer
 * cadences, so a week overlapping the 1st is not filed in the prior period).
 */
export function entryWeekStartForDate(
  kind: DeliverableKind,
  unit: CadenceUnit,
  loggedFor: string
): string {
  const week = weekOfYmd(loggedFor);
  if (kind === "one_time" || unit === "weekly") return week;
  const start = periodStartFor(unit, loggedFor);
  const end = periodEndExclusiveFor(unit, loggedFor);
  if (week < start) return start;
  if (week >= end) return weekOfYmd(addWeeks(end, -1));
  return week;
}

/** Period start for a deliverable row when viewing a given week. */
export function periodStartForRow(
  kind: DeliverableKind,
  unit: CadenceUnit,
  viewWeek: string
): string {
  if (kind === "one_time") return "";
  if (unit === "weekly") return viewWeek;
  return periodStartFor(unit, viewWeek);
}

/** True when the chosen date lands in a different period than the week on screen. */
export function loggedForTargetsOtherPeriod(input: {
  kind: DeliverableKind;
  cadence_unit: CadenceUnit;
  viewWeek: string;
  loggedFor: string;
}): boolean {
  if (!isYmd(input.loggedFor)) return false;
  if (input.kind === "one_time" || input.cadence_unit === "weekly") {
    return weekOfYmd(input.loggedFor) !== input.viewWeek;
  }
  return (
    periodStartFor(input.cadence_unit, input.loggedFor) !==
    periodStartFor(input.cadence_unit, input.viewWeek)
  );
}
