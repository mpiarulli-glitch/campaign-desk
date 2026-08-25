// Clock times on forecast tasks, stored as 24-hour "HH:MM". Optional: a blank
// start leaves the row in the unscheduled tray instead of on the hour grid.

export const CAL_START_HOUR = 7;
export const CAL_END_HOUR = 19;
export const CAL_PX_PER_HOUR = 64;
// Everything the calendar places lands on a quarter hour. Fine enough that a
// 45-minute block can start at 9:15, coarse enough that a dropped block never
// ends up at 10:07 because of where a cursor happened to be.
export const CAL_SNAP_MINUTES = 15;

export function padTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function minutesFromMidnight(hhmm: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec((hhmm || "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function parseTimeInput(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return "";
  const ampm = s.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]m)$/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const min = Number(ampm[2] || 0);
    const ap = ampm[3].toLowerCase();
    if (h < 1 || h > 12 || min > 59) return "";
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    return padTime(h, min);
  }
  const hm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!hm) return "";
  const h = Number(hm[1]);
  const min = Number(hm[2]);
  if (h > 23 || min > 59) return "";
  return padTime(h, min);
}

export function addHoursToTime(hhmm: string, hours: number): string {
  const start = minutesFromMidnight(hhmm);
  if (start == null || !Number.isFinite(hours)) return "";
  const span = Math.round(hours * 60);
  const end = ((start + span) % (24 * 60) + 24 * 60) % (24 * 60);
  return padTime(Math.floor(end / 60), end % 60);
}

export function formatTimeLabel(hhmm: string): string {
  const mins = minutesFromMidnight(hhmm);
  if (mins == null) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")} ${period}` : `${h12} ${period}`;
}

export function isoToStartTime(iso: string, timeZone: string): string {
  if (!iso || /^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const hour = parts.find((p) => p.type === "hour")?.value;
  const minute = parts.find((p) => p.type === "minute")?.value;
  if (hour == null || minute == null) return "";
  return padTime(Number(hour), Number(minute));
}

export type LaidOutBlock<T> = {
  item: T;
  startMin: number;
  endMin: number;
  col: number;
  cols: number;
};

export function layoutTimedBlocks<T>(
  items: T[],
  getStart: (item: T) => string,
  getHours: (item: T) => number
): LaidOutBlock<T>[] {
  const timed = items
    .map((item) => {
      const startMin = minutesFromMidnight(getStart(item));
      if (startMin == null) return null;
      const dur = Math.max(30, Math.round((Number(getHours(item)) || 0) * 60));
      return { item, startMin, endMin: startMin + dur };
    })
    .filter((b): b is { item: T; startMin: number; endMin: number } => Boolean(b))
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const colEnds: number[] = [];
  const placed = timed.map((b) => {
    let col = colEnds.findIndex((end) => end <= b.startMin);
    if (col < 0) {
      col = colEnds.length;
      colEnds.push(b.endMin);
    } else {
      colEnds[col] = b.endMin;
    }
    return { ...b, col };
  });

  return placed.map((b) => {
    const overlap = placed.filter((o) => o.startMin < b.endMin && o.endMin > b.startMin);
    const cols = Math.max(1, ...overlap.map((o) => o.col + 1));
    return { ...b, cols };
  });
}

export function staggerStartTimes(start: string, hourSlices: number[]): string[] {
  const first = parseTimeInput(start);
  if (!first) return hourSlices.map(() => "");
  const out: string[] = [];
  let cursor = first;
  for (const hours of hourSlices) {
    out.push(cursor);
    cursor = addHoursToTime(cursor, hours) || cursor;
  }
  return out;
}

/* ------------------------------------------------- calendar grid geometry */

export function minutesToTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  return padTime(Math.floor(clamped / 60), clamped % 60);
}

export function snapMinutes(minutes: number, snap = CAL_SNAP_MINUTES): number {
  return Math.round(minutes / snap) * snap;
}

/**
 * Where a pointer at `y` pixels down the day column lands, as "HH:MM".
 *
 * `grabOffsetMin` is how far into a dragged block the pointer had hold of it, so
 * grabbing a block by its middle and dropping puts its START where the middle
 * was picked up from, not where the cursor ended. Without that, every drag
 * quietly pushed a block later by however far down it was grabbed.
 *
 * `durationMin` keeps a block from being dropped so late that it runs off the
 * bottom of the grid, where it would be laid out but not visible.
 */
export function timeAtOffset(
  y: number,
  opts?: { grabOffsetMin?: number; durationMin?: number }
): string {
  const dayStart = CAL_START_HOUR * 60;
  const dayEnd = CAL_END_HOUR * 60;
  const duration = Math.max(0, Math.min(dayEnd - dayStart, opts?.durationMin || 0));
  const raw = dayStart + (y / CAL_PX_PER_HOUR) * 60 - (opts?.grabOffsetMin || 0);
  const snapped = snapMinutes(raw);
  return minutesToTime(Math.max(dayStart, Math.min(dayEnd - duration, snapped)));
}

// Hours a block covers if its bottom edge is dragged to `y`. Never returns less
// than one snap step, so a block can't be resized out of existence.
export function hoursFromResize(y: number, startTime: string): number {
  const start = minutesFromMidnight(startTime);
  if (start == null) return 0;
  const dayEnd = CAL_END_HOUR * 60;
  const end = CAL_START_HOUR * 60 + (y / CAL_PX_PER_HOUR) * 60;
  const minutes = Math.max(
    CAL_SNAP_MINUTES,
    Math.min(dayEnd - start, snapMinutes(end - start))
  );
  return Math.round((minutes / 60) * 100) / 100;
}

function zonedWallClock(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

// Wall clock in `timeZone` → a UTC Date. Two passes so a DST spring-forward
// still lands on the intended local hour instead of an hour earlier.
export function zonedLocalToUtc(
  dateYmd: string,
  hhmm: string,
  timeZone: string
): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd);
  const minutes = minutesFromMidnight(hhmm);
  if (!dm || minutes == null) return null;
  const year = Number(dm[1]);
  const month = Number(dm[2]);
  const day = Number(dm[3]);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  // Treat the wall clock as UTC, then subtract the zone offset of that instant.
  // Repeat so a DST boundary uses the offset of the real instant, not the guess.
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let instant = desired;
  for (let i = 0; i < 3; i++) {
    const seen = zonedWallClock(new Date(instant), timeZone);
    const wallAsUtc = Date.UTC(
      seen.year,
      seen.month - 1,
      seen.day,
      seen.hour,
      seen.minute,
      seen.second
    );
    instant = desired - (wallAsUtc - instant);
  }
  return new Date(instant);
}

// Times for a Basecamp schedule entry. A blank start is an all-day event on
// that date; otherwise start + hours in the app timezone, as UTC ISO.
export function scheduleEntryTimes(input: {
  date: string;
  startTime: string;
  hours: number;
  timeZone: string;
}): { startsAt: string; endsAt: string; allDay: boolean } {
  const startTime = parseTimeInput(input.startTime);
  if (!startTime) {
    return { startsAt: input.date, endsAt: input.date, allDay: true };
  }
  const start = zonedLocalToUtc(input.date, startTime, input.timeZone);
  if (!start) {
    return { startsAt: input.date, endsAt: input.date, allDay: true };
  }
  const hours = Number.isFinite(input.hours) && input.hours > 0 ? input.hours : 1;
  const end = new Date(start.getTime() + hours * 3_600_000);
  return {
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    allDay: false,
  };
}
