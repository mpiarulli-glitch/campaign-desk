import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import {
  createCampaign,
  listCampaigns,
  listArchivedCampaigns,
  countOpenComments,
  countEmails,
} from "@/lib/campaigns";
import { coerceKind, coerceFormat } from "@/lib/asset-kinds";

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const archived =
    new URL(request.url).searchParams.get("archived") === "1";
  const source = archived ? listArchivedCampaigns() : listCampaigns();

  const campaigns = source.map((c) => ({
    ...c,
    open_comments: countOpenComments(c.id),
    email_count: countEmails(c.id),
    review_path: `/review/${c.magic_token}`,
  }));

  return NextResponse.json({ campaigns });
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
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
  const kind = coerceKind(body.kind);
  const bodyFormat = coerceFormat(kind, body.bodyFormat);
  const mediaUrl = typeof body.mediaUrl === "string" ? body.mediaUrl : "";

  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  // Image/Figma mock-ups carry their artwork in mediaUrl, so HTML is optional.
  // Everything else needs body content.
  const needsMedia = bodyFormat === "image" || bodyFormat === "figma";
  if (needsMedia && !mediaUrl.trim()) {
    return NextResponse.json(
      { error: "An image or Figma link is required" },
      { status: 400 }
    );
  }
  if (!needsMedia && !htmlContent.trim()) {
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
    htmlContent,
    emailTitle,
    kind,
    bodyFormat,
    mediaUrl,
  });

  return NextResponse.json({ campaign }, { status: 201 });
}
