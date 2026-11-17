// Countdown beside a booking button.
//
// A real deadline (slot hold, booking-window close, offer expiry) wins when
// the caller has one. Otherwise each visit gets a hold that starts when the
// page loads and survives refresh via sessionStorage. Hitting zero is a
// message only: booking stays available.

export const BOOKING_HOLD_MS = 10 * 60 * 1000;

/** sessionStorage key for the production scheduling page. Other pages pass their own. */
export const SCHEDULE_BOOKING_HOLD_KEY = "campaign-desk:schedule-booking-hold";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type BookingCountdownMode = "deadline" | "hold";

export type BookingCountdownSnapshot = {
  mode: BookingCountdownMode;
  startedAt: number | null;
  deadlineAt: number | null;
  remainingMs: number;
  expired: boolean;
  clock: string;
  label: string;
  announcement: string;
  /** Hold start to persist. Null when a deadline drives the clock, so a hold is not written. */
  persistStartedAt: number | null;
};

export function readHoldStartedAt(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** ISO timestamp or epoch ms. Anything else is "no deadline", and the hold is used. */
export function parseDeadline(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatCountdownClock(remainingMs: number): string {
  const whole = Math.max(0, Math.floor(remainingMs / 1000));
  const days = Math.floor(whole / 86400);
  const hours = Math.floor((whole % 86400) / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  if (days > 0) return `${days}d ${hours}h ${pad(minutes)}m`;
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Spoken form of the countdown. It changes when the remaining minute changes,
 * not every second, so an aria-live region can read it without chatter.
 */
export function countdownAnnouncement(input: {
  mode: BookingCountdownMode;
  remainingMs: number;
  expired: boolean;
}): string {
  if (input.expired) {
    return input.mode === "deadline"
      ? "This deadline has passed. You can still book."
      : "This hold has ended. You can still book.";
  }
  const remaining = Math.max(0, input.remainingMs);
  if (input.mode === "deadline" && remaining >= DAY_MS) {
    const days = Math.floor(remaining / DAY_MS);
    const hours = Math.floor((remaining % DAY_MS) / HOUR_MS);
    if (hours === 0) return `Booking closes in ${plural(days, "day")}.`;
    return `Booking closes in ${plural(days, "day")} and ${plural(hours, "hour")}.`;
  }
  if (input.mode === "deadline" && remaining >= HOUR_MS) {
    const hours = Math.floor(remaining / HOUR_MS);
    const minutes = Math.floor((remaining % HOUR_MS) / MINUTE_MS);
    if (minutes === 0) return `Booking closes in ${plural(hours, "hour")}.`;
    return `Booking closes in ${plural(hours, "hour")} and ${plural(minutes, "minute")}.`;
  }
  const minutesLeft = Math.max(1, Math.ceil(remaining / MINUTE_MS));
  const phrase = plural(minutesLeft, "minute");
  if (input.mode === "deadline") return `Booking closes in ${phrase}.`;
  return `Your spot is held for ${phrase}.`;
}

function holdDuration(durationMs: number | undefined): number {
  if (typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0) {
    return durationMs;
  }
  return BOOKING_HOLD_MS;
}

export function resolveBookingCountdown(input: {
  now: number;
  deadlineAt?: number | null;
  storedStartedAt?: number | null;
  durationMs?: number;
}): BookingCountdownSnapshot {
  const now = input.now;
  const deadlineAt =
    typeof input.deadlineAt === "number" && Number.isFinite(input.deadlineAt)
      ? input.deadlineAt
      : null;

  if (deadlineAt != null) {
    const remainingMs = Math.max(0, deadlineAt - now);
    const expired = remainingMs <= 0;
    const mode: BookingCountdownMode = "deadline";
    return {
      mode,
      startedAt: null,
      deadlineAt,
      remainingMs,
      expired,
      clock: formatCountdownClock(remainingMs),
      label: "Booking closes in",
      announcement: countdownAnnouncement({ mode, remainingMs, expired }),
      persistStartedAt: null,
    };
  }

  const durationMs = holdDuration(input.durationMs);
  const stored = input.storedStartedAt;
  const storedOk = typeof stored === "number" && Number.isFinite(stored) && stored > 0 && stored <= now;
  const startedAt = storedOk ? stored : now;
  const remainingMs = Math.max(0, startedAt + durationMs - now);
  const expired = remainingMs <= 0;
  const mode: BookingCountdownMode = "hold";
  return {
    mode,
    startedAt,
    deadlineAt: null,
    remainingMs,
    expired,
    clock: formatCountdownClock(remainingMs),
    label: "Your spot is held for",
    announcement: countdownAnnouncement({ mode, remainingMs, expired }),
    persistStartedAt: startedAt,
  };
}

/** Expired is a message. It never removes the ability to book. */
export function countdownAllowsBooking(snapshot: BookingCountdownSnapshot): boolean {
  if (snapshot.expired) return true;
  return true;
}
