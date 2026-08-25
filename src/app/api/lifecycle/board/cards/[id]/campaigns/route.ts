import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { logOffAppCampaign } from "@/lib/lifecycle-board";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title : "";
  if (!title.trim()) {
    return NextResponse.json({ error: "Add a title." }, { status: 400 });
  }
  const sentOn = typeof body.sentOn === "string" ? body.sentOn : undefined;
  const status = body.status === "approved" ? "approved" : "sent";
  const card = logOffAppCampaign(id, { title, sentOn, status });
  if (!card) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ card });
}
