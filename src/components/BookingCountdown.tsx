"use client";

import { useEffect, useState } from "react";
import {
  BOOKING_HOLD_MS,
  parseDeadline,
  readHoldStartedAt,
  resolveBookingCountdown,
  type BookingCountdownSnapshot,
} from "@/lib/booking-countdown";

// In-memory copy for this tab when sessionStorage is blocked (private mode)
// and so a second instance on the same page joins the hold the first one started.
const memoryHolds = new Map<string, number>();

function readStored(key: string): number | null {
  try {
    const fromSession = readHoldStartedAt(window.sessionStorage.getItem(key));
    if (fromSession != null) return fromSession;
  } catch {
    // sessionStorage can throw when storage is blocked.
  }
  return memoryHolds.get(key) ?? null;
}

function remember(key: string, startedAt: number, previous: number | null) {
  memoryHolds.set(key, startedAt);
  if (previous === startedAt) return;
  try {
    window.sessionStorage.setItem(key, String(startedAt));
  } catch {
    // The memory map still keeps the hold for this visit.
  }
}

/**
 * Countdown for a booking button. Pass `deadline` when the page has a real
 * close time; otherwise this is a per-visitor hold of `durationMs` (default
 * 10 minutes) remembered in sessionStorage. At zero it shows a quiet expired
 * line and does not disable anything around it.
 *
 * The ticking clock is hidden from assistive tech. A polite live region
 * updates when the remaining minute changes, and again when the hold ends.
 */
export function BookingCountdown({
  deadline = null,
  storageKey,
  durationMs = BOOKING_HOLD_MS,
  polite = true,
}: {
  deadline?: string | number | null;
  storageKey: string;
  durationMs?: number;
  /** False on a second, visual-only copy so the minute is not announced twice. */
  polite?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<BookingCountdownSnapshot | null>(null);
  const [spoken, setSpoken] = useState("");

  useEffect(() => {
    const deadlineAt = parseDeadline(deadline);

    function tick() {
      const stored = deadlineAt == null ? readStored(storageKey) : null;
      const next = resolveBookingCountdown({
        now: Date.now(),
        deadlineAt,
        storedStartedAt: stored,
        durationMs,
      });
      if (next.persistStartedAt != null) {
        remember(storageKey, next.persistStartedAt, stored);
      }
      setSnapshot(next);
      setSpoken((prev) => (prev === next.announcement ? prev : next.announcement));
    }

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [deadline, storageKey, durationMs]);

  const expired = Boolean(snapshot?.expired);
  const className = `booking-hold${expired ? " is-expired" : ""}`;

  return (
    <div className={className} aria-hidden={polite ? undefined : true}>
      {snapshot && !expired ? (
        <p className="booking-hold-clock" aria-hidden="true">
          <span className="booking-hold-label">{snapshot.label}</span>
          <span className="booking-hold-time">{snapshot.clock}</span>
        </p>
      ) : null}
      {polite ? (
        <p
          className={expired ? "booking-hold-expired-text" : "booking-hold-sr"}
          aria-live="polite"
          aria-atomic="true"
        >
          {spoken}
        </p>
      ) : expired && snapshot ? (
        <p className="booking-hold-expired-text">{snapshot.announcement}</p>
      ) : null}
    </div>
  );
}
