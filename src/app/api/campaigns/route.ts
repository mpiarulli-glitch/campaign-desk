import { NextResponse } from "next/server";
import {
  isAdminOrSyncAuthenticated,
  isBlogScopedSession,
  isCampaignsReadAuthenticated,
} from "@/lib/auth";
import {
  createCampaign,
  listCampaigns,
  listArchivedCampaigns,
  listCampaignsWithKind,
  countOpenComments,
  countEmails,
} from "@/lib/campaigns";
import { coerceKind, coerceFormat } from "@/lib/asset-kinds";
import {
  coercePresentation,
  coerceTriggerKind,
} from "@/lib/automation-map";

export async function GET(request: Request) {
  // Read is open to admins and to the SEO-side people; the list they get back is
  // filtered to blogs below.
  if (!(await isCampaignsReadAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const archived =
    new URL(request.url).searchParams.get("archived") === "1";

  // The SEO side of the team works on blog content only, so their list is
  // filtered to campaigns containing a blog item rather than every client email.
  const blogOnly = await isBlogScopedSession();
  const source = blogOnly
    ? listCampaignsWithKind("blog", { archived })
    : archived
      ? listArchivedCampaigns()
      : listCampaigns();

  const campaigns = source.map((c) => ({
    ...c,
    open_comments: countOpenComments(c.id),
    email_count: countEmails(c.id),
    review_path: `/review/${c.magic_token}`,
  }));

  return NextResponse.json({ campaigns, scope: blogOnly ? "blog" : "all" });
}

export async function POST(request: Request) {
  if (!(await isAdminOrSyncAuthenticated(request))) {
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
  });

  return NextResponse.json({ campaign }, { status: 201 });
}
