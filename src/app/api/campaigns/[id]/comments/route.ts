import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import {
  addReply,
  getCampaignById,
  listComments,
  listCommentsWithAttachments,
  setCommentResolved,
} from "@/lib/campaigns";

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

  return NextResponse.json({ comments: listComments(id) });
}

export async function PATCH(request: Request, { params }: Params) {
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
  const resolved = Boolean(body.resolved);

  if (!commentId) {
    return NextResponse.json(
      { error: "commentId is required" },
      { status: 400 }
    );
  }

  const comment = setCommentResolved(commentId, resolved);
  if (!comment || comment.campaign_id !== id) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

  return NextResponse.json({ comment });
}

// Admin posts a reply to a comment.
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
  const text = typeof body.body === "string" ? body.body.trim() : "";
  const authorName =
    typeof body.authorName === "string" && body.authorName.trim()
      ? body.authorName.trim()
      : "Marketing Empire Group";

  if (!commentId || !text) {
    return NextResponse.json(
      { error: "commentId and body are required" },
      { status: 400 }
    );
  }

  const parent = listCommentsWithAttachments(id).find((c) => c.id === commentId);
  if (!parent) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

  const reply = addReply({
    commentId,
    campaignId: id,
    authorName,
    body: text,
    isAdmin: true,
  });

  return NextResponse.json({ reply }, { status: 201 });
}
