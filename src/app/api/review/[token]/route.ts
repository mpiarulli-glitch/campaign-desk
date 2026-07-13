import { NextResponse } from "next/server";
import {
  addComment,
  addCommentAttachment,
  addReply,
  getCampaignByAnyToken,
  getCampaignById,
  listCommentsWithAttachments,
  listEmails,
  listEmailsWithSubjects,
  setChosenSubject,
  updateCampaign,
  markApproved,
  setEmailApproved,
  countOpenComments,
} from "@/lib/campaigns";
import type { Campaign } from "@/lib/db";
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

function publicCampaign(campaign: Campaign) {
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
  const match = getCampaignByAnyToken(token);
  if (!match) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { channel } = match;
  const campaign = match.campaign;

  if (campaign.status === "draft") {
    updateCampaign(campaign.id, { status: "in_review" });
  }

  const fresh = getCampaignById(campaign.id)!;
  // Only filter open-comment counts for the external link; internal keeps
  // seeing the full total across both channels.
  const countChannel = channel === "external" ? channel : undefined;
  const emails = listEmailsWithSubjects(fresh.id).map((e) => ({
    id: e.id,
    title: e.title,
    html_content: e.html_content,
    sort_order: e.sort_order,
    approved_at: e.approved_at,
    chosen_subject_id: e.chosen_subject_id,
    subjects: e.subjects.map((s) => ({
      id: s.id,
      subject: s.subject,
      preview_text: s.preview_text,
    })),
    open_comments: countOpenComments(fresh.id, e.id, countChannel),
  }));

  return NextResponse.json({
    campaign: publicCampaign(fresh),
    emails,
    comments: listCommentsWithAttachments(fresh.id, undefined, countChannel).map(
      (c) => ({
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
        replies: c.replies,
      })
    ),
  });
}

export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  const match = getCampaignByAnyToken(token);
  if (!match) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { channel } = match;
  const campaign = match.campaign;

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

  // Client picks a subject line / preview text for an email.
  if (body.chooseSubject && typeof body.chooseSubject === "object") {
    const emailId =
      typeof body.chooseSubject.emailId === "string"
        ? body.chooseSubject.emailId
        : "";
    const subjectId =
      typeof body.chooseSubject.subjectId === "string"
        ? body.chooseSubject.subjectId
        : null;
    const target = listEmailsWithSubjects(campaign.id).find(
      (e) => e.id === emailId
    );
    if (!target) {
      return NextResponse.json({ error: "Email not found" }, { status: 404 });
    }
    if (subjectId && !target.subjects.some((s) => s.id === subjectId)) {
      return NextResponse.json(
        { error: "Subject option not found" },
        { status: 400 }
      );
    }
    setChosenSubject(emailId, subjectId);
    return NextResponse.json({ ok: true });
  }

  // Approve a single email. When every email is approved, the whole campaign
  // flips to approved.
  if (typeof body.approveEmail === "string" && body.approveEmail.trim()) {
    const target = listEmails(campaign.id).find(
      (e) => e.id === body.approveEmail
    );
    if (!target) {
      return NextResponse.json({ error: "Email not found" }, { status: 404 });
    }
    const { allApproved } = setEmailApproved(target.id, true);
    if (allApproved && campaign.status !== "approved") {
      markApproved(campaign.id);
    }
    const fresh = getCampaignById(campaign.id)!;
    return NextResponse.json({
      campaign: publicCampaign(fresh),
      allApproved,
      message: allApproved
        ? "All emails approved. The team has been notified."
        : "Email approved.",
    });
  }

  // Undo a single email approval (e.g. approved by accident). If the campaign
  // had already flipped to fully approved, reopen it for review.
  if (typeof body.unapproveEmail === "string" && body.unapproveEmail.trim()) {
    const target = listEmails(campaign.id).find(
      (e) => e.id === body.unapproveEmail
    );
    if (!target) {
      return NextResponse.json({ error: "Email not found" }, { status: 404 });
    }
    setEmailApproved(target.id, false);
    if (campaign.status === "approved") {
      updateCampaign(campaign.id, { status: "in_review" });
    }
    const fresh = getCampaignById(campaign.id)!;
    return NextResponse.json({
      campaign: publicCampaign(fresh),
      message: "Approval undone. You can leave feedback again.",
    });
  }

  // Replying to an existing comment (allowed even after approval, so the
  // conversation can continue).
  if (typeof body.replyTo === "string" && body.replyTo.trim()) {
    const replyText = typeof body.body === "string" ? body.body.trim() : "";
    if (!replyText) {
      return NextResponse.json(
        { error: "Reply cannot be empty" },
        { status: 400 }
      );
    }
    const parent = listCommentsWithAttachments(campaign.id).find(
      (c) => c.id === body.replyTo
    );
    if (!parent) {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }
    // External link can only reply within its own comment thread, so it
    // can't surface (or add to) an internal-only conversation.
    if (channel === "external" && parent.channel !== "external") {
      return NextResponse.json({ error: "Comment not found" }, { status: 404 });
    }
    const replyAuthor =
      typeof body.authorName === "string" ? body.authorName : "Reviewer";
    const reply = addReply({
      commentId: parent.id,
      campaignId: campaign.id,
      authorName: replyAuthor,
      body: replyText,
      isAdmin: false,
    });
    return NextResponse.json({ reply }, { status: 201 });
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
    channel,
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
