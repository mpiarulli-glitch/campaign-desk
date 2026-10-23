// Pure rules for the Video Editing Team production schedule.
//
// Campaign Desk books shoots locally. This module decides two things without
// talking to Basecamp: whether a schedule entry makes a videographer busy, and
// what a production looks like once it is written onto that schedule.
//
// Entries on the PRODUCTION SCHEDULE are a mix of shoots and time off. Shoots
// usually name the client. Time off shows up as OOO, PTO, Off, "out of office",
// or "time off", often with the person's name in the summary and sometimes with
// them as a participant. Recurring series come back once, with a recurrence
// schedule, and the occurrences have to be expanded for the window in question.

import { BOOKING_SLOTS } from "./scheduling-rules";
import { scheduleEntryTimes, zonedLocalToUtc } from "./forecast-time";

export const SCHEDULE_TIME_ZONE = "America/Los_Angeles";
export const VIDEO_EDITING_PROJECT_ID =
  process.env.BASECAMP_VIDEO_EDITING_PROJECT_ID || "31034042";
export const PRODUCTION_SCHEDULE_ID =
  process.env.BASECAMP_PRODUCTION_SCHEDULE_ID || "5704230343";

export const FULL_DAY_START = "09:00";
export const FULL_DAY_END = "17:30";
const HALF_DAY_HOURS = 4;
const FULL_DAY_HOURS = 8.5;

export interface ScheduleRecurrence {
  frequency: string;
  days: number[];
  hour: number | null;
  minute: number | null;
  weekInstance: number | null;
  weekInterval: number | null;
  monthInterval: number | null;
  startDate: string;
  endDate: string | null;
}

export interface ProductionScheduleEntry {
  id: string;
  summary: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  participantIds: number[];
  participantNames: string[];
  recurrence: ScheduleRecurrence | null;
}

export interface TimeRange {
  startMs: number;
  endMs: number;
}

