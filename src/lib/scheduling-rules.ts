// Shared, side-effect-free production booking rules. Keeping these separate
// lets the browser and API enforce the same constraints and makes them easy to
// exercise without opening the database.

// Four-hour productions start on the hour and must finish by 5:30 PM.
export const BOOKING_SLOTS = [
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
];

export function slotHasPassed(
  date: string,
  time: string,
  currentDate: string,
  currentTime: string
): boolean {
  return date < currentDate || (date === currentDate && time <= currentTime);
}

export function durationAllowsStart(
  duration: "half" | "full",
  time: string
): boolean {
  return duration === "half"
    ? BOOKING_SLOTS.includes(time)
    : time === "09:00";
}

// Why a client says a production window will not work, offered as a short list
// so the answer is something the board can group and count rather than free
// text nobody reads twice. "Something else" plus the note covers the rest.
//
// Lives here, with the other rules both sides share, because the client link
// renders this list in the browser and the API validates against it. The
// database side re-exports it from lib/window-declines.
export const DECLINE_REASONS = [
  { value: "closed", label: "We are closed or away that week" },
  { value: "busy", label: "Too busy that week" },
  { value: "people", label: "The people we need will not be around" },
  { value: "location", label: "The location will not be ready" },
  { value: "other", label: "Something else" },
] as const;

export type DeclineReason = (typeof DECLINE_REASONS)[number]["value"];

export function isDeclineReason(value: unknown): value is DeclineReason {
  return DECLINE_REASONS.some((reason) => reason.value === value);
}

export function declineReasonLabel(value: string): string {
  return DECLINE_REASONS.find((reason) => reason.value === value)?.label || "Not given";
}

// A calendar date that exists, not merely one shaped like a date.
//
// Shape plus the window bounds is not enough. The window check compares strings,
// so for a window that spans two months "2026-09-31" sorts between "2026-09-28"
// and "2026-10-02" and passes both tests. Purple windows always span two months,
// because purple publishes in the first full week and shoots the week before, so
// this reached real accounts. A stored date of 2026-09-31 then rolls to 1 October
// wherever it is formatted, silently moving a shoot by a day.
export function isRealDate(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}
