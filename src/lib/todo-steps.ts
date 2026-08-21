// Basecamp to-do subtasks are Kanban::Step recordings parented to a Todo.
// The forecast picker lists them under their parent so you can book a subtask
// without taking the whole to-do.
//
// Two things about steps drive the shape of everything here:
//
//   1. A step never carries assignees. Basecamp has no UI for assigning one, and
//      the API returns `assignees: []` on every step in the account. So "is this
//      mine?" has to come from the parent to-do, or subtasks would never appear
//      under "Assigned to you" — which is the only list most people pick from.
//   2. A step is not timesheetable. POST /recordings/{stepId}/timesheet/entries
//      404s. Hours for a subtask therefore belong on the parent to-do, which is
//      why a picked step carries its parent's id alongside its own.

export type TodoStepKind = "todo" | "step";

export interface TodoPickerItem {
  id: string;
  title: string;
  list: string;
  assigneeIds: number[];
  dueOn: string | null;
  assigned?: boolean;
  kind?: TodoStepKind;
  parentId?: string;
  parentTitle?: string;
}

export interface OpenTodoStep {
  id: string;
  title: string;
  parentId: string;
  parentType: string;
  parentTitle: string;
  completed: boolean;
  assigneeIds: number[];
  dueOn: string | null;
}

function isTodoParent(type: string, todoIds: Set<string>, parentId: string): boolean {
  if (todoIds.has(parentId)) return true;
  return (type || "").toLowerCase().includes("todo");
}

export function attachTodoSteps(
  todos: TodoPickerItem[],
  steps: OpenTodoStep[]
): TodoPickerItem[] {
  const todoIds = new Set(todos.map((t) => t.id));
  const byParent = new Map<string, OpenTodoStep[]>();
  const orphans: OpenTodoStep[] = [];

  for (const step of steps) {
    if (step.completed) continue;
    const title = (step.title || "").trim();
    if (!title || !step.parentId) continue;
    if (!isTodoParent(step.parentType, todoIds, step.parentId)) continue;
    if (todoIds.has(step.parentId)) {
      const list = byParent.get(step.parentId) || [];
      list.push({ ...step, title });
      byParent.set(step.parentId, list);
    } else {
      orphans.push({ ...step, title });
    }
  }

  const out: TodoPickerItem[] = [];
  for (const todo of todos) {
    out.push({ ...todo, kind: todo.kind || "todo" });
    for (const step of byParent.get(todo.id) || []) {
      out.push({
        id: step.id,
        title: step.title,
        list: todo.list,
        assigneeIds: step.assigneeIds,
        // A step has no due date of its own in practice, so it falls due when
        // its parent does. The parent title is shown right beside it, so this
        // reads as inherited rather than as a date somebody set on the subtask.
        dueOn: step.dueOn || todo.dueOn,
        kind: "step",
        parentId: todo.id,
        parentTitle: todo.title,
      });
    }
  }
  for (const step of orphans) {
    out.push({
      id: step.id,
      title: step.title,
      list: step.parentTitle || "Subtasks",
      assigneeIds: step.assigneeIds,
      dueOn: step.dueOn,
      kind: "step",
      parentId: step.parentId,
      parentTitle: step.parentTitle,
    });
  }
  return out;
}

/**
 * Mark which picker items belong to the person browsing, and count them.
 *
 * `isAssigned` answers that for a real to-do. Subtasks are handled here instead:
 * a step with no assignees of its own inherits its parent to-do's answer, so the
 * subtasks of your work show up as yours. A step that somehow does carry
 * assignees is judged on its own like any to-do.
 */
export function flagAssignedWithSteps(
  items: TodoPickerItem[],
  isAssigned: (item: TodoPickerItem) => boolean
): { todos: TodoPickerItem[]; assignedCount: number } {
  const direct = items.map((item) => ({ item, own: isAssigned(item) }));
  const parentAssigned = new Map<string, boolean>();
  for (const { item, own } of direct) {
    if (item.kind !== "step") parentAssigned.set(item.id, own);
  }

  let assignedCount = 0;
  const todos = direct.map(({ item, own }) => {
    const inherited =
      item.kind === "step" && item.assigneeIds.length === 0
        ? Boolean(parentAssigned.get(item.parentId || ""))
        : false;
    const assigned = own || inherited;
    if (assigned) assignedCount++;
    return { ...item, assigned };
  });
  return { todos, assignedCount };
}
