// Move a campaign's linked Deliverables card when its Campaign Desk status
// changes. Approval and scheduling in this app should land the same card in the
// matching Basecamp column, so the board stays truthful without a second click.
//
// The campaign write always wins. A Basecamp outage is recorded as a failure
// and never blocks the client from approving, or an admin from marking scheduled.

import {
  SERVICE,
  asPerson,
  basecampConnected,
  hasConnection,
  moveDeliverablesCard,
  type BcIdentity,
} from "./basecamp";
import { getCampaignById } from "./campaigns";
import type { Campaign } from "./db";
import { recordFailure, clearFailure } from "./failures";
import { getRevClient, listRevClients } from "./revenue";

export type CardSyncColumn = "approved" | "scheduled";

function columnLabel(column: CardSyncColumn): string {
  return column === "approved" ? "Approved" : "Scheduled/Published";
}

export function resolveCampaignClient(campaign: Campaign) {
  if (campaign.client_id) {
    const linked = getRevClient(campaign.client_id);
    if (linked) return linked;
  }
  return (
    listRevClients(true).find(
      (client) =>
        client.name.trim().toLowerCase() ===
        campaign.client_name.trim().toLowerCase()
    ) || null
  );
}

export function actorBasecampIdentity(slug: string | null | undefined): BcIdentity {
  return slug && hasConnection(slug) ? asPerson(slug) : SERVICE;
}

export async function syncCampaignDeliverablesCard(
  campaignId: string,
  column: CardSyncColumn,
  identity?: BcIdentity
): Promise<void> {
  const campaign = getCampaignById(campaignId);
  if (!campaign) return;
  // Campaigns that were never sent to Basecamp have nothing to move.
  if (!campaign.basecamp_card_id) return;

  const client = resolveCampaignClient(campaign);
  const subject = client?.name || campaign.client_name || campaign.title;
  const wanted = columnLabel(column);

  try {
    if (!client?.basecamp_project_id) {
      recordFailure({
        kind: "basecamp_card_move",
        subject,
        detail: `Could not move the Deliverables card to ${wanted}: this client has no Basecamp project.`,
        hint: "Link the client to a Basecamp project, then change the campaign status again.",
      });
      return;
    }
    if (!basecampConnected()) {
      recordFailure({
        kind: "basecamp_card_move",
        subject,
        detail: `Could not move the Deliverables card to ${wanted}: Basecamp is not connected.`,
        hint: "Reconnect Basecamp, then change the campaign status again.",
      });
      return;
    }

    const result = await moveDeliverablesCard({
      projectId: client.basecamp_project_id,
      cardId: campaign.basecamp_card_id,
      column,
      identity: identity || SERVICE,
    });
    if (!result.ok) {
      recordFailure({
        kind: "basecamp_card_move",
        subject,
        detail:
          result.error ||
          `Could not move the Deliverables card to ${wanted}.`,
        hint: `Move the card to ${wanted} in Basecamp, or fix the board and change the campaign status again.`,
      });
      return;
    }
    clearFailure("basecamp_card_move", subject);
  } catch (err) {
    recordFailure({
      kind: "basecamp_card_move",
      subject,
      detail: (err as Error).message || `Could not move the Deliverables card to ${wanted}.`,
      hint: `Move the card to ${wanted} in Basecamp, then carry on.`,
    });
  }
}
