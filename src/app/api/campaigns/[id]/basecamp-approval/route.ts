import { NextResponse } from "next/server";
import { isAdminAuthenticated, reviewUrl } from "@/lib/auth";
import {
  basecampConnected,
  sendApprovalToDeliverables,
} from "@/lib/basecamp";
import {
  getCampaignById,
  listEmails,
  recordBasecampApproval,
  rememberBasecampApprovalCard,
} from "@/lib/campaigns";
import {
  campaignApprovalRevisionKey,
  clientApprovalMessageHtml,
  clientApprovalMessageText,
} from "@/lib/client-approval";
import { getRevClient, listRevClients } from "@/lib/revenue";

type Params = { params: Promise<{ id: string }> };

function resolveClient(campaign: ReturnType<typeof getCampaignById>) {
  if (!campaign) return null;
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

function approvalState(id: string) {
  const campaign = getCampaignById(id);
  if (!campaign) return null;
  const client = resolveClient(campaign);
  const emails = listEmails(id);
  const revision = campaignApprovalRevisionKey(campaign, emails);
  const previewUrl = reviewUrl(campaign.external_token);
  const contactName =
    client?.contact_name || client?.poc || client?.name || campaign.client_name;
  const messageInput = {
    clientContactName: contactName,
    campaignTitle: campaign.title,
    previewUrl,
  };

  const missing: string[] = [];
  if (!client) missing.push("linked client account");
  if (client && !client.basecamp_project_id) {
    missing.push("Basecamp project");
  }
  if (
    client &&
    !client.contact_email.trim() &&
    !client.poc.trim() &&
    !client.contact_name.trim()
  ) {
    missing.push("client contact or POC");
  }
  if (!basecampConnected()) missing.push("Basecamp connection");

  return {
    campaign,
    client,
    revision,
    messageInput,
    missing,
    alreadySent:
      Boolean(campaign.basecamp_approval_sent_at) &&
      campaign.basecamp_approval_revision === revision,
  };
}

export async function GET(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const state = approvalState(id);
  if (!state) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    ready: state.missing.length === 0,
    missing: state.missing,
    recipient:
      state.client?.contact_name ||
      state.client?.poc ||
      state.client?.contact_email ||
      "",
    projectConfigured: Boolean(state.client?.basecamp_project_id),
    message: clientApprovalMessageText(state.messageInput),
    alreadySent: state.alreadySent,
    lastSentAt: state.campaign.basecamp_approval_sent_at,
    cardUrl: state.campaign.basecamp_card_url,
  });
}

export async function POST(request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const state = approvalState(id);
  if (!state) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (state.missing.length) {
    return NextResponse.json(
      { error: `Missing ${state.missing.join(", ")}.` },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const force = body.force === true;
  if (state.alreadySent && !force) {
    return NextResponse.json(
      {
        error:
          "This version was already sent to Basecamp. Use the resend action if you need to send it again.",
        alreadySent: true,
      },
      { status: 409 }
    );
  }

  const client = state.client!;
  const result = await sendApprovalToDeliverables({
    projectId: client.basecamp_project_id,
    campaignTitle: state.campaign.title,
    contentHtml: clientApprovalMessageHtml(state.messageInput),
    recipientIdentifiers: [
      client.contact_email,
      client.poc,
      client.contact_name,
    ].filter(Boolean),
    existingCardId: state.campaign.basecamp_card_id,
  });

  if (!result.ok) {
    if (result.cardId) {
      rememberBasecampApprovalCard(
        id,
        result.cardId,
        result.cardUrl || state.campaign.basecamp_card_url || ""
      );
    }
    return NextResponse.json(
      {
        error: result.error || "Could not send the approval in Basecamp.",
        cardUrl: result.cardUrl,
      },
      { status: 502 }
    );
  }

  const campaign = recordBasecampApproval(id, {
    cardId: result.cardId!,
    cardUrl: result.cardUrl || "",
    revision: state.revision,
  });

  return NextResponse.json({
    ok: true,
    created: result.created,
    recipient: result.recipientName,
    cardUrl: result.cardUrl,
    status: campaign?.status || "in_review",
    sentAt: campaign?.basecamp_approval_sent_at,
  });
}
