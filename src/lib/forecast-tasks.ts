import type { QueueTodo } from "./forecast-queue";

export type TasksFilter = "all" | "dated";

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
