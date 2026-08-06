import { NextResponse } from "next/server";
import { isAdminOrSyncAuthenticated } from "@/lib/auth";
import {
  addEmail,
  deleteEmail,
  getCampaignById,
  getEmailById,
  listEmails,
  updateEmail,
  countOpenComments,
} from "@/lib/campaigns";
import { coerceKind, coerceFormat, isBodyFormat } from "@/lib/asset-kinds";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  if (!(await isAdminOrSyncAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!getCampaignById(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const emails = listEmails(id).map((e) => ({
    ...e,
    open_comments: countOpenComments(id, e.id),
  }));

  return NextResponse.json({ emails });
}

export async function POST(request: Request, { params }: Params) {
  if (!(await isAdminOrSyncAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!getCampaignById(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : `Item ${listEmails(id).length + 1}`;
  const htmlContent =
    typeof body.htmlContent === "string" ? body.htmlContent : "";
  const kind = coerceKind(body.kind);
  const bodyFormat = coerceFormat(kind, body.bodyFormat);
  const mediaUrl = typeof body.mediaUrl === "string" ? body.mediaUrl : "";

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

  const email = addEmail({
    campaignId: id,
    title,
    htmlContent,
    kind,
    bodyFormat,
    mediaUrl,
  });

  return NextResponse.json({ email }, { status: 201 });
}

export async function PATCH(request: Request, { params }: Params) {
  if (!(await isAdminOrSyncAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!getCampaignById(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const emailId = typeof body.emailId === "string" ? body.emailId : "";
  if (!emailId) {
    return NextResponse.json({ error: "emailId is required" }, { status: 400 });
  }

  const existing = getEmailById(emailId);
  if (!existing || existing.campaign_id !== id) {
    return NextResponse.json({ error: "Email not found" }, { status: 404 });
  }

  const email = updateEmail(emailId, {
    title: typeof body.title === "string" ? body.title : undefined,
    htmlContent:
      typeof body.htmlContent === "string" ? body.htmlContent : undefined,
    purpose: typeof body.purpose === "string" ? body.purpose : undefined,
    versionNote:
      typeof body.versionNote === "string" ? body.versionNote : undefined,
    bodyFormat: isBodyFormat(body.bodyFormat) ? body.bodyFormat : undefined,
    mediaUrl: typeof body.mediaUrl === "string" ? body.mediaUrl : undefined,
  });

  return NextResponse.json({ email });
}

export async function DELETE(request: Request, { params }: Params) {
  if (!(await isAdminOrSyncAuthenticated(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!getCampaignById(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const emailId = typeof body.emailId === "string" ? body.emailId : "";
  if (!emailId) {
    return NextResponse.json({ error: "emailId is required" }, { status: 400 });
  }

  const existing = getEmailById(emailId);
  if (!existing || existing.campaign_id !== id) {
    return NextResponse.json({ error: "Email not found" }, { status: 404 });
  }

  const ok = deleteEmail(emailId);
  if (!ok) {
    return NextResponse.json(
      { error: "A package must keep at least one email." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, emails: listEmails(id) });
}
