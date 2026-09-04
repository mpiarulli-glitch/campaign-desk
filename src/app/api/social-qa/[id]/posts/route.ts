import { NextResponse } from "next/server";
import { isSocialQaAuthenticated, sessionActor } from "@/lib/auth";
import { addSocialPost } from "@/lib/social-qa";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  if (!(await isSocialQaAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "Post title is required." }, { status: 400 });
  }
  const createdBy =
    typeof body.createdBy === "string" && body.createdBy.trim()
      ? body.createdBy.trim()
      : await sessionActor();
  const post = addSocialPost(id, {
    title,
    channel: typeof body.channel === "string" ? body.channel : "",
    goLiveOn: typeof body.goLiveOn === "string" ? body.goLiveOn : null,
    createdBy,
  });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ post }, { status: 201 });
}
