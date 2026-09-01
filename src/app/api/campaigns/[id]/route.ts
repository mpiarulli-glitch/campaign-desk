import { NextResponse } from "next/server";
import {
  isAdminOrSyncAuthenticated,
  isCampaignsReadAuthenticated,
  reviewUrl,
  sessionActor,
  sessionUserSlug,
} from "@/lib/auth";
import { actorLabel } from "@/lib/people";
import {
  deleteCampaign,
  getCampaignById,
  listCommentsWithAttachments,
  listVersions,
  listEmails,
  listEmailsWithSubjects,
  listFlowSteps,
  ensureAutomationFlow,
  setEmailSubjects,
  setEmailApproved,
  setCampaignArchived,
  updateCampaign,
  unapproveCampaign,
  countOpenComments,
  markRevisionDone,
  markApproved,
  applyOperatorCampaignStatus,
} from "@/lib/campaigns";
import { isOperatorCampaignStatus } from "@/lib/campaign-status";
import { scheduleCampaign, suggestedSendForCampaign } from "@/lib/campaign-schedule";
import {
  actorBasecampIdentity,
  syncCampaignDeliverablesCard,
} from "@/lib/campaign-card-sync";
import { notifyCampaignRemoved } from "@/lib/notify";
import {
  coercePresentation,
  coerceTriggerKind,
  coerceTriggerFormFormat,
} from "@/lib/automation-map";

type Params = { params: Promise<{ id: string }> };

// Label for an admin-side approval, tagged "internal" so it can never be
// mistaken for the client's own typed sign-off on the review link.
async function internalApproverLabel(): Promise<string> {
  const tag = await sessionActor();
  return tag ? actorLabel(tag) : "Admin";
}

async function syncCard(id: string, column: "approved" | "scheduled") {
  await syncCampaignDeliverablesCard(
    id,
    column,
    actorBasecampIdentity(await sessionUserSlug())
  );
}

