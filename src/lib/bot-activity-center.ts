// Command-center counts. Every number is a real row. No database imports.

import { rowCountsLive, statusForBot, type TeamStatus } from "./bot-activity-live";

type Beat = { id?: string; bot: string; at?: string; updatedAt?: string; postedAt?: string };
type WorkBeat = Beat & { state: string };

export type CenterCounts = { running: number; pending: number; paused: number };

/** Hour in America/Los_Angeles, 0–23. */
export function pacificHour(nowMs: number): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(new Date(nowMs));
  const n = Number(hour);
  return Number.isFinite(n) ? n % 24 : 0;
}

export function greeting(nowMs: number): string {
  const hour = pacificHour(nowMs);
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return `Good ${part}, Michael.`;
}

/**
 * Pending is live items that need Michael: an open question or a blocked task
 * whose row still counts. Untouched seed rows stay out of the number.
 * Paused is bots that are blocked or stalled. Running is bots Working now.
 */
export function centerCounts(
  bots: readonly string[],
  waiting: readonly Beat[],
  work: readonly WorkBeat[],
  lines: readonly Beat[],
  nowMs: number
): CenterCounts {
  let pending = 0;
  for (const item of waiting) {
    if (rowCountsLive(item, nowMs)) pending += 1;
  }
  for (const item of work) {
    if (item.state === "blocked" && rowCountsLive(item, nowMs)) pending += 1;
  }
  let running = 0;
  let paused = 0;
  for (const bot of bots) {
    const status = statusForBot(bot, waiting, work, lines, nowMs);
    if (status === "Working") running += 1;
    else if (status === "Blocked" || status === "Stalled") paused += 1;
  }
  return { running, pending, paused };
}

export function orbLabel(running: number): string {
  if (running <= 0) return "All quiet";
  return running === 1 ? "Bot Running" : "Bots Running";
}

export function centerSubline(counts: CenterCounts): string {
  if (counts.pending > 0) {
    return counts.pending === 1 ? "1 item needs you" : `${counts.pending} items need you`;
  }
  if (counts.running > 0) return "Your AI team is running smoothly";
  if (counts.paused > 0) {
    return counts.paused === 1 ? "1 bot is paused" : `${counts.paused} bots are paused`;
  }
  return "Your AI team is standing by";
}

/** Card status. Working reads as Running, matching the command center. */
export function cardStatusLabel(status: TeamStatus): string {
  if (status === "Working") return "Running";
  if (status === "Waiting on you") return "Needs you";
  return status;
}

export function cardTone(status: TeamStatus): "running" | "needs" | "blocked" | "idle" | "stalled" {
  if (status === "Working") return "running";
  if (status === "Waiting on you") return "needs";
  if (status === "Blocked") return "blocked";
  if (status === "Stalled") return "stalled";
  return "idle";
}
