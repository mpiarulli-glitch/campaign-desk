// Delayed thank-you on the Basecamp approval card after a client approves.
//
// The client approves on the review link; a few minutes later Michael's
// connection posts a short comment tagging them. Scheduling lives in the DB so
// a cron sweep can send it without holding the approval request open.

import {
  SERVICE,
  asPerson,
  basecampConnected,
  commentOnCard,
  findClientContact,
  getProjectPeopleForMention,
  hasConnection,
  mentionHtml,
} from "./basecamp";
import { clientApprovalThankYouHtml } from "./client-approval";
import {
  cancelPendingApprovalThankYou,
  getCampaignById,
  listDueApprovalThankYous,
  markApprovalThankYouSent,
} from "./campaigns";
import type { Campaign } from "./db";
import { clearFailure, recordFailure } from "./failures";
import { OWNER_SLUG } from "./people";
import { resolveCampaignClient } from "./campaign-card-sync";

/** Minutes after client approval before the thank-you posts. */
export const APPROVAL_THANK_YOU_DELAY_MS = 3 * 60 * 1000;

export type ApprovalThankYouResult = {
  campaignId: string;
  campaignTitle: string;
  clientName: string;
  ok: boolean;
  skipped?: string;
  error?: string;
  recipient?: string;
};

async function sendOne(campaign: Campaign): Promise<ApprovalThankYouResult> {
  const base = {
    campaignId: campaign.id,
    campaignTitle: campaign.title,
    clientName: campaign.client_name,
    ok: false as const,
  };

  const fresh = getCampaignById(campaign.id);
  if (
    !fresh ||
    fresh.status !== "approved" ||
    fresh.approved_channel !== "client"
  ) {
    cancelPendingApprovalThankYou(campaign.id);
    return { ...base, ok: true, skipped: "no longer a client approval" };
  }

  if (!basecampConnected()) {
    return { ...base, error: "Basecamp isn't connected." };
  }

  const client = resolveCampaignClient(fresh);
  if (!client?.basecamp_project_id) {
    markApprovalThankYouSent(fresh.id);
    return { ...base, ok: true, skipped: "no Basecamp project" };
  }

  const identity = hasConnection(OWNER_SLUG) ? asPerson(OWNER_SLUG) : SERVICE;

  let recipient;
  try {
    const people = await getProjectPeopleForMention(
      client.basecamp_project_id,
      identity
    );
    recipient =
      (client.basecamp_contact_id
        ? people.find((person) => person.id === client.basecamp_contact_id)
        : null) ||
      findClientContact(people, client.contact_email, client.contact_name);
  } catch (err) {
    return { ...base, error: (err as Error).message };
  }

  if (!recipient) {
    markApprovalThankYouSent(fresh.id);
    return {
      ...base,
      ok: true,
      skipped: "could not match a client contact on the project",
    };
  }

  const html = clientApprovalThankYouHtml(
    {
      clientContactName: recipient.name || client.contact_name || client.name,
    },
    mentionHtml(recipient)
  );

  const result = await commentOnCard(
    client.basecamp_project_id,
    fresh.basecamp_card_id!,
    html,
    identity
  );

  if (!result.ok) {
    recordFailure({
      kind: "basecamp_comment",
      subject: client.name,
      detail: result.error || "Could not post the approval thank-you.",
      hint: "Check the approval card still exists, then wait for the next cron run.",
    });
    return {
      ...base,
      error: result.error || "Could not post the thank-you in Basecamp.",
    };
  }

  clearFailure("basecamp_comment", client.name);
  markApprovalThankYouSent(fresh.id);
  return {
    ...base,
    ok: true,
    recipient: recipient.name,
  };
}

export async function runApprovalThankYou(options?: {
  dryRun?: boolean;
  asOf?: string;
}): Promise<{ due: number; sent: ApprovalThankYouResult[] }> {
  const dueCampaigns = listDueApprovalThankYous(options?.asOf);
  if (options?.dryRun) {
    return {
      due: dueCampaigns.length,
      sent: dueCampaigns.map((campaign) => ({
        campaignId: campaign.id,
        campaignTitle: campaign.title,
        clientName: campaign.client_name,
        ok: true,
        skipped: "dry run",
      })),
    };
  }

  const sent: ApprovalThankYouResult[] = [];
  for (const campaign of dueCampaigns) {
    sent.push(await sendOne(campaign));
  }
  return { due: dueCampaigns.length, sent };
}
