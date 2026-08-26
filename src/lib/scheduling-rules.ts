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

// A calendar date that exists, not merely one shaped like a date.
//
// Shape plus the window bounds is not enough. The window check compares strings,
// so for a window that spans two months "2026-09-31" sorts between "2026-09-28"
// and "2026-10-02" and passes both tests. Purple windows always span two months,
// because purple publishes in the first week and shoots the week before, so
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
