"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  bookingHoldStorageKey,
  bookingHoldView,
  holdAnnouncement,
  readOrStartHold,
  type BookingHoldView,
} from "@/lib/booking-hold";

type Props = {
  /** Same scope shares one hold across the buttons on a booking page. */
  scope: string;
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
};

/**
 * The page's booking button with a session hold inside it.
 * `disabled` is only the caller's own state (saving, or a date not picked
 * yet). An expired hold does not disable the button.
 */
export function BookingHoldButton({ scope, children, disabled, onClick, className }: Props) {
  const [view, setView] = useState<BookingHoldView | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const key = bookingHoldStorageKey(scope);
    const startedAt = readOrStartHold(window.sessionStorage, key, Date.now());
    const tick = () => {
      const next = bookingHoldView(startedAt, Date.now());
      setView(next);
      setAnnouncement(holdAnnouncement(next.remainingMs));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [scope]);

  return (
    <span className="booking-hold">
      <button
        type="button"
        className={`btn booking-hold-btn${className ? ` ${className}` : ""}`}
        data-booking-hold={view ? (view.expired ? "expired" : "holding") : "pending"}
        disabled={disabled}
        onClick={onClick}
      >
        <span className="booking-hold-action">{children}</span>
        {view ? (
          <span className="booking-hold-status" aria-hidden="true">
            {view.status}
          </span>
        ) : null}
      </button>
      <span className="booking-hold-live" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
    </span>
  );
}
