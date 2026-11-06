// The weekly-snapshot departments, in the order the team fills them.
// Safe to import from client components: no database.
// An empty department is omitted on the client snapshot, the Friday email,
// and the Basecamp post. The team editor still shows every section.

export const SNAPSHOT_DEPARTMENTS = [
  { slug: "lifecycle", label: "Lifecycle Department" },
  { slug: "social", label: "Social Media Department" },
  { slug: "ads", label: "Ads Department" },
  { slug: "video", label: "Video Department" },
  { slug: "web", label: "Web Department" },
  { slug: "seo", label: "SEO Department" },
  { slug: "strategy", label: "Strategy Department" },
] as const;

export type SnapshotDepartmentSlug = (typeof SNAPSHOT_DEPARTMENTS)[number]["slug"];

export function isSnapshotDepartment(value: string): value is SnapshotDepartmentSlug {
  return SNAPSHOT_DEPARTMENTS.some((dept) => dept.slug === value);
}

export function departmentLabel(slug: string): string {
  return SNAPSHOT_DEPARTMENTS.find((dept) => dept.slug === slug)?.label || slug;
}

/** Work state on a weekly snapshot line. Completed keeps the green check. */
export const SNAPSHOT_ITEM_STATUSES = ["in_progress", "scheduled", "completed"] as const;

export type SnapshotItemStatus = (typeof SNAPSHOT_ITEM_STATUSES)[number];

export function isSnapshotItemStatus(value: string): value is SnapshotItemStatus {
  return (SNAPSHOT_ITEM_STATUSES as readonly string[]).includes(value);
}

export function snapshotItemStatusLabel(status: SnapshotItemStatus): string {
  if (status === "completed") return "Completed";
  if (status === "scheduled") return "Scheduled";
  return "In progress";
}

/** Stored rows, new typed lines, and Basecamp imports share one default. */
export function snapshotItemStatusFrom(input: {
  status?: string;
  completed?: boolean | number;
  mark?: string;
}): SnapshotItemStatus {
  if (input.status && isSnapshotItemStatus(input.status)) return input.status;
  if (input.completed) return "completed";
  if (input.mark === "sent") return "scheduled";
  return "in_progress";
}
