import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import {
  basecampConnected,
  createScheduleCard,
  getProjectPeople,
  listProjects,
  matchPeople,
  mentionHtml,
  type BcPerson,
} from "@/lib/basecamp";

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
  // Names/emails to try tagging on the card, same matching the reminder job
  // uses for the account manager and POC.
  const assignTo: string[] = Array.isArray(body.assignTo)
    ? body.assignTo.filter((v: unknown) => typeof v === "string")
    : [];

  const title = "TEST: Pending Production Scheduling";

  let assigneeIds: number[] = [];
  let matched: BcPerson[] = [];
  if (assignTo.length) {
    const people = await getProjectPeople(projectId);
    assigneeIds = matchPeople(people, assignTo);
    matched = people.filter((p) => assigneeIds.includes(p.id));
  }

  const mentions = matched.map((p) => mentionHtml(p)).join(" ");
  const contentHtml =
    "<div><strong>This is a test card</strong> from Campaign Desk, verifying the reminder job's card creation. Safe to delete.</div>" +
    (mentions ? `<div>${mentions} tagging you here too, not just as an assignee.</div>` : "");

  // One week out, same as the real "time to schedule" outreach card.
  const dueOn = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const result = await createScheduleCard(projectId, title, contentHtml, assigneeIds, dueOn);
  return NextResponse.json({ ...result, resolvedAssignees: assigneeIds.length, dueOn });
}
