// Block colours for forecast tasks.
//
// A task's colour used to be its priority: red meant urgent, amber important,
// blue flexible. That tied two unrelated ideas together — you could not colour
// a week by client or by kind of work without also claiming something about how
// urgent it was — so colour is now its own field and priority is gone.
//
// Stored as a name rather than a hex so the actual values stay in CSS, where
// they can differ between light and dark without a migration.

export const TASK_COLORS = [
  { id: "blue", label: "Blue" },
  { id: "indigo", label: "Indigo" },
  { id: "violet", label: "Violet" },
  { id: "teal", label: "Teal" },
  { id: "green", label: "Green" },
  { id: "amber", label: "Amber" },
  { id: "red", label: "Red" },
  { id: "slate", label: "Slate" },
] as const;

export type TaskColor = (typeof TASK_COLORS)[number]["id"];

export const DEFAULT_TASK_COLOR: TaskColor = "blue";

export function isTaskColor(v: unknown): v is TaskColor {
  return TASK_COLORS.some((c) => c.id === v);
}

// Empty or unrecognised falls back to the default rather than rendering an
// unstyled block: rows written before colour existed all carry "".
export function normalizeTaskColor(v: unknown): TaskColor {
  return isTaskColor(v) ? v : DEFAULT_TASK_COLOR;
}
