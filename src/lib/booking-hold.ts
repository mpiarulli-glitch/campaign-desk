// Soft per-visitor hold shown on booking buttons. There is no slot-hold
// expiry, offer deadline, or timestamped window close on the booking
// payloads: a cadence window is a range of days the client may pick, and
// once those days pass the page offers a makeup request instead of locking
// the button. This hold is urgency only. It never blocks a booking.

/** How long a visitor's spot stays held. One constant, ten minutes. */
export const BOOKING_HOLD_MS = 10 * 60 * 1000;

const STORAGE_PREFIX = "campaign-desk:booking-hold:";

export function bookingHoldStorageKey(scope: string): string {
  return `${STORAGE_PREFIX}${scope}`;
}

export type HoldStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type BookingHoldView = {
  remainingMs: number;
  expired: boolean;
  /** mm:ss, counting down from 10:00. Never negative. */
  clock: string;
  /** Visible line inside the button. */
  status: string;
};

/**
 * Resume a hold started earlier in this tab, or start one at `now`.
 * A refresh keeps the original start. A missing, corrupt, or future
 * timestamp starts a new hold. Storage failures fall back to `now`
 * without throwing, so a private-mode browser still shows a timer.
 */
export function readOrStartHold(
  storage: HoldStorage | null,
  key: string,
  now: number
): number {
  if (!storage) return now;
  try {
    const raw = storage.getItem(key);
    const parsed = raw == null || raw.trim() === "" ? NaN : Number(raw);
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= now) return parsed;
    storage.setItem(key, String(now));
    return now;
  } catch {
    return now;
  }
}

export function formatHoldClock(remainingMs: number): string {
  const totalSeconds = Math.ceil(Math.max(0, remainingMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Screen-reader sentence. Changes once a minute, then once at expiry. */
export function holdAnnouncement(remainingMs: number): string {
  if (remainingMs <= 0) return "Hold expired. You can still book now.";
  const minutes = Math.ceil(remainingMs / 60_000);
  const unit = minutes === 1 ? "minute" : "minutes";
  return `Your spot is held for ${minutes} ${unit}.`;
}

export function bookingHoldView(
  startedAt: number,
  now: number,
  durationMs: number = BOOKING_HOLD_MS
): BookingHoldView {
  const remainingMs = Math.max(0, startedAt + durationMs - now);
  const expired = remainingMs <= 0;
  return {
    remainingMs,
    expired,
    clock: formatHoldClock(remainingMs),
    status: expired ? "Hold expired, book now" : `Your spot is held for ${formatHoldClock(remainingMs)}`,
  };
}
