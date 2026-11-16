import { NextResponse } from "next/server";
import { canOrSync, reviewUrl, sessionCampaignKind } from "@/lib/auth";
import {
  normalizeCampaignDescription,
  normalizeCampaignTitle,
} from "@/lib/campaign-copy";
import {
  campaignFitsKindScope,
  countOpenComments,
  getCampaignById,
  updateCampaign,
} from "@/lib/campaigns";

type Params = { params: Promise<{ id: string }> };

// Staff edit of a review package's title and description. Separate from the
// kitchen-sink campaign PATCH so a bad title is rejected before any other
// change, and so the copy rules live in one place. Lists and the client
// review link read these columns, so a successful write shows up there too.
export async function PATCH(request: Request, { params }: Params) {
  if (!(await canOrSync(request, "tool.campaign_edit"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existing = getCampaignById(id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Same wall as opening the package: a blog-scoped session cannot rename an
  // email package by pasting its id, and the owner's no-blog scope cannot
  // rename a blog package they are not shown.
  const kindScope = await sessionCampaignKind();
  if (kindScope && !campaignFitsKindScope(id, kindScope)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  const hasTitle = Object.prototype.hasOwnProperty.call(record, "title");
  const hasDescription = Object.prototype.hasOwnProperty.call(
    record,
    "description"
  );
  if (!hasTitle && !hasDescription) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const updates: { title?: string; description?: string } = {};
  if (hasTitle) {
    const title = normalizeCampaignTitle(record.title, existing.title);
    if (!title.ok) {
      return NextResponse.json({ error: title.error }, { status: 400 });
    }
    updates.title = title.title;
  }
  if (hasDescription) {
    const description = normalizeCampaignDescription(
      record.description,
      existing.description
    );
    if (!description.ok) {
      return NextResponse.json({ error: description.error }, { status: 400 });
    }
    updates.description = description.description;
  }

  const campaign = updateCampaign(id, updates);
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    campaign: {
      ...campaign,
      open_comments: countOpenComments(id),
      review_url: reviewUrl(campaign.magic_token),
      external_review_url: reviewUrl(campaign.external_token),
    },
  });
}
