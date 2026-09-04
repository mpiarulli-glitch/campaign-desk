import { NextResponse } from "next/server";
import { isSocialQaAuthenticated, sessionActor } from "@/lib/auth";
import {
  deleteSocialPost,
  getSocialPost,
  updateSocialPost,
} from "@/lib/social-qa";

type Params = { params: Promise<{ id: string; postId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  if (!(await isSocialQaAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id, postId } = await params;
  const current = getSocialPost(postId);
  if (!current || current.batch_id !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const actor = await sessionActor();
  const post = updateSocialPost(postId, {
    title: typeof body.title === "string" ? body.title : undefined,
    channel: typeof body.channel === "string" ? body.channel : undefined,
    goLiveOn: typeof body.goLiveOn === "string" ? body.goLiveOn : undefined,
    createdBy: typeof body.createdBy === "string" ? body.createdBy : undefined,
    issueTag: typeof body.issueTag === "string" ? body.issueTag : undefined,
    issueNote: typeof body.issueNote === "string" ? body.issueNote : undefined,
    qaBy: body.markQa === true ? actor : undefined,
    clearQa: body.clearQa === true,
  });
  return NextResponse.json({ post });
}

export async function DELETE(_request: Request, { params }: Params) {
  if (!(await isSocialQaAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id, postId } = await params;
  const current = getSocialPost(postId);
  if (!current || current.batch_id !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  deleteSocialPost(postId);
  return NextResponse.json({ ok: true });
}
