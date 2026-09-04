import { NextResponse } from "next/server";
import { isSocialQaAuthenticated, sessionActor, sessionUserSlug } from "@/lib/auth";
import { asPerson, hasConnection, SERVICE } from "@/lib/basecamp";
import { signOffSocialBatch } from "@/lib/social-qa";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  if (!(await isSocialQaAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const approvedBy = typeof body.approvedBy === "string" ? body.approvedBy : "";
  const sender = await sessionUserSlug();
  const identity = sender && hasConnection(sender) ? asPerson(sender) : SERVICE;
  const result = await signOffSocialBatch({
    batchId: id,
    approvedBy,
    actorSlug: await sessionActor(),
    identity,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
