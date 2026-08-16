import { addWeeks, dayBeforeDue } from "./week";

export const AUTO_TODO_HOURS = 1;

export type AutofillCandidate = {
  todoId: string;
  title: string;
  dueOn: string;
  projectId: string;
  client: string;
};

export type AutofillPlanItem = {
  taskDate: string;
  client: string;
  notes: string;
  hours: number;
  basecampTodoId: string;
  basecampProjectId: string;
  dueOn: string;
};

export function planAutofill(opts: {
  weekStart: string;
  existingTodoIds: Iterable<string>;
  candidates: AutofillCandidate[];
}): { items: AutofillPlanItem[]; skippedExisting: number; skippedOtherWeek: number } {
  const weekEnd = addWeeks(opts.weekStart, 1);
  const seen = new Set(opts.existingTodoIds);
  const items: AutofillPlanItem[] = [];
  let skippedExisting = 0;
  let skippedOtherWeek = 0;

  const sorted = [...opts.candidates].sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  for (const c of sorted) {
    if (seen.has(c.todoId)) {
      skippedExisting += 1;
      continue;
    }
    const taskDate = dayBeforeDue(c.dueOn);
    if (taskDate < opts.weekStart || taskDate >= weekEnd) {
      skippedOtherWeek += 1;
      continue;
    }
    seen.add(c.todoId);
    items.push({
      taskDate,
      client: c.client,
      notes: c.title,
      hours: AUTO_TODO_HOURS,
      basecampTodoId: c.todoId,
      basecampProjectId: c.projectId,
      dueOn: c.dueOn,
    });
  }
  return { items, skippedExisting, skippedOtherWeek };
}
