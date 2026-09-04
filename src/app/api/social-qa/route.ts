import { NextResponse } from "next/server";
import { isSocialQaAuthenticated, sessionActor, sessionUserSlug } from "@/lib/auth";
import { asPerson, hasConnection, SERVICE } from "@/lib/basecamp";
import {
  createSocialBatch,
  getSocialBatch,
  listSocialBatches,
  sendSocialBatchForQa,
} from "@/lib/social-qa";

export async function GET(request: Request) {
  if (!(await isSocialQaAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const archived = new URL(request.url).searchParams.get("archived") === "1";
  return NextResponse.json({ batches: listSocialBatches(archived) });
}

export async function POST(request: Request) {
  if (!(await isSocialQaAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }
  const createdBy = await sessionActor();
  const batch = createSocialBatch({
    title,
    clientName: typeof body.clientName === "string" ? body.clientName : "",
    clientId: typeof body.clientId === "string" && body.clientId ? body.clientId : null,
    sproutUrl: typeof body.sproutUrl === "string" ? body.sproutUrl : "",
    notes: typeof body.notes === "string" ? body.notes : "",
    createdBy,
  });

  const sendForReview = body.sendForReview === true;
  const reviewerSlug =
    typeof body.reviewerSlug === "string" ? body.reviewerSlug.trim() : "";
  const dueOn =
    typeof body.dueOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dueOn.trim())
      ? body.dueOn.trim()
      : null;

  if (sendForReview) {
    const sender = await sessionUserSlug();
    const identity = sender && hasConnection(sender) ? asPerson(sender) : SERVICE;
    const sent = await sendSocialBatchForQa({
      batchId: batch.id,
      reviewerSlug,
      dueOn,
      identity,
    });
    if (!sent.ok) {
      return NextResponse.json(
        { batch: getSocialBatch(batch.id), error: sent.error },
        { status: 201 }
      );
    }
    return NextResponse.json(
      { batch: getSocialBatch(batch.id), sent },
      { status: 201 }
    );
  }

  return NextResponse.json({ batch }, { status: 201 });
}
