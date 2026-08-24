import { NextResponse } from "next/server";
import { isForecastAuthenticated } from "@/lib/auth";
import {
  deleteSubtask,
  getSubtask,
  getTask,
  updateSubtask,
} from "@/lib/forecast";
import {
  mirrorDeletedSubtask,
  mirrorUpdatedSubtask,
} from "@/lib/forecast-subtask-sync";

type Params = { params: Promise<{ person: string; id: string; subId: string }> };

async function loadOwned(person: string, taskId: string, subId: string) {
  const task = getTask(taskId);
  if (!task || task.person !== person) return null;
  const subtask = getSubtask(subId);
  if (!subtask || subtask.task_id !== taskId) return null;
  return { task, subtask };
}

export async function PATCH(request: Request, { params }: Params) {
  const { person, id, subId } = await params;
  if (!(await isForecastAuthenticated(person))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const owned = await loadOwned(person, id, subId);
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  if (body.notes !== undefined && typeof body.notes !== "string") {
    return NextResponse.json({ error: "notes must be a string." }, { status: 400 });
  }
  if (typeof body.notes === "string" && !body.notes.trim()) {
    return NextResponse.json({ error: "notes are required." }, { status: 400 });
  }
  const subtask = updateSubtask(subId, {
    notes: typeof body.notes === "string" ? body.notes : undefined,
    completed: typeof body.completed === "boolean" ? body.completed : undefined,
  });
  if (!subtask) {
    return NextResponse.json({ error: "Could not update that step." }, { status: 400 });
  }
  const basecamp = await mirrorUpdatedSubtask(
    person,
    owned.task,
    owned.subtask,
    subtask
  );
  return NextResponse.json({ subtask, basecamp });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { person, id, subId } = await params;
  if (!(await isForecastAuthenticated(person))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const owned = await loadOwned(person, id, subId);
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Capture the Basecamp id before the local row is gone.
  const basecamp = await mirrorDeletedSubtask(person, owned.task, owned.subtask);
  const ok = deleteSubtask(subId);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, basecamp });
}
