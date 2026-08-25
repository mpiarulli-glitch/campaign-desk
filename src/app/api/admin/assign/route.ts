import { NextResponse } from "next/server";
import { isAdminAuthenticated, sessionUserSlug } from "@/lib/auth";
import {
  createOpsAssignedTodo,
  identityForAssigner,
  listAssignPeople,
  listAssignProjects,
  parseAssignDueOn,
} from "@/lib/assign-todo";

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const slug = await sessionUserSlug();
  const identity = identityForAssigner(slug);
  const projects = await listAssignProjects(identity);
  return NextResponse.json({
    people: listAssignPeople(),
    projects,
  });
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title : "";
  const dueOn = parseAssignDueOn(body.dueOn);
  const assignee = typeof body.assignee === "string" ? body.assignee.trim() : "";
  const projectId =
    typeof body.basecampProjectId === "string" ? body.basecampProjectId.trim() : "";

  const slug = await sessionUserSlug();
  const result = await createOpsAssignedTodo({
    title,
    dueOn: dueOn || "",
    assignee,
    basecampProjectId: projectId,
    identity: identityForAssigner(slug),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
}
