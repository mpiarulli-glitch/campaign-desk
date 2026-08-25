import { NextResponse } from "next/server";
import { isAdminAuthenticated, sessionUserSlug } from "@/lib/auth";
import { asPerson, hasConnection, SERVICE } from "@/lib/basecamp";
import {
  internalReviewState,
  sendCampaignForInternalReview,
} from "@/lib/internal-review";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const state = await internalReviewState(id);
  if (!state) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(state);
}

export async function POST(request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
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
      { error: "Pick the account manager who should review this." },
      { status: 400 }
    );
  }
  const dueOn =
    typeof body.dueOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dueOn.trim())
      ? body.dueOn.trim()
      : null;

  const sender = await sessionUserSlug();
  const identity = sender && hasConnection(sender) ? asPerson(sender) : SERVICE;
  const result = await sendCampaignForInternalReview({
    campaignId: id,
    reviewerId,
    dueOn,
    identity,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