export async function GET(_request: Request, { params }: Params) {
  if (!(await isCampaignsReadAuthenticated()) && !(await isAdminOrSyncAuthenticated(_request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const campaign = getCampaignById(id);
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Deliberately no kind check here. Team focus is a default view, not a wall:
  // the calendar has a "See all" toggle, so blocking a direct link would mean
  // showing someone a campaign they then could not open. Who may reach campaigns
  // at all is decided by isCampaignsReadAuthenticated above, which is what keeps
  // the web team (empty focus) out entirely.

  const emails = listEmailsWithSubjects(id).map((e) => ({
    ...e,
    open_comments: countOpenComments(id, e.id),
  }));
  if (campaign.presentation === "automation") {
    ensureAutomationFlow(id);
  }
  const flow = listFlowSteps(id);

  return NextResponse.json({
    campaign: {
      ...campaign,
      open_comments: countOpenComments(campaign.id),
      review_url: reviewUrl(campaign.magic_token),
      external_review_url: reviewUrl(campaign.external_token),
      email_count: emails.length,
      suggested_send: suggestedSendForCampaign(campaign),
    },
    emails,
    flow,
    comments: listCommentsWithAttachments(campaign.id),
    versions: listVersions(campaign.id),
  });
}

export async function PATCH(request: Request, { params }: Params) {
  if (!(await isAdminOrSyncAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existing = getCampaignById(id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));

  // Approve / un-approve a single email from the admin side.
  if (body.setEmailApproved && typeof body.setEmailApproved === "object") {
    const emailId =
      typeof body.setEmailApproved.emailId === "string"
        ? body.setEmailApproved.emailId
        : "";
    const approved = Boolean(body.setEmailApproved.approved);
    if (!emailId) {
      return NextResponse.json({ error: "emailId required" }, { status: 400 });
    }
    const approverLabel = approved ? await internalApproverLabel() : null;
    const { allApproved } = setEmailApproved(
      emailId,
      approved,
      approverLabel,
      "internal"
    );
    if (approved && allApproved && existing.status !== "approved") {
      markApproved(id, approverLabel, "internal");
      await syncCard(id, "approved");
    }
    if (!approved && existing.status === "approved") {
      unapproveCampaign(id);
    }
    return NextResponse.json({
      emails: listEmailsWithSubjects(id).map((e) => ({
        ...e,
        open_comments: countOpenComments(id, e.id),
      })),
    });
  }

  // Save the subject-line / preview-text options for one email.
  if (body.setEmailSubjects && typeof body.setEmailSubjects === "object") {
    const emailId =
      typeof body.setEmailSubjects.emailId === "string"
        ? body.setEmailSubjects.emailId
        : "";
    const options = Array.isArray(body.setEmailSubjects.options)
      ? body.setEmailSubjects.options
      : [];
    if (!emailId) {
      return NextResponse.json({ error: "emailId required" }, { status: 400 });
    }
    setEmailSubjects(emailId, id, options);
    return NextResponse.json({
      emails: listEmailsWithSubjects(id).map((e) => ({
        ...e,
        open_comments: countOpenComments(id, e.id),
      })),
    });
  }

  if (typeof body.archived === "boolean") {
    const campaign = setCampaignArchived(id, body.archived);
    if (!campaign) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      campaign: {
        ...campaign,
        open_comments: countOpenComments(id),
        review_url: reviewUrl(campaign.magic_token),
      },
      message: body.archived ? "Campaign archived" : "Campaign restored",
    });
  }

  if (body.markRevisionDone === true) {
    const campaign = markRevisionDone(id);
    if (!campaign) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      campaign: {
        ...campaign,
        open_comments: countOpenComments(id),
        review_url: reviewUrl(campaign.magic_token),
      },
      message: "Revision marked done",
    });
  }

  if (body.markApproved === true) {
    const campaign = markApproved(id, await internalApproverLabel(), "internal");
    if (!campaign) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await syncCard(id, "approved");
    return NextResponse.json({
      campaign: {
        ...campaign,
        open_comments: countOpenComments(id),
        review_url: reviewUrl(campaign.magic_token),
      },
      message: "Campaign approved",
    });
  }

  const statusChoice =
    typeof body.status === "string" && isOperatorCampaignStatus(body.status)
      ? body.status
      : undefined;
  let flippedToSent = false;
  if (statusChoice === "scheduled") {
    const sendDate = typeof body.sendDate === "string" ? body.sendDate : "";
    const sendTime = typeof body.sendTime === "string" ? body.sendTime : "";
    const sendId = typeof body.sendId === "string" ? body.sendId : undefined;
    const scheduled = scheduleCampaign(id, { sendDate, sendTime, sendId });
    if ("error" in scheduled) {
      return NextResponse.json({ error: scheduled.error }, { status: 400 });
    }
    flippedToSent = scheduled.flippedToSent;
  } else if (statusChoice) {
    applyOperatorCampaignStatus(id, statusChoice, await internalApproverLabel());
  }

  const campaign = updateCampaign(id, {
    title: typeof body.title === "string" ? body.title : undefined,
    clientName:
      typeof body.clientName === "string" ? body.clientName : undefined,
    clientId:
      body.clientId === null || typeof body.clientId === "string"
        ? body.clientId
        : undefined,
    description:
      typeof body.description === "string" ? body.description : undefined,
    audience:
      typeof body.audience === "string" ? body.audience : undefined,
    htmlContent:
      typeof body.htmlContent === "string" ? body.htmlContent : undefined,
    emailId: typeof body.emailId === "string" ? body.emailId : undefined,
    versionNote:
      typeof body.versionNote === "string" ? body.versionNote : undefined,
    presentation:
      body.presentation !== undefined
        ? coercePresentation(body.presentation)
        : undefined,
    triggerLabel:
      typeof body.triggerLabel === "string" ? body.triggerLabel : undefined,
    triggerKind:
      body.triggerKind !== undefined
        ? coerceTriggerKind(body.triggerKind)
        : undefined,
    triggerFormFormat:
      body.triggerFormFormat !== undefined
        ? coerceTriggerFormFormat(body.triggerFormFormat)
        : undefined,
    triggerFormHtml:
      typeof body.triggerFormHtml === "string"
        ? body.triggerFormHtml
        : undefined,
    triggerFormMediaUrl:
      body.triggerFormMediaUrl === null ||
      typeof body.triggerFormMediaUrl === "string"
        ? body.triggerFormMediaUrl
        : undefined,
  });

  if (
    (statusChoice === "approved" || statusChoice === "approved_internally") &&
    existing.status !== "approved"
  ) {
    await syncCard(id, "approved");
  } else if (
    statusChoice === "scheduled" &&
    !flippedToSent &&
    existing.status !== "scheduled"
  ) {
    await syncCard(id, "scheduled");
  }

  const fresh = campaign || getCampaignById(id);
  return NextResponse.json({
    campaign: {
      ...fresh,
      open_comments: countOpenComments(id),
      review_url: reviewUrl(fresh!.magic_token),
      suggested_send: fresh ? suggestedSendForCampaign(fresh) : null,
    },
    emails: listEmails(id),
    flippedToSent,
  });
}

export async function DELETE(request: Request, { params }: Params) {
  if (!(await isAdminOrSyncAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existing = getCampaignById(id);
  const ok = deleteCampaign(id);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (existing) {
    notifyCampaignRemoved({
      campaignTitle: existing.title,
      clientName: existing.client_name,
    });
  }

  return NextResponse.json({ ok: true });
}