export function nameTokens(value: string): string[] {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

/** True when two people-names are the same person, including a bare first name. */
export function namesMatch(a: string, b: string): boolean {
  const left = nameTokens(a);
  const right = nameTokens(b);
  if (!left.length || !right.length) return false;
  if (left.join(" ") === right.join(" ")) return true;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  if (shorter.length === 1) return longer[0] === shorter[0];
  return shorter.every((token) => longer.includes(token));
}

/**
 * Time off, the way this schedule is actually written.
 *
 * OOO, PTO, "out of office", "time off", "day off", vacation, and a standalone
 * "Off". "Off-site" and "office" are shoots and places, not days off.
 */
export function isTimeOffTitle(title: string): boolean {
  const raw = (title || "").replace(/<[^>]+>/g, " ");
  if (/\bO\.?O\.?O\.?\b/i.test(raw)) return true;
  if (/\bPTOs?\b/i.test(raw)) return true;
  if (/out[-\s]+of[-\s]+(the[-\s]+)?office/i.test(raw)) return true;
  if (/\btime[-\s]?off\b/i.test(raw)) return true;
  if (/\bdays?\s+off\b/i.test(raw)) return true;
  if (/\bvacation\b/i.test(raw)) return true;
  if (/\bunavailable\b/i.test(raw)) return true;
  const stripped = raw.replace(/off[-\s]?site/gi, " ");
  return /(?:^|[^a-z0-9])off(?:[^a-z0-9]|$)/i.test(stripped);
}

/**
 * Whether a time-off summary names this videographer.
 *
 * A full name wins. A bare first name matches too, and if two videographers
 * share it, both match — booking either of them on "Chris OOO" would be a
 * guess. A different person's last name in the same summary does not.
 */
export function titleNamesVideographer(
  title: string,
  videographerName: string,
  allVideographerNames: string[]
): boolean {
  const words = new Set(nameTokens(title));
  const parts = nameTokens(videographerName);
  if (!parts.length) return false;
  if (parts.every((part) => words.has(part))) return true;
  const first = parts[0];
  if (first.length < 3 || !words.has(first)) return false;
  const last = parts[parts.length - 1];
  if (parts.length > 1 && !words.has(last)) {
    const others = allVideographerNames
      .filter((name) => name.trim().toLowerCase() !== videographerName.trim().toLowerCase())
      .map((name) => {
        const tokens = nameTokens(name);
        return tokens[tokens.length - 1];
      })
      .filter((token) => token && token !== first);
    if (others.some((token) => words.has(token))) return false;
  }
  return true;
}

export function entryAppliesToVideographer(
  entry: ProductionScheduleEntry,
  videographerName: string,
  personId: number | null,
  allVideographerNames: string[]
): boolean {
  if (!videographerName.trim() && personId == null) return false;
  if (personId != null && entry.participantIds.includes(personId)) return true;
  if (
    videographerName.trim() &&
    entry.participantNames.some((name) => namesMatch(name, videographerName))
  ) {
    return true;
  }
  if (!videographerName.trim()) return false;
  return (
    isTimeOffTitle(entry.summary) &&
    titleNamesVideographer(entry.summary, videographerName, allVideographerNames)
  );
}

function addDaysYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  return Math.round(
    (Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86_400_000
  );
}

function weekday(ymd: string): number {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function ymd(year: number, monthIndex: number, day: number): string {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

function calendarDate(value: string, allDay: boolean, timeZone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (allDay && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function allDayRange(startYmd: string, endYmd: string, timeZone: string): TimeRange | null {
  const start = zonedLocalToUtc(startYmd, "00:00", timeZone);
  const end = zonedLocalToUtc(addDaysYmd(endYmd, 1), "00:00", timeZone);
  if (!start || !end || end.getTime() <= start.getTime()) return null;
  return { startMs: start.getTime(), endMs: end.getTime() };
}

function entrySpanDays(entry: ProductionScheduleEntry, timeZone: string): number {
  const start = calendarDate(entry.startsAt, entry.allDay, timeZone);
  const end = calendarDate(entry.endsAt, entry.allDay, timeZone) || start;
  if (!start || !end) return 1;
  return Math.max(1, daysBetween(start, end) + 1);
}

function timedDurationMs(entry: ProductionScheduleEntry): number {
  const start = Date.parse(entry.startsAt);
  const end = Date.parse(entry.endsAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 60 * 60 * 1000;
  return end - start;
}

function clockFromEntry(
  entry: ProductionScheduleEntry,
  timeZone: string
): { hour: number; minute: number } {
  const recurrence = entry.recurrence;
  if (recurrence && recurrence.hour != null && recurrence.minute != null) {
    return { hour: recurrence.hour, minute: recurrence.minute };
  }
  const date = new Date(entry.startsAt);
  if (Number.isNaN(date.getTime())) return { hour: 9, minute: 0 };
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return {
    hour: Number(parts.find((part) => part.type === "hour")?.value || 0),
    minute: Number(parts.find((part) => part.type === "minute")?.value || 0),
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function occurrenceRangeOn(
  entry: ProductionScheduleEntry,
  date: string,
  timeZone: string
): TimeRange | null {
  if (entry.allDay) {
    const span = entrySpanDays(entry, timeZone);
    return allDayRange(date, addDaysYmd(date, span - 1), timeZone);
  }
  const clock = clockFromEntry(entry, timeZone);
  const start = zonedLocalToUtc(date, `${pad(clock.hour)}:${pad(clock.minute)}`, timeZone);
  if (!start) return null;
  return { startMs: start.getTime(), endMs: start.getTime() + timedDurationMs(entry) };
}

function singleEntryRange(entry: ProductionScheduleEntry, timeZone: string): TimeRange | null {
  if (entry.allDay) {
    const start = calendarDate(entry.startsAt, true, timeZone);
    const end = calendarDate(entry.endsAt, true, timeZone) || start;
    if (!start) return null;
    return allDayRange(start, end < start ? start : end, timeZone);
  }
  const start = Date.parse(entry.startsAt);
  const end = Date.parse(entry.endsAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return null;
  return { startMs: start, endMs: end };
}

/**
 * Weekly series, including every other week and a custom week interval.
 *
 * Basecamp's `days` are 0=Sunday … 6=Saturday. An empty list means "the
 * weekday the series started on". The week containing `start_date` is week 0,
 * so a Tuesday/Thursday series still blocks Thursday of that first week.
 */
function weekStepDates(
  recurrence: ScheduleRecurrence,
  from: string,
  to: string,
  stepWeeks: number
): string[] {
  const seriesStart = recurrence.startDate;
  if (stepWeeks < 1 || seriesStart > to) return [];
  const listed = recurrence.days.filter((day) => day >= 0 && day <= 6);
  const weekdays = listed.length ? listed : [weekday(seriesStart)];
  const seriesWeekStart = addDaysYmd(seriesStart, -weekday(seriesStart));
  const scanFrom = seriesStart > from ? seriesStart : from;
  return eachDate(scanFrom, to, (date) => {
    if (!weekdays.includes(weekday(date))) return false;
    const weeks = daysBetween(seriesWeekStart, addDaysYmd(date, -weekday(date))) / 7;
    return weeks >= 0 && weeks % stepWeeks === 0;
  });
}

function eachDate(from: string, to: string, accept: (ymd: string) => boolean): string[] {
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= to && dates.length < 500) {
    if (accept(cursor)) dates.push(cursor);
    cursor = addDaysYmd(cursor, 1);
  }
  return dates;
}

function nthWeekday(year: number, monthIndex: number, dow: number, instance: number): string | null {
  if (instance === -1) {
    const last = new Date(Date.UTC(year, monthIndex + 1, 0));
    const delta = (last.getUTCDay() - dow + 7) % 7;
    return ymd(year, monthIndex, last.getUTCDate() - delta);
  }
  if (instance < 1 || instance > 5) return null;
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const delta = (dow - first.getUTCDay() + 7) % 7;
  const day = 1 + delta + (instance - 1) * 7;
  const dim = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  if (day > dim) return null;
  return ymd(year, monthIndex, day);
}

function monthDates(
  recurrence: ScheduleRecurrence,
  from: string,
  to: string
): string[] {
  const [sy, sm] = recurrence.startDate.split("-").map(Number);
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const interval =
    recurrence.frequency === "custom_month"
      ? Math.max(2, recurrence.monthInterval || 2)
      : 1;
  const startIndex = sy * 12 + (sm - 1);
  const fromIndex = fy * 12 + (fm - 1);
  const toIndex = ty * 12 + (tm - 1);
  const dates: string[] = [];
  for (let index = fromIndex; index <= toIndex; index++) {
    if ((index - startIndex) % interval !== 0) continue;
    const year = Math.floor(index / 12);
    const month = index % 12;
    let date: string | null = null;
    if (recurrence.weekInstance != null) {
      const dow = recurrence.days[0] ?? weekday(recurrence.startDate);
      date = nthWeekday(year, month, dow, recurrence.weekInstance);
    } else {
      const day = Number(recurrence.startDate.slice(8, 10));
      const dim = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      if (day <= dim) date = ymd(year, month, day);
    }
    if (date && date >= from && date <= to && date >= recurrence.startDate) dates.push(date);
  }
  return dates;
}

function recurrenceDates(
  recurrence: ScheduleRecurrence,
  rangeStart: string,
  rangeEnd: string
): string[] {
  const seriesStart = recurrence.startDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(seriesStart)) return [];
  const to = recurrence.endDate && recurrence.endDate < rangeEnd ? recurrence.endDate : rangeEnd;
  const from = addDaysYmd(rangeStart, -2);
  if (seriesStart > to) return [];
  const frequency = recurrence.frequency;
  const days = recurrence.days.filter((day) => day >= 0 && day <= 6);

  if (frequency === "every_day" || frequency === "every_weekday") {
    return eachDate(seriesStart > from ? seriesStart : from, to, (date) => {
      if (date < seriesStart) return false;
      const dow = weekday(date);
      if (frequency === "every_weekday") return dow >= 1 && dow <= 5;
      if (days.length) return days.includes(dow);
      return true;
    });
  }
  if (frequency === "every_week") return weekStepDates(recurrence, from, to, 1);
  if (frequency === "every_other_week") return weekStepDates(recurrence, from, to, 2);
  if (frequency === "custom_week") {
    const weeks = Math.min(12, Math.max(2, recurrence.weekInterval || 2));
    return weekStepDates(recurrence, from, to, weeks);
  }
  if (
    frequency === "every_month" ||
    frequency === "every_day_of_month" ||
    frequency === "custom_month"
  ) {
    return monthDates(recurrence, seriesStart > from ? seriesStart : from, to);
  }
  if (frequency === "every_year") {
    const monthDay = seriesStart.slice(5);
    const dates: string[] = [];
    const startYear = Number(from.slice(0, 4));
    const endYear = Number(to.slice(0, 4));
    for (let year = startYear; year <= endYear; year++) {
      const date = `${year}-${monthDay}`;
      if (date >= seriesStart && date >= from && date <= to) dates.push(date);
    }
    return dates;
  }
  return [];
}

/** Concrete intervals of an entry inside a date window, including recurrences. */
export function occurrenceRanges(
  entry: ProductionScheduleEntry,
  rangeStart: string,
  rangeEnd: string,
  timeZone = SCHEDULE_TIME_ZONE
): TimeRange[] {
  if (!entry.recurrence) {
    const range = singleEntryRange(entry, timeZone);
    if (!range) return [];
    const window = allDayRange(rangeStart, rangeEnd, timeZone);
    if (!window || !rangesOverlap(range, window)) return [];
    return [range];
  }
  const dates = recurrenceDates(entry.recurrence, rangeStart, rangeEnd);
  // An unknown frequency still occupies its concrete start and end. Dropping
  // it would treat a shoot we could not expand as free time.
  if (!dates.length) {
    const range = singleEntryRange(entry, timeZone);
    if (!range) return [];
    const window = allDayRange(rangeStart, rangeEnd, timeZone);
    if (!window || !rangesOverlap(range, window)) return [];
    return [range];
  }
  const ranges: TimeRange[] = [];
  for (const date of dates) {
    const range = entry.allDay
      ? occurrenceRangeOn({ ...entry, allDay: true }, date, timeZone)
      : occurrenceRangeOn(entry, date, timeZone);
    if (range) ranges.push(range);
  }
  return ranges;
}

export function productionSlotRange(
  date: string,
  time: string,
  duration: "half" | "full",
  timeZone = SCHEDULE_TIME_ZONE
): TimeRange | null {
  const full = duration === "full" || !time;
  const startTime = full ? FULL_DAY_START : time;
  const start = zonedLocalToUtc(date, startTime, timeZone);
  if (!start) return null;
  const hours = full ? FULL_DAY_HOURS : HALF_DAY_HOURS;
  return { startMs: start.getTime(), endMs: start.getTime() + hours * 3_600_000 };
}

export function datesBetween(start: string, end: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
    return [];
  }
  return eachDate(start, end, () => true);
}

export interface ScheduleBlocks {
  blockedHalfSlots: string[];
  blockedFullDays: string[];
}

/**
 * Slots a videographer cannot take because a schedule entry already has them.
 *
 * `blockedHalfSlots` are `YYYY-MM-DD|HH:MM` for a four-hour start. A date in
 * `blockedFullDays` overlaps 9:00–5:30.
 */
export function blockedSlotsForVideographer(input: {
  entries: ProductionScheduleEntry[];
  videographerName: string;
  personId: number | null;
  allVideographerNames: string[];
  dates: string[];
  excludeEntryId?: string;
  timeZone?: string;
}): ScheduleBlocks {
  const timeZone = input.timeZone || SCHEDULE_TIME_ZONE;
  const dates = [...new Set(input.dates)].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  if (!dates.length || !input.videographerName.trim()) {
    return { blockedHalfSlots: [], blockedFullDays: [] };
  }
  const relevant = input.entries.filter(
    (entry) =>
      entry.id !== (input.excludeEntryId || "") &&
      entryAppliesToVideographer(
        entry,
        input.videographerName,
        input.personId,
        input.allVideographerNames
      )
  );
  const ranges = relevant.flatMap((entry) =>
    occurrenceRanges(entry, dates[0], dates[dates.length - 1], timeZone)
  );
  const blockedHalfSlots: string[] = [];
  const blockedFullDays: string[] = [];
  for (const date of dates) {
    for (const slot of BOOKING_SLOTS) {
      const window = productionSlotRange(date, slot, "half", timeZone);
      if (window && ranges.some((range) => rangesOverlap(range, window))) {
        blockedHalfSlots.push(`${date}|${slot}`);
      }
    }
    const full = productionSlotRange(date, FULL_DAY_START, "full", timeZone);
    if (full && ranges.some((range) => rangesOverlap(range, full))) {
      blockedFullDays.push(date);
    }
  }
  return { blockedHalfSlots, blockedFullDays };
}

export function slotIsBlocked(
  blocks: ScheduleBlocks,
  date: string,
  time: string,
  duration: "half" | "full"
): boolean {
  if (duration === "full" || !time) return blocks.blockedFullDays.includes(date);
  return blocks.blockedHalfSlots.includes(`${date}|${time}`);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clockLabel(hhmm: string): string {
  const [hourRaw, minuteRaw] = hhmm.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw || 0);
  if (!Number.isFinite(hour)) return hhmm;
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return minute ? `${hour12}:${pad(minute)} ${period}` : `${hour12} ${period}`;
}

export function productionTypeLabel(duration: string): string {
  return duration === "full" ? "Full day" : "Half day";
}

/** Summary, description, and times for one production on the Basecamp schedule. */
export function buildProductionScheduleContent(input: {
  clientName: string;
  duration: string;
  location: string;
  date: string;
  time: string;
  productionUrl: string;
  campaignUrl?: string;
  campaignTitle?: string;
  videographerNames?: string[];
  timeZone?: string;
}): {
  summary: string;
  description: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
} {
  const timeZone = input.timeZone || SCHEDULE_TIME_ZONE;
  const type = productionTypeLabel(input.duration);
  const location = input.location.trim();
  const summary = `${input.clientName.trim() || "Production"} — ${type}`.slice(0, 999);
  const timed = input.duration === "full" || !input.time.trim()
    ? scheduleEntryTimes({ date: input.date, startTime: FULL_DAY_START, hours: FULL_DAY_HOURS, timeZone })
    : scheduleEntryTimes({ date: input.date, startTime: input.time, hours: HALF_DAY_HOURS, timeZone });
  const when = input.time.trim() && input.duration !== "full"
    ? `${input.date} · ${clockLabel(input.time)}`
    : input.duration === "full"
      ? `${input.date} · ${clockLabel(FULL_DAY_START)}–${clockLabel(FULL_DAY_END)}`
      : `${input.date} · ${clockLabel(FULL_DAY_START)}–${clockLabel(FULL_DAY_END)}`;
  const lines = [
    `<strong>Client:</strong> ${escapeHtml(input.clientName.trim() || "Production")}`,
    `<strong>Production:</strong> ${escapeHtml(type === "Full day" ? "Full day (9:00 AM–5:30 PM)" : "Half day (4 hours)")}`,
  ];
  if (location) lines.push(`<strong>Location:</strong> ${escapeHtml(location)}`);
  const crew = (input.videographerNames || []).map((name) => name.trim()).filter(Boolean);
  if (crew.length) lines.push(`<strong>Videographer:</strong> ${escapeHtml(crew.join(", "))}`);
  lines.push(`<strong>When:</strong> ${escapeHtml(when)}`);
  if (input.productionUrl) {
    lines.push(
      `<a href="${escapeHtml(input.productionUrl)}">Open this production in Campaign Desk</a>`
    );
  }
  if (input.campaignUrl) {
    const label = input.campaignTitle?.trim()
      ? `Open campaign: ${input.campaignTitle.trim()}`
      : "Open the campaign in Campaign Desk";
    lines.push(`<a href="${escapeHtml(input.campaignUrl)}">${escapeHtml(label)}</a>`);
  }
  return {
    summary,
    description: `<div>${lines.join("<br>")}</div>`,
    startsAt: timed.startsAt,
    endsAt: timed.endsAt,
    allDay: false,
  };
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** One Basecamp schedule-entry payload, or null when it has no time we can use. */
export function parseScheduleEntry(raw: unknown): ProductionScheduleEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  const id = entry.id != null ? String(entry.id) : "";
  const startsAt = typeof entry.starts_at === "string" ? entry.starts_at : "";
  const endsAt = typeof entry.ends_at === "string" ? entry.ends_at : "";
  if (!id || !startsAt) return null;
  const participants = Array.isArray(entry.participants) ? entry.participants : [];
  const participantIds: number[] = [];
  const participantNames: string[] = [];
  for (const person of participants) {
    if (!person || typeof person !== "object") continue;
    const row = person as { id?: unknown; name?: unknown };
    if (typeof row.id === "number") participantIds.push(row.id);
    if (typeof row.name === "string" && row.name.trim()) participantNames.push(row.name.trim());
  }
  const summary =
    (typeof entry.summary === "string" && entry.summary.trim()) ||
    (typeof entry.title === "string" && entry.title.trim()) ||
    "";
  let recurrence: ScheduleRecurrence | null = null;
  const rawRecurrence = entry.recurrence_schedule;
  if (rawRecurrence && typeof rawRecurrence === "object") {
    const rec = rawRecurrence as Record<string, unknown>;
    const startDate = typeof rec.start_date === "string" ? rec.start_date.slice(0, 10) : "";
    if (typeof rec.frequency === "string" && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      recurrence = {
        frequency: rec.frequency,
        days: Array.isArray(rec.days)
          ? rec.days.filter((day): day is number => typeof day === "number")
          : [],
        hour: asNumber(rec.hour),
        minute: asNumber(rec.minute),
        weekInstance: asNumber(rec.week_instance),
        weekInterval: asNumber(rec.week_interval),
        monthInterval: asNumber(rec.month_interval),
        startDate,
        endDate:
          typeof rec.end_date === "string" && /^\d{4}-\d{2}-\d{2}/.test(rec.end_date)
            ? rec.end_date.slice(0, 10)
            : null,
      };
    }
  }
  return {
    id,
    summary,
    startsAt,
    endsAt: endsAt || startsAt,
    allDay: Boolean(entry.all_day),
    participantIds,
    participantNames,
    recurrence,
  };
}
