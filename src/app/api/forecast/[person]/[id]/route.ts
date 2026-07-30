import { NextResponse } from "next/server";
import { isForecastAuthenticated } from "@/lib/auth";
import { basecampConnected, completeTodo, uncompleteTodo } from "@/lib/basecamp";
import { deleteTask, getTask, updateTask, type ForecastPriority } from "@/lib/forecast";

type Params = { params: Promise<{ person: string; id: string }> };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES: ForecastPriority[] = ["urgent", "important", "flexible"];

export async function PATCH(request: Request, { params }: Params) {
  const { person, id } = await params;
  if (!(await isForecastAuthenticated(person))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const existing = getTask(id);
  if (!existing || existing.person !== person) {
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
    priority: PRIORITIES.includes(body.priority) ? body.priority : undefined,
  });

  // Mirror a completion flip onto the linked Basecamp todo. The forecast row is
  // already saved, so a Basecamp failure is reported alongside the task rather
  // than failing the request — the local plan shouldn't depend on Basecamp being
  // reachable.
  let basecamp: { synced: boolean; error?: string } | undefined;
  const flipped =
    typeof body.completed === "boolean" &&
    Boolean(existing.completed) !== body.completed;
  if (flipped && existing.basecamp_todo_id && existing.basecamp_project_id) {
    if (!basecampConnected()) {
      basecamp = { synced: false, error: "Basecamp isn't connected" };
    } else {
      const result = body.completed
        ? await completeTodo(existing.basecamp_project_id, existing.basecamp_todo_id)
        : await uncompleteTodo(existing.basecamp_project_id, existing.basecamp_todo_id);
      basecamp = { synced: result.ok, error: result.error };
    }
  }
  return NextResponse.json({ task, basecamp });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { person, id } = await params;
  if (!(await isForecastAuthenticated(person))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const existing = getTask(id);
  if (!existing || existing.person !== person) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const ok = deleteTask(id);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
