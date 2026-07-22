import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { deleteTask, getTask, updateTask } from "@/lib/forecast";

type Params = { params: Promise<{ person: string; id: string }> };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function PATCH(request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getTask(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  if (body.taskDate !== undefined && !DATE_RE.test(body.taskDate)) {
    return NextResponse.json({ error: "taskDate must be YYYY-MM-DD" }, { status: 400 });
  }
  if (body.hours !== undefined) {
    const hours = Number(body.hours);
    if (!Number.isFinite(hours) || hours <= 0) {
      return NextResponse.json({ error: "hours must be a positive number" }, { status: 400 });
    }
  }
  const task = updateTask(id, {
    taskDate: typeof body.taskDate === "string" ? body.taskDate : undefined,
    client: typeof body.client === "string" ? body.client : undefined,
    notes: typeof body.notes === "string" ? body.notes : undefined,
    hours: body.hours !== undefined ? Number(body.hours) : undefined,
    completed: typeof body.completed === "boolean" ? body.completed : undefined,
  });
  return NextResponse.json({ task });
}

export async function DELETE(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const ok = deleteTask(id);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
