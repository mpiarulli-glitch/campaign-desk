import { NextResponse } from "next/server";
import { isForecastAuthenticated } from "@/lib/auth";
import {
  asPerson,
  basecampConnected,
  completeTodo,
  createTimeEntry,
  ensureForecastTodo,
  hasConnection,
  uncompleteTodo,
} from "@/lib/basecamp";
import { deleteTask, getTask, updateTask, personLabel, type ForecastPriority } from "@/lib/forecast";
import { parseTimeInput } from "@/lib/forecast-time";

type Params = { params: Promise<{ person: string; id: string }> };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES: ForecastPriority[] = ["urgent", "important", "flexible"];

/**
 * Log time against whatever Basecamp recording the row is linked to: a todo for
 * work, or a schedule entry for a meeting. Either way the hours land on that
 * project's timesheet, which is most of the point of booking a meeting here.
 *
 * A task typed by hand instead of picked from the todo list has no recording
 * of its own yet — it only carries the project it belongs to. In that case a
 * shadow todo is created (and immediately completed) in that project's
 * "Forecast" list so there's something real to attach the hours to, same as
 * picking an existing todo would have given us.
 *
 * Separate from the PATCH body's other fields because it writes to Basecamp and
 * must not happen implicitly: hours land on a client-visible timesheet, and a
 * duplicate entry can't be un-sent. Refuses if time was already logged.
 */
async function logTime(
  taskId: string,
  person: string,
  hours: number
): Promise<{ status: number; body: Record<string, unknown> }> {
  let task = getTask(taskId);
  if (!task) return { status: 404, body: { error: "Not found" } };
  if (task.basecamp_time_entry_id) {
    return {
      status: 409,
      body: { error: "Time is already logged for that task.", entryId: task.basecamp_time_entry_id },
    };
  }
  if (!(hours > 0)) {
    return { status: 400, body: { error: "hours must be a positive number" } };
  }
  if (!basecampConnected()) {
    return { status: 400, body: { error: "Basecamp isn't connected." } };
  }
  // The whole point of logging time is that it lands under the right name, so
  // this refuses rather than falling back to the service token and crediting the
  // hours to whoever connected the app.
  if (!hasConnection(person)) {
    return {
      status: 409,
      body: {
        error:
          "Connect your own Basecamp account first, so these hours are logged as you.",
        needsBasecamp: true,
      },
    };
  }

  // At most one of these is ever set on a picked/booked row (see createTask).
  let recordingId = task.basecamp_todo_id || task.basecamp_event_id;
  if (!recordingId && task.basecamp_project_id) {
    const created = await ensureForecastTodo(
      task.basecamp_project_id,
      task.notes || task.client || personLabel(person),
      asPerson(person)
    );
    if (!created) {
      return {
        status: 502,
        body: { error: "Could not create a Basecamp todo to log time against." },
      };
    }
    // Persisted right away — before the timesheet write, which can still
    // fail — so a retry reuses this todo instead of creating a duplicate.
    task = updateTask(taskId, { basecampTodoId: created.id }) || task;
    recordingId = created.id;
    // Best-effort: the task is already done locally, so the shadow todo
    // should read done too. Not fatal if Basecamp doesn't cooperate.
    await completeTodo(task.basecamp_project_id, created.id, asPerson(person));
  }
  if (!recordingId) {
    return {
      status: 400,
      body: { error: "That row isn't linked to a Basecamp project, so there's nothing to log time against." },
    };
  }

  const result = await createTimeEntry(
    recordingId,
    {
      date: task.task_date,
      hours,
      // The name is no longer needed as a prefix now that Basecamp attributes the
      // entry to them, so the description is just what the time went on.
      description: task.notes || task.client || personLabel(person),
    },
    asPerson(person)
  );
  if (!result.ok) {
    return { status: 502, body: { error: result.error || "Could not log time to Basecamp." } };
  }
  // Recorded only after Basecamp accepts, so a failed write leaves the task
  // loggable rather than looking done.
  const updated = updateTask(taskId, {
    actualHours: hours,
    basecampTimeEntryId: result.entryId || "",
  });
  return { status: 200, body: { task: updated, entryId: result.entryId, appUrl: result.appUrl } };
}

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

  // { logTimeHours: 1.5 } is its own action, not a field update.
  if (body.logTimeHours !== undefined) {
    const { status, body: out } = await logTime(id, person, Number(body.logTimeHours));
    return NextResponse.json(out, { status });
  }

  if (body.taskDate !== undefined && !DATE_RE.test(body.taskDate)) {
    return NextResponse.json({ error: "taskDate must be YYYY-MM-DD" }, { status: 400 });
  }
  if (body.hours !== undefined) {
    const hours = Number(body.hours);
    if (!Number.isFinite(hours) || hours <= 0) {
      return NextResponse.json({ error: "hours must be a positive number" }, { status: 400 });
    }
  }
  if (typeof body.startTime === "string" && !parseTimeInput(body.startTime)) {
    return NextResponse.json({ error: "startTime is required" }, { status: 400 });
  }
  const task = updateTask(id, {
    taskDate: typeof body.taskDate === "string" ? body.taskDate : undefined,
    client: typeof body.client === "string" ? body.client : undefined,
    notes: typeof body.notes === "string" ? body.notes : undefined,
    hours: body.hours !== undefined ? Number(body.hours) : undefined,
    completed: typeof body.completed === "boolean" ? body.completed : undefined,
    priority: PRIORITIES.includes(body.priority) ? body.priority : undefined,
    startTime: typeof body.startTime === "string" ? body.startTime : undefined,
  });

  // Mirror a completion flip onto the linked Basecamp todo. The forecast row is
  // already saved, so a Basecamp failure is reported alongside the task rather
  // than failing the request — the local plan shouldn't depend on Basecamp being
  // reachable.
  let basecamp:
    | { synced: boolean; error?: string; needsBasecamp?: boolean }
    | undefined;
  const flipped =
    typeof body.completed === "boolean" &&
    Boolean(existing.completed) !== body.completed;
  if (flipped && existing.basecamp_todo_id && existing.basecamp_project_id) {
    if (!basecampConnected()) {
      basecamp = { synced: false, error: "Basecamp isn't connected" };
    } else if (!hasConnection(person)) {
      // The local tick is already saved. Not mirroring it is better than
      // mirroring it under the wrong name, and the message says what to do.
      basecamp = {
        synced: false,
        error: "Connect your Basecamp account so this shows as your tick",
        needsBasecamp: true,
      };
    } else {
      const result = body.completed
        ? await completeTodo(
            existing.basecamp_project_id,
            existing.basecamp_todo_id,
            asPerson(person)
          )
        : await uncompleteTodo(
            existing.basecamp_project_id,
            existing.basecamp_todo_id,
            asPerson(person)
          );
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
