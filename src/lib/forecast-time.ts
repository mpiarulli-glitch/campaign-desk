// Clock times on forecast tasks, stored as 24-hour "HH:MM". New tasks always
// have one so the week calendar shows when the work is happening.

export const CAL_START_HOUR = 7;
export const CAL_END_HOUR = 19;
export const CAL_PX_PER_HOUR = 52;
// Used when Basecamp has no clock time (all-day meetings) or someone adds
// from the leftover tray instead of clicking an hour.
export const DEFAULT_START_TIME = "09:00";

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
