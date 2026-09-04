import { NextResponse } from "next/server";
import {
  canOrSync,
  isCampaignsReadAuthenticated,
  sessionCampaignKind,
} from "@/lib/auth";
import {
  createCampaign,
  listCampaigns,
  listArchivedCampaigns,
  listCampaignsWithKind,
  countOpenComments,
  countEmails,
  listEmailKinds,
} from "@/lib/campaigns";
import { coerceKind, coerceFormat } from "@/lib/asset-kinds";
import {
  coercePresentation,
  coerceTriggerKind,
  coerceTriggerFormFormat,
} from "@/lib/automation-map";

export async function GET(request: Request) {
  // Read follows page.campaigns. The list is filtered to the session's campaign
  // kind scope when the owner set one (or TEAM_FOCUS defaults to blogs).
  if (!(await isCampaignsReadAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const archived =
    new URL(request.url).searchParams.get("archived") === "1";

  const kindScope = await sessionCampaignKind();
  const source = kindScope
    ? listCampaignsWithKind(kindScope, { archived })
    : archived
      ? listArchivedCampaigns()
      : listCampaigns();

  const campaigns = source.map((c) => ({
    ...c,
    open_comments: countOpenComments(c.id),
    email_count: countEmails(c.id),
    email_kinds: listEmailKinds(c.id),
    review_path: `/review/${c.magic_token}`,
  }));

  return NextResponse.json({ campaigns, scope: kindScope || "all" });
}

export async function POST(request: Request) {
  if (!(await canOrSync(request, "tool.campaign_edit"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const htmlContent =
    typeof body.htmlContent === "string" ? body.htmlContent : "";
  const clientName =
    typeof body.clientName === "string" ? body.clientName : "";
  const clientId = typeof body.clientId === "string" && body.clientId ? body.clientId : null;
  const description =
    typeof body.description === "string" ? body.description : "";
  const audience = typeof body.audience === "string" ? body.audience : "";
  const emailTitle =
    typeof body.emailTitle === "string" ? body.emailTitle : "Item 1";
  const presentation = coercePresentation(body.presentation);
  const triggerLabel =
    typeof body.triggerLabel === "string" ? body.triggerLabel : "";
  const triggerKind = coerceTriggerKind(body.triggerKind);
  const triggerFormFormat = coerceTriggerFormFormat(body.triggerFormFormat);
  const triggerFormHtml =
    typeof body.triggerFormHtml === "string" ? body.triggerFormHtml : "";
  const triggerFormMediaUrl =
    typeof body.triggerFormMediaUrl === "string"
      ? body.triggerFormMediaUrl
      : "";
  const kind = coerceKind(body.kind);
  const bodyFormat = coerceFormat(kind, body.bodyFormat);
  const mediaUrl = typeof body.mediaUrl === "string" ? body.mediaUrl : "";

  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  // Image/Figma mock-ups carry their artwork in mediaUrl, so HTML is optional.
  // Everything else needs body content, except an automation which can start
  // with a blank first email and be filled in on the editor.
  const needsMedia = bodyFormat === "image" || bodyFormat === "figma";
  if (needsMedia && !mediaUrl.trim()) {
    return NextResponse.json(
      { error: "An image or Figma link is required" },
      { status: 400 }
    );
  }
  if (!needsMedia && !htmlContent.trim() && presentation !== "automation") {
    return NextResponse.json(
      { error: "Content is required" },
      { status: 400 }
    );
  }

  const campaign = createCampaign({
    title,
    clientName,
    clientId,
    description,
    audience,
    htmlContent: htmlContent.trim() ? htmlContent : "<p></p>",
    emailTitle: presentation === "automation" ? "Email 1" : emailTitle,
    kind,
    bodyFormat,
    mediaUrl,
    presentation,
    triggerLabel,
    triggerKind,
    triggerFormFormat,
    triggerFormHtml,
    triggerFormMediaUrl,
  });

  return NextResponse.json({ campaign }, { status: 201 });
}
