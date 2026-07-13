import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import {
  addEmail,
  deleteEmail,
  getCampaignById,
  getEmailById,
  listEmails,
  updateEmail,
  countOpenComments,
} from "@/lib/campaigns";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
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
  if (!(await isAdminAuthenticated())) {
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
      : `Email ${listEmails(id).length + 1}`;
  const htmlContent =
    typeof body.htmlContent === "string" ? body.htmlContent : "";

  if (!htmlContent.trim()) {
    return NextResponse.json(
      { error: "HTML content is required" },
      { status: 400 }
    );
  }

  const email = addEmail({
    campaignId: id,
    title,
    htmlContent,
  });

  return NextResponse.json({ email }, { status: 201 });
}

export async function PATCH(request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
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
  });

  return NextResponse.json({ email });
}

export async function DELETE(request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
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
