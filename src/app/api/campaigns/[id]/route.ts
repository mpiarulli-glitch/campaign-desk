import { NextResponse } from "next/server";
import { isAdminAuthenticated, reviewUrl } from "@/lib/auth";
import {
  deleteCampaign,
  getCampaignById,
  listCommentsWithAttachments,
  listVersions,
  listEmails,
  listEmailsWithSubjects,
  setEmailSubjects,
  setEmailApproved,
  updateCampaign,
  unapproveCampaign,
  countOpenComments,
  markRevisionDone,
  markApproved,
} from "@/lib/campaigns";
import type { CampaignStatus } from "@/lib/db";
import { notifyCampaignRemoved } from "@/lib/notify";

const STATUSES: CampaignStatus[] = [
  "draft",
  "in_review",
  "needs_changes",
  "approved",
];

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const campaign = getCampaignById(id);
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const emails = listEmailsWithSubjects(id).map((e) => ({
    ...e,
    open_comments: countOpenComments(id, e.id),
  }));

  return NextResponse.json({
    campaign: {
      ...campaign,
      open_comments: countOpenComments(campaign.id),
      review_url: reviewUrl(campaign.magic_token),
      external_review_url: reviewUrl(campaign.external_token),
      email_count: emails.length,
    },
    emails,
    comments: listCommentsWithAttachments(campaign.id),
    versions: listVersions(campaign.id),
  });
}

export async function PATCH(request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
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
    const { allApproved } = setEmailApproved(emailId, approved);
    if (approved && allApproved && existing.status !== "approved") {
      markApproved(id);
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
    const campaign = markApproved(id);
    if (!campaign) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      campaign: {
        ...campaign,
        open_comments: countOpenComments(id),
        review_url: reviewUrl(campaign.magic_token),
      },
      message: "Campaign approved",
    });
  }

  const status =
    typeof body.status === "string" && STATUSES.includes(body.status)
      ? (body.status as CampaignStatus)
      : undefined;

  const campaign = updateCampaign(id, {
    title: typeof body.title === "string" ? body.title : undefined,
    clientName:
      typeof body.clientName === "string" ? body.clientName : undefined,
    description:
      typeof body.description === "string" ? body.description : undefined,
    audience:
      typeof body.audience === "string" ? body.audience : undefined,
    htmlContent:
      typeof body.htmlContent === "string" ? body.htmlContent : undefined,
    emailId: typeof body.emailId === "string" ? body.emailId : undefined,
    status,
    versionNote:
      typeof body.versionNote === "string" ? body.versionNote : undefined,
  });

  return NextResponse.json({
    campaign: {
      ...campaign,
      open_comments: countOpenComments(id),
      review_url: reviewUrl(campaign!.magic_token),
    },
    emails: listEmails(id),
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
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
