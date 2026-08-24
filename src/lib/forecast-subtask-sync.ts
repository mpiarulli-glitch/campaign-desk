import {
  asPerson,
  basecampConnected,
  createTodoStep,
  hasConnection,
  setForecastStepCompletion,
  trashRecording,
  updateTodoStep,
} from "./basecamp";
import { linkSubtaskBasecamp } from "./forecast";
import type { ForecastSubtask, ForecastTask } from "./db";

export type SubtaskBasecampResult = {
  synced: boolean;
  skipped?: boolean;
  error?: string;
  needsBasecamp?: boolean;
};

function parentTodo(task: ForecastTask): { projectId: string; todoId: string } | null {
  const projectId = (task.basecamp_project_id || "").trim();
  const todoId = (task.basecamp_todo_id || "").trim();
  if (!projectId || !todoId) return null;
  return { projectId, todoId };
}

function skipOrConnect(person: string, task: ForecastTask): SubtaskBasecampResult | null {
  if (!parentTodo(task)) return { synced: false, skipped: true };
  if (!basecampConnected()) {
    return { synced: false, error: "Basecamp isn't connected" };
  }
  if (!hasConnection(person)) {
    return {
      synced: false,
      error: "Connect your Basecamp account so this shows as a subtask on the todo",
      needsBasecamp: true,
    };
  }
  return null;
}

/**
 * Mirror a newly saved forecast step onto the parent Basecamp to-do.
 *
 * The local row is already written. A Basecamp miss is reported, not thrown,
 * so the day plan never depends on Basecamp being reachable. Meetings and
 * typed-by-hand rows with no todo are skipped — there is nothing to hang a
 * checklist item on.
 *
 * If the forecast row itself is a booked Basecamp step, basecamp_todo_id is
 * already the parent to-do, so the new step lands as a sibling on that todo
 * rather than trying to nest under the step (Basecamp does not nest steps).
 */
export async function mirrorCreatedSubtask(
  person: string,
  task: ForecastTask,
  subtask: ForecastSubtask
): Promise<SubtaskBasecampResult> {
  try {
    const blocked = skipOrConnect(person, task);
    if (blocked) return blocked;
    const parent = parentTodo(task)!;
    const identity = asPerson(person);
    const created = await createTodoStep(
      parent.projectId,
      parent.todoId,
      subtask.notes,
      identity
    );
    if (!created.ok || !created.id) {
      return { synced: false, error: created.error || "Could not create the Basecamp subtask" };
    }
    linkSubtaskBasecamp(subtask.id, created.id);
    if (subtask.completed) {
      const done = await setForecastStepCompletion(
        parent.projectId,
        created.id,
        true,
        identity
      );
      if (!done.ok) {
        return {
          synced: false,
          error: done.error || "Created the Basecamp subtask, but could not mark it done",
        };
      }
    }
    return { synced: true };
  } catch (err) {
    return { synced: false, error: (err as Error).message };
  }
}

export async function mirrorUpdatedSubtask(
  person: string,
  task: ForecastTask,
  before: ForecastSubtask,
  after: ForecastSubtask
): Promise<SubtaskBasecampResult> {
  try {
    const stepId = (after.basecamp_step_id || before.basecamp_step_id || "").trim();
    if (!stepId) return { synced: false, skipped: true };
    const blocked = skipOrConnect(person, task);
    if (blocked) return blocked;
    const parent = parentTodo(task)!;
    const identity = asPerson(person);
    if (after.notes !== before.notes) {
      const renamed = await updateTodoStep(parent.projectId, stepId, after.notes, identity);
      if (!renamed.ok) {
        return { synced: false, error: renamed.error || "Could not rename the Basecamp subtask" };
      }
    }
    if (Boolean(after.completed) !== Boolean(before.completed)) {
      const flipped = await setForecastStepCompletion(
        parent.projectId,
        stepId,
        Boolean(after.completed),
        identity
      );
      if (!flipped.ok) {
        return { synced: false, error: flipped.error || "Could not update the Basecamp subtask" };
      }
    }
    return { synced: true };
  } catch (err) {
    return { synced: false, error: (err as Error).message };
  }
}

export async function mirrorDeletedSubtask(
  person: string,
  task: ForecastTask,
  subtask: ForecastSubtask
): Promise<SubtaskBasecampResult> {
  try {
    const stepId = (subtask.basecamp_step_id || "").trim();
    if (!stepId) return { synced: false, skipped: true };
    const blocked = skipOrConnect(person, task);
    if (blocked) return blocked;
    const parent = parentTodo(task)!;
    const trashed = await trashRecording(parent.projectId, stepId, asPerson(person));
    if (!trashed.ok) {
      return { synced: false, error: trashed.error || "Could not remove the Basecamp subtask" };
    }
    return { synced: true };
  } catch (err) {
    return { synced: false, error: (err as Error).message };
  }
}
