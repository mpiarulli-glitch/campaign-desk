/**
 * Month keys ("2026-08") for the Deliverables board.
 *
 * This lives on its own because both halves of the board have to agree on it:
 * the server decides which month a removal sweeps from, and the page decides
 * which month the header says you are looking at. When those two disagree, you
 * remove clients from a month you are not on.
 *
 * Two rules, and both matter:
 *
 * 1. "Now" is resolved in the business timezone, never UTC. A Pacific afternoon
 *    is already tomorrow in UTC, so on the last day of a month UTC rolls the
 *    board into the next one hours early.
 * 2. A key is built from UTC midnight, so it must be read back in UTC too.
 *    Formatting `Date.UTC(2026, 7, 1)` in a Pacific browser without saying so
 *    lands on July 31 and labels the August board "July 2026".
 *
 * No imports on purpose: the page is a client component and cannot pull in
 * anything that reaches the database.
 */

export const APP_TIME_ZONE = process.env.APP_TIME_ZONE || "America/Los_Angeles";

const MONTH_KEY = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
});

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

/** The month we are actually in, in the business timezone. e.g. "2026-08". */
export function currentPeriod(now = new Date()): string {
  const parts = MONTH_KEY.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value || "";
  return `${part("year")}-${part("month")}`;
}

export function isValidPeriod(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}$/.test(v);
}

/** Period keys are zero-padded, so plain string compare is a date compare. */
export function shiftPeriod(period: string, months: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "2026-08" -> "August 2026". */
export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return MONTH_LABEL.format(new Date(Date.UTC(y, m - 1, 1)));
}
