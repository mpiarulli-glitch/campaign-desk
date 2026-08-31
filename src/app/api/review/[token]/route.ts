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
  listFlowSteps,
  ensureAutomationFlow,
  setChosenSubject,
  updateCampaign,
  markApproved,
  unapproveCampaign,
  setEmailApproved,
  countOpenComments,
  approvalChannelForReview,
  reviewAcceptsViewerAction,
} from "@/lib/campaigns";
import type { Campaign, ReviewChannel } from "@/lib/db";
import { syncCampaignDeliverablesCard } from "@/lib/campaign-card-sync";
import { MAX_QUOTE_CHARS, quotedFeedback } from "@/lib/copy-quote";
import { notifyClientFeedback } from "@/lib/notify";
import { statusAfterReviewLinkView } from "@/lib/campaign-status";

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

// Which admin approved internally is agency-internal information, not
// something a client reading their own review link needs to see — so only a
// client's own typed approval name ever crosses onto this link.
//
// After a boss internal approve, the client link must stay open: rewrite
// status back to in_review and flag internally_approved so the page can say
// "waiting for your approval" instead of locking like they already signed off.
function publicCampaign(campaign: Campaign, viewer: ReviewChannel) {
  const internalOnly =
    campaign.status === "approved" && campaign.approved_channel === "internal";
  const hideFromClient = viewer === "external" && internalOnly;
  const clientSeesInReview =
    hideFromClient ||
    (viewer === "external" &&
      (campaign.status === "internal_review" ||
        campaign.status === "needs_revisions_internal"));
  return {
    id: campaign.id,
    title: campaign.title,
    client_name: campaign.client_name,
    description: campaign.description,
    status: clientSeesInReview ? "in_review" : campaign.status,
    updated_at: campaign.updated_at,
    approved_at: hideFromClient
      ? null
      : campaign.approved_channel === "client" || viewer === "internal"
        ? campaign.approved_at
        : null,
    approved_by:
      viewer === "external" && campaign.approved_channel !== "client"
        ? null
        : campaign.approved_by,
    internally_approved: internalOnly,
    presentation: campaign.presentation,
    trigger_label: campaign.trigger_label,
    trigger_kind: campaign.trigger_kind,
  };
}

// A client must type a first and last name before an approval counts, so the
// approval leaves a real paper trail instead of a click from an anonymous link.
function isFullName(name: string): boolean {
  return name.trim().split(/\s+/).filter(Boolean).length >= 2;
}

export async function GET(_request: Request, { params }: Params) {
  const { token } = await params;
  const match = getCampaignByAnyToken(token);
  if (!match) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { channel } = match;
  const campaign = match.campaign;

  const next = statusAfterReviewLinkView(campaign.status, channel);
  if (next) {
    updateCampaign(campaign.id, { status: next as Campaign["status"] });
  }

  const fresh = getCampaignById(campaign.id)!;
  // Only filter open-comment counts for the external link; internal keeps
  // seeing the full total across both channels.
  const countChannel = channel === "external" ? channel : undefined;
  const emails = listEmailsWithSubjects(fresh.id).map((e) => ({
    id: e.id,
    title: e.title,
    html_content: e.html_content,
    kind: e.kind,
    body_format: e.body_format,
    media_url: e.media_url,
    purpose: e.purpose,
    delay_ms: e.delay_ms ?? 0,
    sort_order: e.sort_order,
    approved_at:
      channel === "external" && e.approved_channel !== "client"
        ? null
        : e.approved_at,
    approved_by:
      channel === "external" && e.approved_channel !== "client"
        ? null
        : e.approved_by,
    chosen_subject_id: e.chosen_subject_id,
    subjects: e.subjects.map((s) => ({
      id: s.id,
      subject: s.subject,
      preview_text: s.preview_text,
    })),
    open_comments: countOpenComments(fresh.id, e.id, countChannel),
  }));
  if (fresh.presentation === "automation") {
    ensureAutomationFlow(fresh.id);
  }

  return NextResponse.json({
    campaign: publicCampaign(fresh, channel),
    emails,
    flow: listFlowSteps(fresh.id),
    comments: listCommentsWithAttachments(fresh.id, undefined, countChannel).map(
      (c) => ({
        id: c.id,
        email_id: c.email_id,
        author_name: c.author_name,
        body: c.body,
        type: c.type,
        pin_x: c.pin_x,
        pin_y: c.pin_y,
        quote_text: c.quote_text,
        quote_ordinal: c.quote_ordinal,
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

  const approvedChannel = approvalChannelForReview(channel);

  if (body.markApproved === true) {
    if (!reviewAcceptsViewerAction(campaign, channel)) {
      return NextResponse.json({
        campaign: publicCampaign(campaign, channel),
        message: "Already approved",
      });
    }

    const approverName =
      typeof body.approverName === "string" ? body.approverName.trim() : "";
    if (!isFullName(approverName)) {
      return NextResponse.json(
        { error: "Enter your full name to approve." },
        { status: 400 }
      );
    }

    const approved = markApproved(campaign.id, approverName, approvedChannel);
    await syncCampaignDeliverablesCard(campaign.id, "approved");
    return NextResponse.json({
      campaign: publicCampaign(approved!, channel),
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
    const approverName =
      typeof body.approverName === "string" ? body.approverName.trim() : "";
    if (!isFullName(approverName)) {
      return NextResponse.json(
        { error: "Enter your full name to approve." },
        { status: 400 }
      );
    }
    const target = listEmails(campaign.id).find(
      (e) => e.id === body.approveEmail
    );
    if (!target) {
      return NextResponse.json({ error: "Email not found" }, { status: 404 });
    }
    const { allApproved } = setEmailApproved(
      target.id,
      true,
      approverName,
      approvedChannel
    );
    if (allApproved && reviewAcceptsViewerAction(campaign, channel)) {
      markApproved(campaign.id, approverName, approvedChannel);
      await syncCampaignDeliverablesCard(campaign.id, "approved");
    }
    const fresh = getCampaignById(campaign.id)!;
    return NextResponse.json({
      campaign: publicCampaign(fresh, channel),
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
      unapproveCampaign(campaign.id);
    }
    const fresh = getCampaignById(campaign.id)!;
    return NextResponse.json({
      campaign: publicCampaign(fresh, channel),
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

  if (!reviewAcceptsViewerAction(campaign, channel)) {
    return NextResponse.json(
      { error: "This campaign is approved and no longer accepting feedback." },
      { status: 403 }
    );
  }

  const text = typeof body.body === "string" ? body.body.trim() : "";
  const authorName =
    typeof body.authorName === "string" ? body.authorName : "Reviewer";
  const quoteText =
    typeof body.quoteText === "string"
      ? body.quoteText.trim().slice(0, MAX_QUOTE_CHARS)
      : "";
  const quoteOrdinal =
    typeof body.quoteOrdinal === "number" && Number.isFinite(body.quoteOrdinal)
      ? Math.max(0, Math.floor(body.quoteOrdinal))
      : 0;
  const type =
    body.type === "inline" || quoteText ? "inline" : "general";
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

  if (type === "inline" && !quoteText && (pinX === null || pinY === null)) {
    return NextResponse.json(
      { error: "Highlight a passage of copy, or drop a pin, before commenting" },
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
    quoteText: quoteText || null,
    quoteOrdinal: quoteText ? quoteOrdinal : null,
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
    body: quotedFeedback(
      quoteText || null,
      text ||
        (images.length === 1
          ? "(image attached)"
          : `(${images.length} images attached)`)
    ),
    emailTitle: targetEmail.title,
  });

  return NextResponse.json({ comment }, { status: 201 });
}
