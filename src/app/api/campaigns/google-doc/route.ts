import { NextResponse } from "next/server";
import { canOrSync, sessionCampaignKind } from "@/lib/auth";
import { campaignFitsKindScope, getCampaignById, getEmailById, updateEmail } from "@/lib/campaigns";
import { importPublicGoogleDoc } from "@/lib/google-doc-import";

export const maxDuration = 60;

// One paste box in the SEO blog editor. A public Google Doc becomes the
// markdown the article editor already stores, and an existing blog post is
// saved as a new version so review and approval keep working.
export async function POST(request: Request) {
  if (!(await canOrSync(request, "tool.campaign_edit"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const url = typeof body.url === "string" ? body.url : "";
  const imported = await importPublicGoogleDoc(url);
  if (!imported.ok) {
    return NextResponse.json({ error: imported.error }, { status: 400 });
  }

  const campaignId = typeof body.campaignId === "string" ? body.campaignId : "";
  const emailId = typeof body.emailId === "string" ? body.emailId : "";
  if (!campaignId && !emailId) {
    return NextResponse.json({
      markdown: imported.markdown,
      title: imported.title,
      saved: false,
    });
  }
  if (!campaignId || !emailId) {
    return NextResponse.json({ error: "Missing blog post." }, { status: 400 });
  }

  const kindScope = await sessionCampaignKind();
  if (kindScope && !campaignFitsKindScope(campaignId, kindScope)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!getCampaignById(campaignId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const existing = getEmailById(emailId);
  if (!existing || existing.campaign_id !== campaignId) {
    return NextResponse.json({ error: "Blog post not found" }, { status: 404 });
  }
  if (existing.kind !== "blog") {
    return NextResponse.json(
      { error: "Google Doc import is only for blog posts." },
      { status: 400 }
    );
  }

  const email = updateEmail(emailId, {
    htmlContent: imported.markdown,
    bodyFormat: "markdown",
    versionNote: "Imported from Google Doc",
  });
  return NextResponse.json({
    markdown: imported.markdown,
    title: imported.title,
    saved: true,
    email,
  });
}
