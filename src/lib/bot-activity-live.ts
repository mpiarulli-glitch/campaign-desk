// Client-safe refresh and team-card rules for the Bot Activity page.
// No database imports: the page bundle and the node tests both use this.

import { formatClockPt } from "./bot-activity-time";

/** Quiet board refresh. Hidden tabs do not poll. */
export const BOT_ACTIVITY_POLL_MS = 5_000;

/** Cap so a failing server is not hit every 5 seconds. */
export const BOT_ACTIVITY_POLL_MAX_MS = 40_000;

export type RefreshOutcome = "ok" | "fail" | "auth";

export function pollDelayMs(consecutiveFailures: number): number {
  const steps = Math.min(Math.max(consecutiveFailures, 0), 3);
  return Math.min(BOT_ACTIVITY_POLL_MAX_MS, BOT_ACTIVITY_POLL_MS * 2 ** steps);
}

/** Same redirects as the first load: signed out, or signed in but not the owner. */
export function authRedirectForStatus(status: number): "/login" | "/admin/hub" | null {
  if (status === 401) return "/login";
  if (status === 403) return "/admin/hub";
  return null;
}

/**
 * Last successful fetch, in Pacific time. The clock is minute precision so a
 * 5 second poll does not change the label (or re-render) until the minute turns.
 */
export function fetchedLabel(at: Date): string {
  return `Fetched ${formatClockPt(at.toISOString())} PT`;
}

/** null board means the payload matches what is already on screen: do not setState. */
export function nextBoardState<T>(previousKey: string, next: T): { key: string; board: T | null } {
  const key = JSON.stringify(next);
  if (previousKey && previousKey === key) return { key: previousKey, board: null };
  return { key, board: next };
}

/**
 * A refresh must not wipe a reply that is being typed. Non-empty text stays
 * with its item id, including when that item's title or detail changes.
 * Returns the same object when nothing was dropped, so setState can bail out.
 */
export function retainReplyDrafts(drafts: Record<string, string>): Record<string, string> {
  let changed = false;
  const next: Record<string, string> = {};
  for (const [id, text] of Object.entries(drafts)) {
    if (!text) {
      changed = true;
      continue;
    }
    next[id] = text;
  }
  return changed ? next : drafts;
}

export type TeamStatus = "Blocked" | "Waiting on you" | "Working" | "Idle";

/** Blocked wins, then an open waiting item, then in-progress work, otherwise idle. */
export function statusForBot(
  bot: string,
  waiting: readonly { bot: string }[],
  work: readonly { bot: string; state: string }[]
): TeamStatus {
  const tasks = work.filter((item) => item.bot === bot);
  if (tasks.some((item) => item.state === "blocked")) return "Blocked";
  if (waiting.some((item) => item.bot === bot)) return "Waiting on you";
  if (tasks.some((item) => item.state === "progress")) return "Working";
  return "Idle";
}

export type CurrentTask = { title: string; detail: string; at: string };

/**
 * Most recent work that is not finished (in progress or blocked). If the bot
 * has none, the latest timeline line. `at` is the existing occurred_at.
 */
export function currentAssignment(
  bot: string,
  work: readonly { bot: string; title: string; detail: string; state: string; at: string }[],
  lines: readonly { bot: string; text: string; at: string }[]
): CurrentTask | null {
  let best: CurrentTask | null = null;
  for (const item of work) {
    if (item.bot !== bot || item.state === "done") continue;
    if (!best || item.at > best.at) {
      best = { title: item.title, detail: item.detail, at: item.at };
    }
  }
  if (best) return best;
  for (const line of lines) {
    if (line.bot !== bot) continue;
    if (!best || line.at > best.at) best = { title: line.text, detail: "", at: line.at };
  }
  return best;
}

/** public/bots/<lowercase name>.jpg. A missing file falls back in the page. */
export function botPortraitSrc(name: string): string {
  return `/bots/${encodeURIComponent(name.trim().toLowerCase())}.jpg`;
}

export const BOT_PORTRAIT_NAMES = [
  "jerry",
  "jessica",
  "sarah",
  "daniel",
  "thomas",
  "olivia",
  "james",
  "lincoln",
  "david",
  "zap",
  "rachel",
  "emily",
  "wes",
  "cody",
] as const;

/** Short relative label from an ISO timestamp. Empty when the timestamp is unreadable. */
export function timeAgo(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const sec = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day}d ago`;
  const week = Math.floor(day / 7);
  return `${week}w ago`;
}

/**
 * One in-flight refresh, a single timer, paused while hidden.
 * The host supplies the timer so tests can fire it without a browser.
 */
export class BotActivityRefresh<T = unknown> {
  private timer: T | null = null;
  private inFlight = false;
  private failures = 0;
  private stopped = false;
  private hidden = false;
  private started = false;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly deps: {
      setTimer: (fn: () => void, ms: number) => T;
      clearTimer: (id: T) => void;
      run: () => Promise<RefreshOutcome>;
    }
  ) {}

  start(): Promise<void> {
    if (this.started) return this.tail;
    this.started = true;
    return this.kick();
  }

  stop(): void {
    this.stopped = true;
    this.clear();
  }

  /** Hidden clears the timer. Visible again fetches immediately. */
  setHidden(hidden: boolean): Promise<void> {
    if (hidden) {
      this.hidden = true;
      this.clear();
      return this.tail;
    }
    const wasHidden = this.hidden;
    this.hidden = false;
    if (!this.started || this.stopped || !wasHidden) return this.tail;
    this.clear();
    return this.kick();
  }

  settled(): Promise<void> {
    return this.tail;
  }

  private clear(): void {
    if (this.timer != null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    if (this.stopped || this.hidden) return;
    this.clear();
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      void this.kick();
    }, pollDelayMs(this.failures));
  }

  private kick(): Promise<void> {
    if (this.stopped || this.hidden || this.inFlight) return this.tail;
    this.inFlight = true;
    const task = (async () => {
      let outcome: RefreshOutcome = "fail";
      try {
        const result = await this.deps.run();
        if (result === "ok" || result === "fail" || result === "auth") outcome = result;
      } catch {
        outcome = "fail";
      }
      this.inFlight = false;
      if (this.stopped || outcome === "auth") {
        this.stopped = true;
        this.clear();
        return;
      }
      if (outcome === "ok") this.failures = 0;
      else this.failures += 1;
      this.schedule();
    })();
    this.tail = task;
    return task;
  }
}
