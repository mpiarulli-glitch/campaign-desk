import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { logHubCampaign } from "@/lib/lifecycle-hub";
import { getRevClient } from "@/lib/revenue";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const { clientId } = await params;
  if (!getRevClient(clientId)) {
    return NextResponse.json({ error: "Unknown client." }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title : "";
  if (!title.trim()) {
    return NextResponse.json({ error: "Add a title." }, { status: 400 });
  }
  const sentOn = typeof body.sentOn === "string" ? body.sentOn : undefined;
  const status = body.status === "approved" ? "approved" : "sent";
  const result = logHubCampaign(clientId, { title, sentOn, status });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
