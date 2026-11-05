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
