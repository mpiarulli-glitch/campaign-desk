import { NextResponse } from "next/server";
import { isForecastAuthenticated } from "@/lib/auth";
import {
  asPerson,
  basecampConnected,
  completeTodo,
  createTimeEntry,
  ensureForecastTodo,
  hasConnection,
  setForecastStepCompletion,
  uncompleteTodo,
} from "@/lib/basecamp";
import {
  deleteTask,
  getTask,
  personLabel,
  recordTimeEntry,
  startTimer,
  stopTimer,
  updateTask,
} from "@/lib/forecast";
import { parseTimeInput } from "@/lib/forecast-time";

type Params = { params: Promise<{ person: string; id: string }> };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Log time against whatever Basecamp recording the row is linked to: a todo for
 * work, or a schedule entry for a meeting. Either way the hours land on that
 * project's timesheet, which is most of the point of booking a meeting here.
 *
 * A task typed by hand instead of picked from the todo list has no recording
 * of its own yet — it only carries the project it belongs to. In that case a
 * shadow todo is created in that project's "Forecast" list so there's something
 * real to attach the hours to, same as picking an existing todo would have given
 * us. It is only ticked off if the forecast row itself is done.
 *
 * A subtask row logs against its parent to-do: a Kanban::Step takes no timesheet
 * entries of its own, so basecamp_todo_id already holds the parent and this needs
 * no special case.
 *
 * Time can be logged before the work is finished, and more than once — an hour
 * this morning and two this afternoon are two entries that add up on the row.
 * Each call still has to be asked for explicitly, because hours land on a
 * client-visible timesheet and can't be un-sent.
 */
async function logTime(
  taskId: string,
  person: string,
  hours: number
): Promise<{ status: number; body: Record<string, unknown> }> {
  let task = getTask(taskId);
  if (!task) return { status: 404, body: { error: "Not found" } };
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
    // Best-effort mirror of the local state. Only closed when the row is
    // actually done — logging time partway through leaves the shadow todo open
    // so Basecamp doesn't show finished work that isn't.
    if (task.completed) {
      await completeTodo(task.basecamp_project_id, created.id, asPerson(person));
    }
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
  // loggable rather than looking done. Adds to whatever was logged before.
  const updated = recordTimeEntry(taskId, hours, result.entryId || "");
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

  // { timer: "start" | "stop" } is its own action too. Purely local: the timer
  // measures time, and sending those hours to Basecamp stays a separate,
  // deliberate step via logTimeHours.
  if (body.timer === "start" || body.timer === "stop") {
    if (body.timer === "stop") {
      return NextResponse.json({ task: stopTimer(id) });
    }
    const { task: started, stopped } = startTimer(person, id);
    if (!started) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // Names whichever timer had to give way when a third one started, so the
    // page can say so rather than leaving someone to notice it quietly stopped.
    return NextResponse.json({
      task: started,
      stopped: stopped ? { id: stopped.id, notes: stopped.notes, client: stopped.client } : null,
    });
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
  if (typeof body.startTime === "string") {
    const startTime = parseTimeInput(body.startTime);
    if (body.startTime.trim() && !startTime) {
      return NextResponse.json({ error: "startTime must be a time" }, { status: 400 });
    }
  }
  const task = updateTask(id, {
    taskDate: typeof body.taskDate === "string" ? body.taskDate : undefined,
    client: typeof body.client === "string" ? body.client : undefined,
    notes: typeof body.notes === "string" ? body.notes : undefined,
    hours: body.hours !== undefined ? Number(body.hours) : undefined,
    completed: typeof body.completed === "boolean" ? body.completed : undefined,
    color: typeof body.color === "string" ? body.color : undefined,
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
  const linkedRecording = existing.basecamp_step_id || existing.basecamp_todo_id;
  if (flipped && linkedRecording && existing.basecamp_project_id) {
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
      // A subtask row ticks the subtask. Closing its parent to-do instead would
      // close every sibling subtask along with it.
      const result = existing.basecamp_step_id
        ? await setForecastStepCompletion(
            existing.basecamp_project_id,
            existing.basecamp_step_id,
            body.completed,
            asPerson(person)
          )
        : body.completed
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
