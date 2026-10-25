// Pure office-floor rules. No database. The page and the tests both use this.

import { formatClockPt, formatDayPt } from "./bot-activity-time";
import {
  JUST_DONE_MS,
  isUntouchedSeed,
  statusForBot,
  timeAgo,
  type TeamStatus,
} from "./bot-activity-live";

export type PropKind = "envelope" | "flow" | "clipboard" | "globe" | "search" | "gear";

/** Small desk prop from the task text. First match wins. */
export function propForTask(text: string): PropKind {
  const s = text.toLowerCase();
  if (/email|newsletter|mail/.test(s)) return "envelope";
  if (/flow|automation|workflow|zap/.test(s)) return "flow";
  if (/basecamp|todo|task/.test(s)) return "clipboard";
  if (/dns|domain|site|cname/.test(s)) return "globe";
  if (/audit|report/.test(s)) return "search";
  return "gear";
}

export function floorSummary(counts: { working: number; need: number; idle: number; stalled: number }): string {
  const need = counts.need === 1 ? "1 needs you" : `${counts.need} need you`;
  return `${counts.working} working · ${need} · ${counts.idle} idle · ${counts.stalled} stalled`;
}

export function countFloor(
  bots: readonly string[],
  waiting: readonly { id?: string; bot: string; at?: string; updatedAt?: string }[],
  work: readonly { id?: string; bot: string; state: string; at?: string; updatedAt?: string }[],
  lines: readonly { id?: string; bot: string; at?: string; postedAt?: string }[],
  nowMs: number
): { working: number; need: number; idle: number; stalled: number } {
  const counts = { working: 0, need: 0, idle: 0, stalled: 0 };
  for (const bot of bots) {
    const status = statusForBot(bot, waiting, work, lines, nowMs);
    if (status === "Working") counts.working += 1;
    else if (status === "Blocked" || status === "Waiting on you") counts.need += 1;
    else if (status === "Stalled") counts.stalled += 1;
    else counts.idle += 1;
  }
  return counts;
}

/** Clock in Pacific plus a real relative age. */
export function timelineStamp(iso: string, nowMs: number): string {
  const clock = formatClockPt(iso);
  const ago = timeAgo(iso, nowMs);
  if (!clock) return ago;
  return ago ? `${clock} · ${ago}` : clock;
}

/** Newest event first. Days are Pacific calendar days, newest day first. */
export function groupByPacificDay<T extends { at: string }>(rows: readonly T[]): { day: string; entries: T[] }[] {
  const sorted = [...rows].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const days: { day: string; entries: T[] }[] = [];
  for (const row of sorted) {
    const day = formatDayPt(row.at);
    let group = days.find((entry) => entry.day === day);
    if (!group) {
      group = { day, entries: [] };
      days.push(group);
    }
    group.entries.push(row);
  }
  return days;
}

const DONE_WORD = /\b(done|finished|shipped|completed|complete)\b/i;

type DoneWork = { id: string; bot: string; state: string; at?: string; updatedAt?: string };
type DoneLine = { id: string; bot: string; text: string; at: string; postedAt?: string };

/**
 * Bots that just finished. A first paint only counts a done write inside
 * JUST_DONE_MS, so the October mockup does not celebrate. Later polls also
 * count a work row that moved to done, or a new timeline line that says done.
 */
export function finishedBots(
  prev: { work: readonly DoneWork[]; lines: readonly DoneLine[] } | null,
  next: { work: readonly DoneWork[]; lines: readonly DoneLine[] },
  nowMs: number
): string[] {
  const names = new Set<string>();
  if (!prev) {
    for (const item of next.work) {
      if (item.state !== "done" || isUntouchedSeed(item)) continue;
      const then = Date.parse(item.updatedAt || "");
      if (Number.isFinite(then) && nowMs - then <= JUST_DONE_MS) names.add(item.bot);
    }
    for (const line of next.lines) {
      if (isUntouchedSeed(line) || !DONE_WORD.test(line.text)) continue;
      const then = Date.parse(line.postedAt || line.at);
      if (Number.isFinite(then) && nowMs - then <= JUST_DONE_MS) names.add(line.bot);
    }
  } else {
    const before = new Map(prev.work.map((item) => [item.id, item.state]));
    for (const item of next.work) {
      const prior = before.get(item.id);
      if (prior && prior !== "done" && item.state === "done") names.add(item.bot);
    }
    const seen = new Set(prev.lines.map((line) => line.id));
    for (const line of next.lines) {
      if (seen.has(line.id) || isUntouchedSeed(line) || !DONE_WORD.test(line.text)) continue;
      const then = Date.parse(line.postedAt || line.at);
      if (Number.isFinite(then) && nowMs - then <= JUST_DONE_MS) names.add(line.bot);
    }
  }
  return [...names];
}

export function needsAttention(status: TeamStatus): boolean {
  return status === "Blocked" || status === "Waiting on you";
}
