import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { basecampConnected, createScheduleCard, listProjects } from "@/lib/basecamp";

// Manual verification helper for the "Pending Production Scheduling" card the
// reminder job creates. GET lists projects to pick one; POST drops a single
// clearly-labeled test card into it. Never touches client records or the
// reminder sweep, so it's safe to run against the live Basecamp connection
// without affecting real clients.
export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!basecampConnected()) {
    return NextResponse.json({ error: "Connect Basecamp first." }, { status: 400 });
  }
  const projects = await listProjects();
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!basecampConnected()) {
    return NextResponse.json({ error: "Connect Basecamp first." }, { status: 400 });
  }
  const body = await request.json().catch(() => ({}));
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const title = "TEST: Pending Production Scheduling";
  const contentHtml =
    "<div><strong>This is a test card</strong> from Campaign Desk, verifying the reminder job's card creation. Safe to delete.</div>";

  const result = await createScheduleCard(projectId, title, contentHtml);
  return NextResponse.json(result);
}
