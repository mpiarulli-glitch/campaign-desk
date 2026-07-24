import { NextResponse } from "next/server";
import { isWorkflowAuthenticated } from "@/lib/auth";
import { deleteTodo, getTodo, updateTodo } from "@/lib/todos";
import { isTeamMember } from "@/lib/team";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getTodo(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));

  const updates: Parameters<typeof updateTodo>[1] = {};
  if (typeof body.title === "string") updates.title = body.title;
  if (typeof body.notes === "string") updates.notes = body.notes;
  if ("clientId" in body) updates.clientId = body.clientId || null;
  if (typeof body.assignee === "string") {
    updates.assignee = isTeamMember(body.assignee) ? body.assignee : "";
  }
  if (Array.isArray(body.tags)) {
    updates.tags = body.tags.filter((s: unknown) => typeof s === "string" && isTeamMember(s));
  }
  if ("dueDate" in body) updates.dueDate = body.dueDate || null;
  if (body.status === "open" || body.status === "done") updates.status = body.status;
  if (body.priority) updates.priority = body.priority;

  const todo = updateTodo(id, updates);
  return NextResponse.json({ todo });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const ok = deleteTodo(id);
  return NextResponse.json({ ok });
}
