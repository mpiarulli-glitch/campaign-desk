import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import {
  createCampaign,
  listCampaigns,
  listArchivedCampaigns,
  countOpenComments,
  countEmails,
} from "@/lib/campaigns";

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
  const description =
    typeof body.description === "string" ? body.description : "";
  const audience = typeof body.audience === "string" ? body.audience : "";
  const emailTitle =
    typeof body.emailTitle === "string" ? body.emailTitle : "Email 1";
  const kind = body.kind === "interactive" ? "interactive" : "email";

  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  if (!htmlContent.trim()) {
    return NextResponse.json(
      { error: "HTML content is required" },
      { status: 400 }
    );
  }

  const campaign = createCampaign({
    title,
    clientName,
    description,
    audience,
    htmlContent,
    emailTitle,
    kind,
  });

  return NextResponse.json({ campaign }, { status: 201 });
}
