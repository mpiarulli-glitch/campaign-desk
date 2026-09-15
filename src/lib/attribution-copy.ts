/**
 * Shared Lifecycle attribution honesty copy.
 * Keep Outcomes, journeys, Email wins, and Conversion log saying the same thing.
 */

import { DEFAULT_ATTRIBUTION_DAYS } from "./email-conversion-attribution";

/** Short footnote / accuracy line for panels and modals. */
export function attributionHonestyLine(
  days: number = DEFAULT_ATTRIBUTION_DAYS
): string {
  return `Forms and bookings only count when that contact got a marketing email within ${days} days before converting — appointment confirmations do not count.`;
}

/** Journeys modal subtitle (same gate, journey-focused). */
export function attributionJourneySubtitle(
  kind: "appointment" | "form_fill",
  days: number = DEFAULT_ATTRIBUTION_DAYS
): string {
  const event = kind === "appointment" ? "booking" : "form fill";
  return `Last marketing email before the ${event} (within ${days} days). Confirmation-only paths stay out.`;
}

/** Pre-load / empty-state note for portfolio scans. */
export function attributionPortfolioNote(
  days: number = DEFAULT_ATTRIBUTION_DAYS
): string {
  return `Same honesty rules everywhere: outbound marketing email on the contact within ${days} days. Confirmation-only paths stay out.`;
}
