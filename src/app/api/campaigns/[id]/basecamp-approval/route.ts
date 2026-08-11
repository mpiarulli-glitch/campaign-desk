import { NextResponse } from "next/server";
import { isAdminAuthenticated, reviewUrl, sessionUserSlug } from "@/lib/auth";
import {
  SERVICE,
  asPerson,
  basecampConnected,
  findClientContact,
  getProjectPeopleForMention,
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
    client?.contact_name || client?.name || campaign.client_name;
  const messageInput = {
    clientContactName: contactName,
    campaignTitle: campaign.title,
    previewUrl,
  };

  // A missing contact is deliberately not listed. The send form picks the
  // recipient from the project roster, so a client with nobody on file is a
  // pick away from sending rather than blocked: BLuu Construction sat unsendable
  // for exactly that reason while the right person was on the project all along.
  const missing: string[] = [];
  if (!client) missing.push("linked client account");
  if (client && !client.basecamp_project_id) {
    missing.push("Basecamp project");
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

  // The roster powers the send form's recipient and assignee pickers. It is a
  // live Basecamp call, so a failure degrades to an empty list and a reason
  // rather than taking the whole panel down.
  let people: Array<{
    id: number;
    name: string;
    email: string;
    isClient: boolean;
    mentionable: boolean;
  }> = [];
  let peopleReason = "";
  let defaultRecipientId: number | null = null;
  if (state.client?.basecamp_project_id && basecampConnected()) {
    try {
      const roster = await getProjectPeopleForMention(
        state.client.basecamp_project_id
      );
      people = roster
        .map((person) => ({
          id: person.id,
          name: person.name,
          email: person.email_address || "",
          isClient: Boolean(person.client),
          mentionable: Boolean(person.attachable_sgid),
        }))
        .sort((a, b) => {
          if (a.isClient !== b.isClient) return a.isClient ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      if (!people.length) {
        peopleReason =
          "Nobody came back for that project. Check the project id, and that King Kashflow is a member of it.";
      }
      // Whoever the account already points at, so the form opens on the usual
      // recipient and sending stays one click for every client that has one.
      const saved =
        state.client.basecamp_contact_id ||
        findClientContact(
          roster,
          state.client.contact_email,
          state.client.contact_name
        )?.id ||
        0;
      if (saved && people.some((person) => person.id === saved)) {
        defaultRecipientId = saved;
      }
    } catch {
      peopleReason = "Could not load the Basecamp project roster.";
    }
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
    people,
    peopleReason,
    defaultRecipientId,
    dueOn: state.campaign.basecamp_due_on || "",
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

  const recipientId =
    Number.isInteger(body.recipientId) && body.recipientId > 0
      ? (body.recipientId as number)
      : 0;
  const extraAssigneeIds: number[] = Array.isArray(body.assigneeIds)
    ? body.assigneeIds
        .filter((value: unknown) => Number.isInteger(value) && (value as number) > 0)
        .filter((value: number) => value !== recipientId)
    : [];

  // Undefined means the form said nothing about the due date, which leaves the
  // card's own date untouched. An empty string is an explicit clear.
  let dueOn: string | null | undefined;
  if (typeof body.dueOn === "string") {
    const trimmed = body.dueOn.trim();
    if (trimmed && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return NextResponse.json(
        { error: "Due date must be a calendar date." },
        { status: 400 }
      );
    }
    dueOn = trimmed;
  }

  const client = state.client!;
  if (
    !recipientId &&
    !client.contact_email.trim() &&
    !client.contact_name.trim()
  ) {
    return NextResponse.json(
      { error: "Pick who this approval goes to before sending it." },
      { status: 400 }
    );
  }

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

  const result = await sendApprovalToDeliverables({
    identity,
    projectId: client.basecamp_project_id,
    campaignTitle: state.campaign.title,
    // Built after the recipient resolves, so the greeting is a real mention.
    buildContent: (contactMention?: string) =>
      clientApprovalMessageHtml(state.messageInput, contactMention),
    recipientIdentifiers: [
      client.contact_email,
      client.contact_name,
    ].filter(Boolean),
    recipientId: recipientId || undefined,
    extraAssigneeIds,
    dueOn,
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
    dueOn,
  });

  return NextResponse.json({
    ok: true,
    created: result.created,
    recipient: result.recipientName,
    cardUrl: result.cardUrl,
    status: campaign?.status || "in_review",
    sentAt: campaign?.basecamp_approval_sent_at,
    dueOn: campaign?.basecamp_due_on || "",
  });
}
