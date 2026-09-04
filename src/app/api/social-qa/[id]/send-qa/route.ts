import { NextResponse } from "next/server";
import { isSocialQaAuthenticated, sessionUserSlug } from "@/lib/auth";
import { asPerson, hasConnection, SERVICE } from "@/lib/basecamp";
import {
  INTERNAL_REVIEW_MESSAGE_MAX_CHARS,
  sendSocialBatchForQa,
  socialQaState,
} from "@/lib/social-qa";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  if (!(await isSocialQaAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const state = await socialQaState(id);
  if (!state) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(state);
}

export async function POST(request: Request, { params }: Params) {
  if (!(await isSocialQaAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const reviewerId =
    Number.isInteger(body.reviewerId) && body.reviewerId > 0
      ? (body.reviewerId as number)
      : 0;
  if (!reviewerId) {
    return NextResponse.json(
      { error: "Pick the teammate who should QA this batch." },
      { status: 400 }
    );
  }
  const dueOn =
    typeof body.dueOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dueOn.trim())
      ? body.dueOn.trim()
      : null;
  let message: string | null = null;
  if (typeof body.message === "string") {
    const trimmed = body.message.replace(/\r\n/g, "\n").trim();
    if (trimmed.length > INTERNAL_REVIEW_MESSAGE_MAX_CHARS) {
      return NextResponse.json(
        { error: "That QA note is too long to send." },
        { status: 400 }
      );
    }
    message = trimmed || null;
  }
  const sender = await sessionUserSlug();
  const identity = sender && hasConnection(sender) ? asPerson(sender) : SERVICE;
  const result = await sendSocialBatchForQa({
    batchId: id,
    reviewerId,
    dueOn,
    identity,
    message,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
