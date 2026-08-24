import { NextResponse } from "next/server";
import { isForecastAuthenticated } from "@/lib/auth";
import { createSubtask, getTask } from "@/lib/forecast";
import { mirrorCreatedSubtask } from "@/lib/forecast-subtask-sync";

type Params = { params: Promise<{ person: string; id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { person, id } = await params;
  if (!(await isForecastAuthenticated(person))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const task = getTask(id);
  if (!task || task.person !== person) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (!notes) {
    return NextResponse.json({ error: "notes are required." }, { status: 400 });
  }
  const subtask = createSubtask({
    taskId: id,
    notes,
    completed: body.completed === false ? false : true,
  });
  if (!subtask) {
    return NextResponse.json({ error: "Could not add that step." }, { status: 400 });
  }
  // Local write already succeeded. A Basecamp miss is reported alongside the
  // step rather than failing the request — the day plan shouldn't depend on
  // Basecamp being reachable.
  const basecamp = await mirrorCreatedSubtask(person, task, subtask);
  return NextResponse.json({ subtask, basecamp }, { status: 201 });
}
