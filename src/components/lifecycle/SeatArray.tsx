"use client";

import type { LinkedInSection } from "./types";

/**
 * One bar per LinkedIn seat.
 *
 * Height encodes how much work is riding on the seat (campaign count), colour
 * encodes whether it can actually send. A tall dark bar is the worst thing on
 * the page: a lot of campaigns going nowhere.
 *
 * Bars are buttons so the fault detail is reachable by keyboard, not just
 * hover.
 */
export function SeatArray({ seats }: { seats: LinkedInSection["seats"] }) {
  // Load is measured in campaigns that are switched on. A seat holding thirty
  // dormant campaigns isn't carrying thirty campaigns' worth of risk.
  const loadOf = (s: LinkedInSection["seats"][number]) =>
    s.campaigns.filter((c) => c.verdict.severity !== "off").length;

  const busiest = Math.max(1, ...seats.map(loadOf));

  return (
    <div className="hud-array" role="list" aria-label="LinkedIn seat status">
      {seats.map((entry) => {
        const { seat, connected } = entry;
        const load = loadOf(entry);
        // Square root keeps one very busy seat from flattening all the others,
        // while still reading as taller. Floor of 14% keeps idle seats visible.
        const height = 14 + Math.sqrt(load / busiest) * 86;
        const state = connected ? "live" : "fault";
        const detail = connected
          ? `Sending · ${load} active`
          : `${seat.statusLabel} · ${load} stranded`;

        return (
          <button
            key={seat.id}
            type="button"
            role="listitem"
            className={`hud-seat ${state}`}
            aria-label={`${seat.fullName}. ${detail}`}
            title={`${seat.fullName} — ${detail}`}
          >
            <span className="hud-seat-bar" style={{ height: `${height}%` }} />
            <span className="hud-seat-tip" aria-hidden="true">
              <b>{seat.fullName}</b>
              <span>{detail}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
