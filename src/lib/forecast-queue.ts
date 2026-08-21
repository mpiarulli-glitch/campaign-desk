// The task queue beside the forecast calendar: Basecamp to-dos waiting to be
// booked, and forecast rows that exist but have no time slot yet. Shared between
// the queue sidebar, the calendar grid, and the page that owns the drag state.

export type QueueTodoKind = "todo" | "step";

// One pickable Basecamp item, carrying enough context to become a forecast row
// without another lookup: which project it belongs to, and which client that
// project bills to.
export interface QueueTodo {
  id: string;
  title: string;
  list: string;
  dueOn: string | null;
  assigned?: boolean;
  kind?: QueueTodoKind;
  parentId?: string;
  parentTitle?: string;
  projectId: string;
  clientId: string;
  clientName: string;
}

/**
 * What's being dragged, held by the page while a drag is in flight.
 *
 * The HTML drag-and-drop API can't be read during dragover — only on drop — and
 * the calendar needs to know mid-drag whether it's looking at a move or a new
 * booking, so the payload lives in React state and dataTransfer just carries an
 * id to keep Firefox happy.
 */
export type ForecastDrag =
  | { kind: "task"; id: string; grabOffsetMin: number; durationMin: number }
  | { kind: "todo"; todo: QueueTodo; durationMin: number };

// Basecamp linkage for a new forecast row built from a queue item.
//
// A subtask sends BOTH ids: the step is what gets ticked off, and its parent
// to-do is what hours can be logged against, since a step takes no timesheet
// entries of its own.
export function queueTodoLinkage(
  todo: Pick<QueueTodo, "id" | "kind" | "parentId">
): { basecampTodoId: string; basecampStepId: string } {
  const isStep = todo.kind === "step";
  return {
    basecampTodoId: isStep ? todo.parentId || "" : todo.id,
    basecampStepId: isStep ? todo.id : "",
  };
}

// Task text for a queue item. A subtask reads as "Parent › Subtask" so the row
// still says what the work belongs to once it's away from the picker.
export function queueTodoNotes(
  todo: Pick<QueueTodo, "title" | "kind" | "parentTitle">
): string {
  if (todo.kind === "step" && todo.parentTitle) {
    return `${todo.parentTitle} › ${todo.title}`;
  }
  return todo.title;
}

// Every Basecamp recording already booked somewhere in the loaded week, so the
// queue can mark an item as taken instead of letting it be added twice.
export function bookedRecordingIds(
  tasks: Array<{ basecamp_todo_id: string; basecamp_step_id: string }>
): Set<string> {
  const out = new Set<string>();
  for (const t of tasks) {
    if (t.basecamp_step_id) out.add(t.basecamp_step_id);
    else if (t.basecamp_todo_id) out.add(t.basecamp_todo_id);
  }
  return out;
}

// Sort for the queue: soonest due date first, then anything undated, with
// assigned work ahead of the rest at the same due date.
export function sortQueueTodos(todos: QueueTodo[]): QueueTodo[] {
  return [...todos].sort((a, b) => {
    if (Boolean(a.assigned) !== Boolean(b.assigned)) return a.assigned ? -1 : 1;
    if (a.dueOn && b.dueOn) return a.dueOn.localeCompare(b.dueOn);
    if (a.dueOn) return -1;
    if (b.dueOn) return 1;
    return 0;
  });
}
