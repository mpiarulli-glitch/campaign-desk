import { AGENCY_TIME_ZONE, type Preset } from "./types";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export class WindowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WindowError";
  }
}

export function isYmd(value: string): boolean {
  if (!YMD.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function diffDays(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  const n = diffDays(start, end);
  for (let i = 0; i < n; i++) out.push(addDays(start, i));
  return out;
}

export function todayInTimeZone(timeZone: string, now = new Date()): string {
  return dateKeyInZone(now.getTime(), timeZone);
}

export function dateKeyInZone(ms: number, timeZone: string): string {
  let zone = timeZone;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = AGENCY_TIME_ZONE;
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function tzOffset(utcMs: number, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - utcMs;
}

/** UTC instant of local midnight on `ymd` in `timeZone`. */
export function zonedStartIso(ymd: string, timeZone: string): string {
  let zone = timeZone || AGENCY_TIME_ZONE;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = AGENCY_TIME_ZONE;
  }
  const [y, m, d] = ymd.split("-").map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, 0, 0, 0);
  let instant = utcGuess;
  for (let i = 0; i < 2; i++) instant = utcGuess - tzOffset(instant, zone);
  return new Date(instant).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export type ResolvedWindow = {
  preset: Preset;
  start: string;
  end: string;
  previousStart: string;
  previousEnd: string;
  label: string;
  dayCount: number;
  timeZone: string;
};

function formatDay(ymd: string, withYear: boolean): string {
  const dt = new Date(`${ymd}T00:00:00Z`);
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: withYear ? "numeric" : undefined,
    timeZone: "UTC",
  });
}

export function formatRangeLabel(start: string, exclusiveEnd: string): string {
  const end = addDays(exclusiveEnd, -1);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${formatDay(start, !sameYear)} – ${formatDay(end, true)}`;
}

function bounded(start: string, end: string, preset: Preset, timeZone: string): ResolvedWindow {
  const dayCount = diffDays(start, end);
  if (dayCount < 1) throw new WindowError("The end date has to be on or after the start.");
  if (dayCount > 366) throw new WindowError("Pick a window of 366 days or less.");
  const previousEnd = start;
  const previousStart = addDays(previousEnd, -dayCount);
  return {
    preset,
    start,
    end,
    previousStart,
    previousEnd,
    label: formatRangeLabel(start, end),
    dayCount,
    timeZone,
  };
}

export function resolveWindow(input: {
  preset: Preset;
  start?: string;
  end?: string;
  today: string;
  timeZone?: string;
}): ResolvedWindow {
  const timeZone = input.timeZone || AGENCY_TIME_ZONE;
  if (input.preset === "7" || input.preset === "30" || input.preset === "90") {
    const days = Number(input.preset);
    const end = addDays(input.today, 1);
    const start = addDays(end, -days);
    return bounded(start, end, input.preset, timeZone);
  }
  const start = (input.start || "").trim();
  const endInclusive = (input.end || "").trim();
  if (!isYmd(start) || !isYmd(endInclusive)) {
    throw new WindowError("Use real start and end dates.");
  }
  if (start > endInclusive) {
    throw new WindowError("The end date has to be on or after the start.");
  }
  return bounded(start, addDays(endInclusive, 1), "custom", timeZone);
}
