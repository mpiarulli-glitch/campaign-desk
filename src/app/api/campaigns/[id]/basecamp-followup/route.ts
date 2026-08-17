import { NextResponse } from "next/server";
import { isAdminAuthenticated, reviewUrl, sessionUserSlug } from "@/lib/auth";
import {
  SERVICE,
  asPerson,
  basecampConnected,
  commentOnCard,
  findClientContact,
  getProjectPeopleForMention,
  hasConnection,
  mentionHtml,
} from "@/lib/basecamp";
import { getCampaignById } from "@/lib/campaigns";
import { clientReviewFollowupHtml } from "@/lib/client-approval";
import { recordFailure, clearFailure } from "@/lib/failures";
import { markClientFollowUpSent } from "@/lib/lifecycle-board";
import { getRevClient, listRevClients } from "@/lib/revenue";

type Params = { params: Promise<{ id: string }> };

function resolveClient(campaign: NonNullable<ReturnType<typeof getCampaignById>>) {
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

/**
 * Comment on the campaign's existing Basecamp approval card asking the client
 * to review. Does not create a card — send the approval first.
 */
export async function POST(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const campaign = getCampaignById(id);
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!campaign.basecamp_card_id) {
    return NextResponse.json(
      { error: "Send the approval first so there is a Basecamp card to follow up on." },
      { status: 400 }
    );
  }
  if (!basecampConnected()) {
    return NextResponse.json({ error: "Basecamp isn't connected." }, { status: 400 });
  }

  const client = resolveClient(campaign);
  if (!client?.basecamp_project_id) {
    return NextResponse.json(
      { error: "This campaign's client has no Basecamp project." },
      { status: 400 }
    );
  }

  const sender = await sessionUserSlug();
  const identity = sender && hasConnection(sender) ? asPerson(sender) : SERVICE;

  const people = await getProjectPeopleForMention(client.basecamp_project_id, identity);
  const recipient =
    (client.basecamp_contact_id
      ? people.find((person) => person.id === client.basecamp_contact_id)
      : null) ||
    findClientContact(people, client.contact_email, client.contact_name);
  if (!recipient) {
    return NextResponse.json(
      {
        error: client.contact_name
          ? `Could not match "${client.contact_name}" to someone on the Basecamp project, so the follow-up would ping nobody.`
          : "No client contact on this account, so the follow-up would ping nobody.",
      },
      { status: 400 }
    );
  }

  const html = clientReviewFollowupHtml(
    {
      clientContactName: recipient.name || client.contact_name || client.name,
      campaignTitle: campaign.title,
      previewUrl: reviewUrl(campaign.external_token),
    },
    mentionHtml(recipient)
  );

  const result = await commentOnCard(
    client.basecamp_project_id,
    campaign.basecamp_card_id,
    html,
    identity
  );
  if (!result.ok) {
    recordFailure({
      kind: "basecamp_comment",
      subject: client.name,
      detail: result.error || "Could not comment the follow-up on the card.",
      hint: "The card may have been deleted. Send the approval again to make a fresh one.",
    });
    return NextResponse.json(
      { error: result.error || "Could not post the follow-up in Basecamp." },
      { status: 502 }
    );
  }

  clearFailure("basecamp_comment", client.name);
  if (campaign.client_id) markClientFollowUpSent(campaign.client_id);

  return NextResponse.json({
    ok: true,
    recipient: recipient.name,
    cardUrl: result.url || campaign.basecamp_card_url,
  });
}
