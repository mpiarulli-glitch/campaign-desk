// Basecamp to-do subtasks are Kanban::Step recordings parented to a Todo.
// The forecast picker lists them under their parent so you can book a subtask
// without taking the whole to-do.

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
        dueOn: step.dueOn,
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
