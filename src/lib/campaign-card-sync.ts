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
import type { Campaign, RevClient } from "./db";
import { recordFailure, clearFailure } from "./failures";
import { getRevClient, listRevClients, updateRevClient } from "./revenue";

export type CardSyncColumn = "approved" | "scheduled";

function columnLabel(column: CardSyncColumn): string {
  return column === "approved" ? "Approved" : "Scheduled/Published";
}

function clientNameKey(name: string): string {
  return name.trim().toLowerCase();
}

function hasBasecampProject(client: RevClient): boolean {
  return Boolean(client.basecamp_project_id?.trim());
}

/** Prefer an account that already has a Basecamp project; then active. */
function pickBestClient(candidates: RevClient[]): RevClient | null {
  if (!candidates.length) return null;
  const withProject = candidates.filter(hasBasecampProject);
  const pool = withProject.length ? withProject : candidates;
  return pool.find((c) => c.active) || pool[0] || null;
}

/**
 * Resolve the revenue client for a campaign's Basecamp / approval work.
 *
 * Linked client wins when it already has a Basecamp project. If the linked
 * record is a stub (or name-only match) without a project, prefer a same-name
 * account that does — and copy the project onto the linked stub so the next
 * send does not hit "Setup needed: Basecamp project" again. That covers the
 * common case where "Add client" created a duplicate while the real account
 * already had Basecamp linked from a prior approval.
 */
export function resolveCampaignClient(campaign: Campaign): RevClient | null {
  const linked = campaign.client_id ? getRevClient(campaign.client_id) : null;
  if (linked && hasBasecampProject(linked)) return linked;

  const nameKey = clientNameKey(campaign.client_name || linked?.name || "");
  const byName = nameKey
    ? listRevClients(true).filter((c) => clientNameKey(c.name) === nameKey)
    : [];
  const best = pickBestClient(byName);

  if (
    linked &&
    !hasBasecampProject(linked) &&
    best &&
    hasBasecampProject(best) &&
    best.id !== linked.id
  ) {
    updateRevClient(linked.id, {
      basecampProjectId: best.basecamp_project_id,
      ...(best.basecamp_contact_id
        ? { basecampContactId: best.basecamp_contact_id }
        : {}),
    });
    return getRevClient(linked.id) || best;
  }

  if (best && hasBasecampProject(best)) return best;
  return linked || best;
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
