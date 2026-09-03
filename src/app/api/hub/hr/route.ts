import { NextResponse } from "next/server";
import { can, getSession, isAdminWithAccess } from "@/lib/auth";
import { createHrIssue, listHrIssues } from "@/lib/hub";

// Only admins can read HR issues. Submitting is open to any team member.
export async function GET() {
  if (!(await isAdminWithAccess("page.home"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  return NextResponse.json({ issues: listHrIssues() });
}

export async function POST(request: Request) {
  if (!(await can("page.home"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = await getSession();
  const body = await request.json().catch(() => ({}));
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  if (!subject) return NextResponse.json({ error: "Add a subject." }, { status: 400 });
  const issue = createHrIssue({
    subject,
    body: typeof body.body === "string" ? body.body : "",
    submittedBy: session?.person || "",
    anonymous: body.anonymous === true,
  });
  // Never echo attribution back to the submitter's client.
  return NextResponse.json({ ok: true, id: issue.id });
}
