import { APP_TIME_ZONE } from "@/lib/period";

/**
 * One line for the collapsed "When these go out" header.
 *
 * "20 sends · Oct 20 – Dec 1, 2026 · Pacific · 12 of 20 scheduled"
 *
 * Dates are calendar days in the business timezone. A bare YYYY-MM-DD is
 * already a calendar day (the campaign editor stores one). An ISO instant is
 * converted into that timezone so a Pacific evening does not roll into the
 * next UTC day.
 */

type CalendarDay = { y: number; m: number; d: number };

const DAY_KEY = (day: CalendarDay) => day.y * 10000 + day.m * 100 + day.d;

function part(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes
): number {
  return Number(parts.find((p) => p.type === type)?.value || 0);
}

function calendarDay(value: string): CalendarDay | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (ymd) {
    const y = Number(ymd[1]);
    const m = Number(ymd[2]);
    const d = Number(ymd[3]);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return { y, m, d };
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = part(parts, "year");
  const m = part(parts, "month");
  const d = part(parts, "day");
  if (!y || !m || !d) return null;
  return { y, m, d };
}

function formatDay(day: CalendarDay, withYear: boolean): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" as const } : {}),
  }).format(new Date(Date.UTC(day.y, day.m - 1, day.d)));
}

function rangeLabel(days: CalendarDay[]): string {
  const sorted = [...days].sort((a, b) => DAY_KEY(a) - DAY_KEY(b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (DAY_KEY(first) === DAY_KEY(last)) return formatDay(first, true);
  if (first.y === last.y) {
    return `${formatDay(first, false)} – ${formatDay(last, true)}`;
  }
  return `${formatDay(first, true)} – ${formatDay(last, true)}`;
}

export function sendPlanSummary(
  times: Array<string | null | undefined>,
  zoneLabel = "Pacific"
): string {
  const total = times.length;
  const countLabel = `${total} ${total === 1 ? "send" : "sends"}`;
  const days = times
    .map((value) => (value ? calendarDay(value) : null))
    .filter((day): day is CalendarDay => day !== null);
  const scheduled = days.length;

  if (scheduled === 0) {
    return `${countLabel} · none scheduled · ${zoneLabel}`;
  }

  const scheduledLabel =
    scheduled === total
      ? "all scheduled"
      : `${scheduled} of ${total} scheduled`;
  return `${countLabel} · ${rangeLabel(days)} · ${zoneLabel} · ${scheduledLabel}`;
}
