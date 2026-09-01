import { NextResponse } from "next/server";
import { isForecastAuthenticated } from "@/lib/auth";
import {
  asPerson,
  basecampConnected,
  completeTodo,
  hasConnection,
  setForecastStepCompletion,
  uncompleteTodo,
} from "@/lib/basecamp";
import { getDb } from "@/lib/db";
import { isValidPerson, updateTask, type ForecastTask } from "@/lib/forecast";

type Body = {
  person?: string;
  projectId?: string;
  id?: string;
  kind?: "todo" | "card" | "step";
  completed?: boolean;
};

/**
 * Tick a Basecamp assignment that is not (yet) a forecast row.
 *
 * The Tasks view needs this so someone can clear their plate without first
 * booking every item onto the week. Matching forecast rows for the same
 * recording are flipped locally too, so the calendar doesn't keep showing
 * work that Basecamp already considers done.
 */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const person = (body.person || "").trim();
  const projectId = (body.projectId || "").trim();
  const id = (body.id || "").trim();
  const kind = body.kind || "todo";
  const completed = Boolean(body.completed);

  if (!(await isForecastAuthenticated(person))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isValidPerson(person)) {
    return NextResponse.json({ error: "Unknown person" }, { status: 404 });
  }
  if (!projectId || !id) {
    return NextResponse.json({ error: "Missing project or recording id" }, { status: 400 });
  }
  if (!basecampConnected()) {
    return NextResponse.json({ error: "Basecamp isn't connected" }, { status: 400 });
  }
  if (!hasConnection(person)) {
    return NextResponse.json(
      {
        error: "Connect your Basecamp account so this shows as your tick",
        needsBasecamp: true,
      },
      { status: 400 }
    );
  }

  const identity = asPerson(person);
  const result =
    kind === "step"
      ? await setForecastStepCompletion(projectId, id, completed, identity)
      : completed
        ? await completeTodo(projectId, id, identity)
        : await uncompleteTodo(projectId, id, identity);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || "Could not update Basecamp" },
      { status: 502 }
    );
  }

  // Keep any forecast rows that already point at this recording in step with
  // Basecamp. A subtask matches on step id; a to-do/card matches the parent
  // recording only when the row isn't itself a subtask booking.
  const linked = (
    getDb()
      .prepare(
        kind === "step"
          ? `SELECT * FROM forecast_tasks WHERE person = ? AND basecamp_step_id = ?`
          : `SELECT * FROM forecast_tasks
             WHERE person = ? AND basecamp_todo_id = ? AND IFNULL(basecamp_step_id, '') = ''`
      )
      .all(person, id) as ForecastTask[]
  ).filter((t) => Boolean(t.completed) !== completed);

  for (const task of linked) {
    updateTask(task.id, { completed });
  }

  return NextResponse.json({
    ok: true,
    updatedForecastIds: linked.map((t) => t.id),
  });
}
