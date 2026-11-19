/**
 * Display times in the business timezone.
 *
 * Date-only values (a calendar day with no clock) must not come through here.
 * These helpers are for instants: created_at, updated_at, sent_at. Formatting
 * those in the viewer's zone made a Pacific evening look like the next morning
 * for anyone whose laptop was on UTC.
 *
 * Built from formatToParts so the string does not depend on the narrow space
 * some engines put before AM/PM.
 */

import { APP_TIME_ZONE } from "./period";

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const DATE_ONLY = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
});

const DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  month: "short",
  day: "numeric",
});

function parts(fmt: Intl.DateTimeFormat, iso: string): Record<string, string> | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(d)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return map;
}

/** "Nov 18, 2026, 8:00 PM PT" */
export function formatAppDateTime(iso: string | null | undefined): string {
  const p = parts(DATE_TIME, iso || "");
  if (!p?.month || !p.day || !p.year || !p.hour) return "";
  return `${p.month} ${p.day}, ${p.year}, ${p.hour}:${p.minute || "00"} ${p.dayPeriod || ""} PT`.replace(
    /\s+/g,
    " "
  );
}

/** "Nov 18, 2026" in Pacific, for an instant rather than a calendar day. */
export function formatAppDate(iso: string | null | undefined): string {
  const p = parts(DATE_ONLY, iso || "");
  if (!p?.month || !p.day || !p.year) return "";
  return `${p.month} ${p.day}, ${p.year}`;
}

/** "Nov 18" in Pacific. Compact label for an instant. */
export function formatAppDay(iso: string | null | undefined): string {
  const p = parts(DAY, iso || "");
  if (!p?.month || !p.day) return "";
  return `${p.month} ${p.day}`;
}
