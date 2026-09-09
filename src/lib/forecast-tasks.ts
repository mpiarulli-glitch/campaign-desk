import type { QueueTodo } from "./forecast-queue";

export type TasksFilter = "all" | "dated";
export type TasksLayout = "project" | "due";

/**
 * Filter Basecamp assignments for the Tasks view.
 *
 * "dated" mirrors Basecamp's "My tasks with dates": anything with a due date,
 * overdue or upcoming. "all" is every open assignment.
 */
export function filterAssignedTasks(
  todos: QueueTodo[],
  filter: TasksFilter
): QueueTodo[] {
  if (filter === "dated") return todos.filter((t) => Boolean(t.dueOn));
  return todos;
}

export type TaskGroup = {
  key: string;
  label: string;
  items: QueueTodo[];
};

/**
 * Group by client / project name so the Tasks view reads like Basecamp's
 * My Tasks list (project headers with the work underneath).
 */
export function groupAssignedTasks(todos: QueueTodo[]): TaskGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, TaskGroup>();

  for (const todo of todos) {
    const label = (todo.clientName || todo.list || "Basecamp").trim() || "Basecamp";
    const key = `${todo.clientId || ""}::${label}`;
    let group = byKey.get(key);
    if (!group) {
      group = { key, label, items: [] };
      byKey.set(key, group);
      order.push(key);
    }
    group.items.push(todo);
  }

  return order.map((k) => byKey.get(k)!);
}

/**
 * Group by due urgency so overdue work surfaces first when planning the week.
 * Expects `todos` already sorted (soonest due first, undated last).
 */
export function groupAssignedTasksByDue(
  todos: QueueTodo[],
  today: string
): TaskGroup[] {
  const buckets: TaskGroup[] = [
    { key: "overdue", label: "Overdue", items: [] },
    { key: "today", label: "Due today", items: [] },
    { key: "upcoming", label: "Upcoming", items: [] },
    { key: "none", label: "No date", items: [] },
  ];
  const byKey = new Map(buckets.map((b) => [b.key, b]));

  for (const todo of todos) {
    const key = !todo.dueOn
      ? "none"
      : todo.dueOn < today
        ? "overdue"
        : todo.dueOn === today
          ? "today"
          : "upcoming";
    byKey.get(key)!.items.push(todo);
  }

  return buckets.filter((b) => b.items.length > 0);
}

/**
 * Link to open an assignment in Basecamp. Prefer the API's app_url; fall back to
 * the classic todo URL using the same default account id as lib/basecamp.ts.
 */
export function assignedTaskHref(
  todo: Pick<QueueTodo, "id" | "projectId" | "kind" | "parentId" | "appUrl">
): string {
  const existing = (todo.appUrl || "").trim();
  if (existing) return existing;
  const todoId =
    todo.kind === "step" && todo.parentId ? todo.parentId : todo.id;
  const account = "5338018";
  return `https://3.basecamp.com/${account}/buckets/${todo.projectId}/todos/${todoId}`;
}
