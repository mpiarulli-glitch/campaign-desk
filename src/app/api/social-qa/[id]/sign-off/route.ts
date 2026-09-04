import { NextResponse } from "next/server";
import { isSocialQaAuthenticated, sessionActor, sessionUserSlug } from "@/lib/auth";
import { asPerson, hasConnection, SERVICE } from "@/lib/basecamp";
import { reviewSocialBatch } from "@/lib/social-qa";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  if (!(await isSocialQaAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const reviewedBy =
    typeof body.approvedBy === "string"
      ? body.approvedBy
      : typeof body.reviewedBy === "string"
        ? body.reviewedBy
        : "";
  const approved = body.approved !== false && body.rejected !== true;
  const sender = await sessionUserSlug();
  const identity = sender && hasConnection(sender) ? asPerson(sender) : SERVICE;
  const result = await reviewSocialBatch({
    batchId: id,
    approved,
    reviewedBy,
    actorSlug: await sessionActor(),
    identity,
    checklist: body.checklist,
    feedback: typeof body.feedback === "string" ? body.feedback : "",
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
