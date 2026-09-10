import type { CadenceUnit, DeliverableKind } from "./db";
import { periodEndExclusiveFor, periodStartFor } from "./snapshot-entry-date";
import { addWeeks, weekLabel } from "./week";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export const CATCH_UP_MONTH_CHOICES = [1, 2, 3, 4, 6] as const;
export const CATCH_UP_MAX_PERIODS = 53;

export type CatchUpPeriod = {
  periodStart: string;
  loggedFor: string;
};

export function clampCatchUpRange(
  fromYmd: string,
  toYmd: string,
  today: string
): { from: string; to: string } | null {
  if (!YMD.test(fromYmd) || !YMD.test(toYmd) || !YMD.test(today)) return null;
  let from = fromYmd;
  let to = toYmd;
  if (from > to) [from, to] = [to, from];
  if (to > today) to = today;
  if (from > to) return null;
  return { from, to };
}

/** First day of the month that is `months` months back, counting the current month. */
export function firstDayMonthsBack(months: number, today: string): string {
  const n = Math.max(1, Math.floor(months));
  const [y, m] = today.split("-").map(Number);
  const d = new Date(y, m - 1 - (n - 1), 1);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}-01`;
}

/**
 * Due periods in [from, to] inclusive. One-time items have no repeating due
 * dates — catch-up does not apply.
 *
 * Monthly "4 ad meetings" is still one period per month: the meetings are the
 * contracted volume inside that month, not four separate snapshot rows.
 */
export function catchUpPeriods(input: {
  kind: DeliverableKind;
  unit: CadenceUnit;
  fromYmd: string;
  toYmd: string;
  today?: string;
}): CatchUpPeriod[] {
  if (input.kind === "one_time") return [];
  const today = input.today ?? input.toYmd;
  const range = clampCatchUpRange(input.fromYmd, input.toYmd, today);
  if (!range) return [];

  const out: CatchUpPeriod[] = [];
  let cursor = periodStartFor(input.unit, range.from);
  const end = periodEndExclusiveFor(input.unit, range.to);
  while (cursor < end) {
    out.push({ periodStart: cursor, loggedFor: cursor });
    if (out.length > CATCH_UP_MAX_PERIODS) return out.slice(0, CATCH_UP_MAX_PERIODS);
    cursor = periodEndExclusiveFor(input.unit, cursor);
  }
  return out;
}

export function catchUpPeriodLabel(unit: CadenceUnit, periodStart: string): string {
  const [y, m] = periodStart.split("-").map(Number);
  if (unit === "weekly") return weekLabel(periodStart);
  if (unit === "quarterly") {
    const q = Math.floor(((m || 1) - 1) / 3) + 1;
    return `Q${q} ${y}`;
  }
  return new Date(y, (m || 1) - 1, 1).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
  });
}

export function catchUpSummary(unit: CadenceUnit, periods: CatchUpPeriod[]): string {
  if (periods.length === 0) return "Nothing in that range.";
  const first = catchUpPeriodLabel(unit, periods[0].periodStart);
  const last = catchUpPeriodLabel(unit, periods[periods.length - 1].periodStart);
  if (unit === "weekly") {
    const end = addWeeks(periods[periods.length - 1].periodStart, 1);
    const [y, m, d] = end.split("-").map(Number);
    const lastDay = new Date(y, m - 1, d - 1);
    const lastDayLabel = lastDay.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return `${periods.length} week${periods.length === 1 ? "" : "s"} (${first} through ${lastDayLabel})`;
  }
  if (first === last) {
    return `1 ${unit === "quarterly" ? "quarter" : "month"} (${first})`;
  }
  const noun = unit === "quarterly" ? "quarters" : "months";
  return `${periods.length} ${noun} (${first} – ${last})`;
}
