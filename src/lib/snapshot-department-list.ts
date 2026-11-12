// The weekly-snapshot departments, in the order the team fills them.
// Safe to import from client components: no database.
// An empty department is omitted on the client snapshot, the Friday email,
// and the Basecamp post. On the team desk, the owner, Friday-send account
// managers, and anyone with no department assigned still see every section.
// Everyone else sees the departments stored for them.

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

/** "Video Department" -> "Video", for the desk line and the Access chips. */
export function shortDepartmentName(slug: string): string {
  return departmentLabel(slug).replace(/ Department$/, "");
}

/** The line shown on the fill page when the desk is narrowed to someone's departments. */
export function snapshotDepartmentScopeLine(slugs: readonly string[]): string | null {
  const names = slugs.map((slug) => shortDepartmentName(slug)).filter(Boolean);
  if (!names.length) return null;
  if (names.length === 1) return `Showing your department: ${names[0]}`;
  return `Showing your departments: ${names.join(", ")}`;
}

/**
 * Read the scope the auth payload carries. An empty or broken list falls
 * open, so a missing field shows every department instead of a blank desk.
 */
export function snapshotScopeFromPayload(value: unknown): {
  filtered: boolean;
  departments: SnapshotDepartmentSlug[];
  line: string | null;
} {
  const raw =
    value && typeof value === "object"
      ? (value as { filtered?: unknown; departments?: unknown })
      : {};
  const departments = Array.isArray(raw.departments)
    ? raw.departments.filter(
        (department): department is SnapshotDepartmentSlug =>
          typeof department === "string" && isSnapshotDepartment(department)
      )
    : [];
  const filtered = raw.filtered === true && departments.length > 0;
  return {
    filtered,
    departments,
    line: filtered ? snapshotDepartmentScopeLine(departments) : null,
  };
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
