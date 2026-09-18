// When a client books a production, move their scheduling Deliverables card
// from Needs Approval to Approved and clear the due date. The booking write
// always wins — a Basecamp outage is recorded as a failure and never blocks
// the schedule link from returning success.

import {
  SERVICE,
  basecampConnected,
  moveDeliverablesCard,
} from "./basecamp";
import type { RevClient } from "./db";
import { getDb } from "./db";
import {
  listExtraRequestsForClient,
  listOpenExtraRequests,
} from "./extra-requests";
import { recordFailure, clearFailure } from "./failures";
import { getLatestReminder, getReminder } from "./reminders";

/**
 * Find the Basecamp scheduling card for this booking.
 *
 * Prefer the cadence reminder for the window that was booked; then an extra /
 * first-production invite card (including ones just fulfilled by this send);
 * finally the client's most recent reminder card.
 */
export function findProductionScheduleCardId(
  clientId: string,
  opts: { windowStart?: string | null; sendId?: string | null } = {}
): string | null {
  const windowStart = (opts.windowStart || "").trim();
  if (windowStart) {
    const rem = getReminder(clientId, windowStart);
    if (rem?.bc_card_id?.trim()) return rem.bc_card_id.trim();
  }

  const sendId = (opts.sendId || "").trim();
  if (sendId) {
    const bySend = getDb()
      .prepare(
        `SELECT bc_card_id FROM extra_production_requests
         WHERE fulfilled_send_id = ? AND bc_card_id IS NOT NULL AND TRIM(bc_card_id) != ''
         LIMIT 1`
      )
      .get(sendId) as { bc_card_id: string } | undefined;
    if (bySend?.bc_card_id?.trim()) return bySend.bc_card_id.trim();
  }

  for (const req of listOpenExtraRequests(clientId)) {
    if (req.bc_card_id?.trim()) return req.bc_card_id.trim();
  }
  for (const req of listExtraRequestsForClient(clientId)) {
    if (req.bc_card_id?.trim()) return req.bc_card_id.trim();
  }

  const latest = getLatestReminder(clientId);
  if (latest?.bc_card_id?.trim()) return latest.bc_card_id.trim();
  return null;
}

export async function syncProductionScheduleCard(input: {
  client: RevClient;
  windowStart?: string | null;
  sendId?: string | null;
}): Promise<void> {
  const { client } = input;
  const subject = client.name || "production";
  const cardId = findProductionScheduleCardId(client.id, {
    windowStart: input.windowStart,
    sendId: input.sendId,
  });
  if (!cardId) return;

  try {
    const projectId = (client.basecamp_project_id || "").trim();
    if (!projectId) {
      recordFailure({
        kind: "basecamp_card_move",
        subject,
        detail:
          "Could not move the production scheduling card to Approved: this client has no Basecamp project.",
        hint: "Link the client to a Basecamp project, then re-open the booking if needed.",
      });
      return;
    }
    if (!basecampConnected()) {
      recordFailure({
        kind: "basecamp_card_move",
        subject,
        detail:
          "Could not move the production scheduling card to Approved: Basecamp is not connected.",
        hint: "Reconnect Basecamp, then change the card in Basecamp if it is still in Needs Approval.",
      });
      return;
    }

    const result = await moveDeliverablesCard({
      projectId,
      cardId,
      column: "approved",
      identity: SERVICE,
    });
    if (!result.ok) {
      recordFailure({
        kind: "basecamp_card_move",
        subject,
        detail:
          result.error ||
          "Could not move the production scheduling card to Approved.",
        hint: "Move the card to Approved in Basecamp and clear its due date.",
      });
      return;
    }
    clearFailure("basecamp_card_move", subject);
  } catch (err) {
    recordFailure({
      kind: "basecamp_card_move",
      subject,
      detail:
        (err as Error).message ||
        "Could not move the production scheduling card to Approved.",
      hint: "Move the card to Approved in Basecamp and clear its due date.",
    });
  }
}
