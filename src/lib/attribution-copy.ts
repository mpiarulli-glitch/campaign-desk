/**
 * Shared Lifecycle attribution honesty copy.
 * Keep Outcomes, journeys, Email wins, and Conversion log saying the same thing.
 */

import { DEFAULT_ATTRIBUTION_DAYS } from "./email-conversion-attribution";

/** Short footnote / accuracy line for panels and modals. */
export function attributionHonestyLine(
  days: number = DEFAULT_ATTRIBUTION_DAYS
): string {
  return `A form counts when that contact received and opened a marketing email within ${days} days before the fill. A booking counts when they received a marketing email in that window.`;
}

/** Journeys modal subtitle (same gate, journey-focused). */
export function attributionJourneySubtitle(
  kind: "appointment" | "form_fill",
  days: number = DEFAULT_ATTRIBUTION_DAYS
): string {
  if (kind === "form_fill") {
    return `Received and opened a marketing email within ${days} days before the form fill.`;
  }
  return `Marketing email on that contact before the booking (within ${days} days). Confirmation emails after the form stay out.`;
}

/** Pre-load / empty-state note for portfolio scans. */
export function attributionPortfolioNote(
  days: number = DEFAULT_ATTRIBUTION_DAYS
): string {
  return `Forms count when the contact received and opened a marketing email within ${days} days before the fill. Bookings count a marketing email in that window.`;
}
