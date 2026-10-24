// Pacific wall times for Bot Activity. October 2026 is PDT (UTC-7); the
// conversion asks Intl for the zone offset so it stays right across DST.

const PT = "America/Los_Angeles";

const MONTHS: Record<string, number> = {
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12,
};

export function pacificToIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  ms = 0
): string {
  const utc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: PT,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, number> = {};
  for (const part of dtf.formatToParts(utc)) {
    if (part.type !== "literal") map[part.type] = Number(part.value);
  }
  let hourInZone = map.hour;
  let dayInZone = map.day;
  let monthInZone = map.month;
  let yearInZone = map.year;
  // A few engines report midnight as hour 24.
  if (hourInZone === 24) {
    hourInZone = 0;
    const next = new Date(Date.UTC(yearInZone, monthInZone - 1, dayInZone + 1));
    yearInZone = next.getUTCFullYear();
    monthInZone = next.getUTCMonth() + 1;
    dayInZone = next.getUTCDate();
  }
  const asUtc = Date.UTC(yearInZone, monthInZone - 1, dayInZone, hourInZone, map.minute, map.second);
  const offset = asUtc - Date.UTC(year, month - 1, day, hour, minute, 0);
  return new Date(utc.getTime() - offset + ms).toISOString();
}

function parts(iso: string): Record<string, string> {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: PT,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(iso))) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return map;
}

/** "11:32 AM" */
export function formatClockPt(iso: string): string {
  const p = parts(iso);
  return `${p.hour}:${p.minute} ${p.dayPeriod}`;
}

/** "Sat Oct 24" */
export function formatDayPt(iso: string): string {
  const p = parts(iso);
  return `${p.weekday} ${p.month} ${p.day}`;
}

/** "Fri 5:09 PM" */
export function formatWaitingWhenPt(iso: string): string {
  const p = parts(iso);
  return `${p.weekday} ${p.hour}:${p.minute} ${p.dayPeriod}`;
}

/** "Sat Oct 24, 11:32 AM PT" */
export function formatUpdatedPt(iso: string): string {
  return `${formatDayPt(iso)}, ${formatClockPt(iso)} PT`;
}

export function parseClock(when: string): { hour: number; minute: number } | null {
  const match = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(when.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const pm = match[3].toUpperCase() === "PM";
  if (hour === 12) hour = pm ? 12 : 0;
  else if (pm) hour += 12;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** Friday Oct 23, 2026 for "Fri 5:09 PM", or Oct 22 noon for "Earlier". */
export function seedWaitingInstant(when: string, index: number, total: number): string {
  const ms = (total - index) * 10;
  if (when.trim() === "Earlier") return pacificToIso(2026, 10, 22, 12, 0, ms);
  const clock = parseClock(when);
  if (!clock) throw new Error(`Unreadable waiting time: ${when}`);
  return pacificToIso(2026, 10, 23, clock.hour, clock.minute, ms);
}

/** "Sat Oct 24" + "11:32 AM" in 2026. */
export function seedTimelineInstant(
  day: string,
  when: string,
  index: number,
  total: number
): string {
  const match = /^[A-Za-z]+ ([A-Za-z]+) (\d{1,2})$/.exec(day.trim());
  const clock = parseClock(when);
  if (!match || !MONTHS[match[1]] || !clock) {
    throw new Error(`Unreadable timeline time: ${day} ${when}`);
  }
  return pacificToIso(2026, MONTHS[match[1]], Number(match[2]), clock.hour, clock.minute, (total - index) * 10);
}
