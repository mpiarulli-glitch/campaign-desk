import { NextResponse } from "next/server";
import {
  addComment,
  addCommentAttachment,
  getCampaignByToken,
  listCommentsWithAttachments,
  listEmails,
  updateCampaign,
  markApproved,
  countOpenComments,
} from "@/lib/campaigns";
import { notifyClientFeedback } from "@/lib/notify";

const ALLOWED_IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB per image after decode

type IncomingImage = {
  mime: string;
  dataBase64: string;
  width?: number;
  height?: number;
};

// Validate and normalize the images array from a review submission.
function parseImages(raw: unknown): IncomingImage[] {
  if (!Array.isArray(raw)) return [];
  const out: IncomingImage[] = [];
  for (const item of raw.slice(0, MAX_IMAGES)) {
    if (!item || typeof item !== "object") continue;
    const mime = (item as Record<string, unknown>).mime;
    const data = (item as Record<string, unknown>).dataBase64;
    if (typeof mime !== "string" || !ALLOWED_IMAGE_MIME.has(mime)) continue;
    if (typeof data !== "string" || data.length === 0) continue;
    // Rough decoded-size guard (base64 is ~4/3 of raw bytes).
    if ((data.length * 3) / 4 > MAX_IMAGE_BYTES) continue;
    const width = (item as Record<string, unknown>).width;
    const height = (item as Record<string, unknown>).height;
    out.push({
      mime,
      dataBase64: data,
      width: typeof width === "number" ? width : undefined,
      height: typeof height === "number" ? height : undefined,
    });
  }
  return out;
}

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
    comments: listCommentsWithAttachments(fresh.id).map((c) => ({
      id: c.id,
      email_id: c.email_id,
      author_name: c.author_name,
      body: c.body,
      type: c.type,
      pin_x: c.pin_x,
      pin_y: c.pin_y,
      resolved: c.resolved,
      created_at: c.created_at,
      attachments: c.attachments,
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
  const images = parseImages(body.images);

  if (!text && images.length === 0) {
    return NextResponse.json(
      { error: "Add a comment or attach an image" },
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

  for (const img of images) {
    addCommentAttachment({
      commentId: comment.id,
      campaignId: campaign.id,
      mime: img.mime,
      data: img.dataBase64,
      width: img.width ?? null,
      height: img.height ?? null,
    });
  }

  notifyClientFeedback({
    campaignTitle: campaign.title,
    clientName: campaign.client_name,
    authorName,
    body:
      text ||
      (images.length === 1
        ? "(image attached)"
        : `(${images.length} images attached)`),
    emailTitle: targetEmail.title,
  });

  return NextResponse.json({ comment }, { status: 201 });
}
