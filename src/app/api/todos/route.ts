import { NextResponse } from "next/server";
import { getSession, isWorkflowAuthenticated } from "@/lib/auth";
import { createTodo, listTodos, type TodoStatus } from "@/lib/todos";
import { isTeamMember } from "@/lib/team";

export async function GET(request: Request) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sp = new URL(request.url).searchParams;
  const clientParam = sp.get("client_id");
  const status = sp.get("status");
  const todos = listTodos({
    clientId: clientParam === "none" ? null : clientParam || undefined,
    assignee: sp.get("assignee") || undefined,
    status: status === "open" || status === "done" ? (status as TodoStatus) : undefined,
  });
  return NextResponse.json({ todos });
}

export async function POST(request: Request) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = await getSession();
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "A to-do needs a title." }, { status: 400 });
  }
  const assignee = typeof body.assignee === "string" && isTeamMember(body.assignee) ? body.assignee : "";
  const tags = Array.isArray(body.tags) ? body.tags.filter((s: unknown) => typeof s === "string" && isTeamMember(s)) : [];

  const todo = createTodo({
    title,
    notes: typeof body.notes === "string" ? body.notes : "",
    clientId: typeof body.clientId === "string" && body.clientId ? body.clientId : null,
    assignee,
    tags,
    dueDate: typeof body.dueDate === "string" && body.dueDate ? body.dueDate : null,
    priority: body.priority,
    createdBy: session?.person || (session?.role === "admin" ? "admin" : ""),
  });
  return NextResponse.json({ todo });
}
