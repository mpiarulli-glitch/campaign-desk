import { NextResponse } from "next/server";
import { isAdminAuthenticated, reviewUrl, sessionUserSlug } from "@/lib/auth";
import {
  SERVICE,
  asPerson,
  basecampConnected,
  hasConnection,
  sendApprovalToDeliverables,
} from "@/lib/basecamp";
import { clearFailure, recordFailure } from "@/lib/failures";
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
import { deliverableCardTitle } from "@/lib/asset-kinds";
import { getRevClient, listRevClients } from "@/lib/revenue";

type Params = { params: Promise<{ id: string }> };

// How long the client gets before the approval is late. Three days is the
// window we quote them, so the card carries the same deadline.
const APPROVAL_DUE_DAYS = 3;

function approvalDueOn(days = APPROVAL_DUE_DAYS): string {
  const due = new Date();
  due.setDate(due.getDate() + days);
  // Local calendar date, not UTC: toISOString would roll the date forward for
  // anyone sending in the evening from a negative-offset zone.
  const month = String(due.getMonth() + 1).padStart(2, "0");
  const day = String(due.getDate()).padStart(2, "0");
  return `${due.getFullYear()}-${month}-${day}`;
}

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
    client?.contact_name || client?.name || campaign.client_name;
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
  if (client && !client.contact_email.trim() && !client.contact_name.trim()) {
    missing.push("client contact");
  }
  if (!basecampConnected()) missing.push("Basecamp connection");

  return {
    campaign,
    client,
    revision,
    messageInput,
    // The card is named for the kind of work inside it, so the Deliverables
    // board reads as a list of asset types rather than bare campaign names.
    cardTitle: deliverableCardTitle(
      campaign.title,
      emails.map((email) => email.kind)
    ),
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
      state.client?.contact_email ||
      "",
    projectConfigured: Boolean(state.client?.basecamp_project_id),
    message: clientApprovalMessageText(state.messageInput),
    alreadySent: state.alreadySent,
    lastSentAt: state.campaign.basecamp_approval_sent_at,
    cardUrl: state.campaign.basecamp_card_url,
    cardTitle: state.cardTitle,
    dueOn: approvalDueOn(),
    dueDays: APPROVAL_DUE_DAYS,
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

  // Post as whoever pressed send, so the client sees a person they deal with.
  // If they have not connected Basecamp it goes out as the mascot account,
  // which is honest. It never goes out as another team member.
  const sender = await sessionUserSlug();
  const identity = sender && hasConnection(sender) ? asPerson(sender) : SERVICE;

  const client = state.client!;
  const dueOn = approvalDueOn();
  const result = await sendApprovalToDeliverables({
    identity,
    projectId: client.basecamp_project_id,
    campaignTitle: state.cardTitle,
    dueOn,
    // Built after the recipient resolves, so the greeting is a real mention.
    buildContent: (contactMention?: string) =>
      clientApprovalMessageHtml(state.messageInput, contactMention),
    recipientIdentifiers: [
      client.contact_email,
      client.contact_name,
    ].filter(Boolean),
    existingCardId: state.campaign.basecamp_card_id,
  });

  if (!result.ok) {
    // The sender sees this immediately, so the record is for history: a client
    // whose approvals keep failing is a pattern nobody spots one send at a time.
    recordFailure({
      kind: "basecamp_approval",
      subject: client.name,
      detail: result.error || "Could not send the approval in Basecamp.",
      hint: "Fix it in Basecamp, then press send approval again.",
    });
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

  clearFailure("basecamp_approval", client.name);

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
    dueOn,
  });
}
