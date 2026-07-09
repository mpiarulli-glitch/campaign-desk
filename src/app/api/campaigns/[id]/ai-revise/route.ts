import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { reviseEmailWithGrok, continueRevisionWithGrok } from "@/lib/ai-revise";
import type { ChatMessage } from "@/lib/ai-revise";
import {
  getCampaignById,
  getEmailById,
  listEmails,
  listComments,
  updateEmail,
  setCommentResolved,
} from "@/lib/campaigns";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const campaign = getCampaignById(id);
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const commentId = typeof body.commentId === "string" ? body.commentId : "";
  const emailId = typeof body.emailId === "string" ? body.emailId : "";
  const apply = body.apply === true;
  const revisedHtml =
    typeof body.revisedHtml === "string" ? body.revisedHtml : "";

  // Apply a previously generated revision
  if (apply) {
    if (!emailId || !revisedHtml.trim()) {
      return NextResponse.json(
        { error: "emailId and revisedHtml are required to apply" },
        { status: 400 }
      );
    }

    const email = getEmailById(emailId);
    if (!email || email.campaign_id !== id) {
      return NextResponse.json({ error: "Email not found" }, { status: 404 });
    }

    const updated = updateEmail(emailId, {
      htmlContent: revisedHtml,
      versionNote:
        typeof body.versionNote === "string" && body.versionNote.trim()
          ? body.versionNote.trim()
          : "AI revision with Grok",
    });

    if (commentId) {
      setCommentResolved(commentId, true);
    }

    return NextResponse.json({
      ok: true,
      email: updated,
      message: "AI revision applied",
    });
  }

  // Handle follow-up chat message
  if (body.continue === true) {
    const history: ChatMessage[] = Array.isArray(body.history)
      ? body.history
      : [];
    const newFeedback =
      typeof body.newFeedback === "string" ? body.newFeedback.trim() : "";

    if (!emailId || !newFeedback) {
      return NextResponse.json(
        { error: "emailId and newFeedback are required for continuation" },
        { status: 400 }
      );
    }

    const email = getEmailById(emailId);
    if (!email || email.campaign_id !== id) {
      return NextResponse.json({ error: "Email not found" }, { status: 404 });
    }

    try {
      const result = await continueRevisionWithGrok(
        email.html_content,
        email.title,
        history,
        newFeedback
      );

      return NextResponse.json({
        emailId: email.id,
        revisedHtml: result.html,
        summary: result.summary,
        model: result.model,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "AI continuation failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // Generate first revision from a comment
  if (!commentId) {
    return NextResponse.json(
      { error: "commentId is required" },
      { status: 400 }
    );
  }

  const comments = listComments(id);
  const comment = comments.find((c) => c.id === commentId);
  if (!comment) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

  const emails = listEmails(id);
  const targetEmail =
    (emailId && emails.find((e) => e.id === emailId)) ||
    (comment.email_id && emails.find((e) => e.id === comment.email_id)) ||
    emails[0];

  if (!targetEmail) {
    return NextResponse.json(
      { error: "No email found for this package" },
      { status: 400 }
    );
  }

  try {
    const result = await reviseEmailWithGrok({
      html: targetEmail.html_content,
      feedback: comment.body,
      authorName: comment.author_name,
      emailTitle: targetEmail.title,
    });

    return NextResponse.json({
      emailId: targetEmail.id,
      commentId: comment.id,
      originalHtml: targetEmail.html_content,
      revisedHtml: result.html,
      summary: result.summary,
      model: result.model,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "AI revision failed unexpectedly";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
