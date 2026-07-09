import { NextResponse } from "next/server";
import {
  addComment,
  getCampaignByToken,
  listComments,
  listEmails,
  updateCampaign,
  markApproved,
  countOpenComments,
} from "@/lib/campaigns";
import { notifyClientFeedback } from "@/lib/notify";

type Params = { params: Promise<{ token: string }> };

function publicCampaign(campaign: NonNullable<ReturnType<typeof getCampaignByToken>>) {
  return {
    id: campaign.id,
    title: campaign.title,
    client_name: campaign.client_name,
    description: campaign.description,
    status: campaign.status,
    updated_at: campaign.updated_at,
  };
}

export async function GET(_request: Request, { params }: Params) {
  const { token } = await params;
  const campaign = getCampaignByToken(token);
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (campaign.status === "draft") {
    updateCampaign(campaign.id, { status: "in_review" });
  }

  const fresh = getCampaignByToken(token)!;
  const emails = listEmails(fresh.id).map((e) => ({
    id: e.id,
    title: e.title,
    html_content: e.html_content,
    sort_order: e.sort_order,
    open_comments: countOpenComments(fresh.id, e.id),
  }));

  return NextResponse.json({
    campaign: publicCampaign(fresh),
    emails,
    comments: listComments(fresh.id).map((c) => ({
      id: c.id,
      email_id: c.email_id,
      author_name: c.author_name,
      body: c.body,
      type: c.type,
      pin_x: c.pin_x,
      pin_y: c.pin_y,
      resolved: c.resolved,
      created_at: c.created_at,
    })),
  });
}

export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  const campaign = getCampaignByToken(token);
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));

  if (body.markApproved === true) {
    if (campaign.status === "approved") {
      return NextResponse.json({
        campaign: publicCampaign(campaign),
        message: "Already approved",
      });
    }

    const approved = markApproved(campaign.id);
    return NextResponse.json({
      campaign: publicCampaign(approved!),
      message: "Campaign approved",
    });
  }

  if (campaign.status === "approved") {
    return NextResponse.json(
      { error: "This campaign is approved and no longer accepting feedback." },
      { status: 403 }
    );
  }

  const text = typeof body.body === "string" ? body.body.trim() : "";
  const authorName =
    typeof body.authorName === "string" ? body.authorName : "Reviewer";
  const type = body.type === "inline" ? "inline" : "general";
  const pinX = typeof body.pinX === "number" ? body.pinX : null;
  const pinY = typeof body.pinY === "number" ? body.pinY : null;
  const emailId = typeof body.emailId === "string" ? body.emailId : null;

  if (!text) {
    return NextResponse.json(
      { error: "Comment body is required" },
      { status: 400 }
    );
  }

  if (type === "inline" && (pinX === null || pinY === null)) {
    return NextResponse.json(
      { error: "Inline comments need pin coordinates" },
      { status: 400 }
    );
  }

  const emails = listEmails(campaign.id);
  const targetEmail =
    (emailId && emails.find((e) => e.id === emailId)) || emails[0];
  if (!targetEmail) {
    return NextResponse.json(
      { error: "No emails in this package" },
      { status: 400 }
    );
  }

  const comment = addComment({
    campaignId: campaign.id,
    emailId: targetEmail.id,
    authorName,
    body: text,
    type,
    pinX,
    pinY,
  });

  notifyClientFeedback({
    campaignTitle: campaign.title,
    clientName: campaign.client_name,
    authorName,
    body: text,
    emailTitle: targetEmail.title,
  });

  return NextResponse.json({ comment }, { status: 201 });
}
