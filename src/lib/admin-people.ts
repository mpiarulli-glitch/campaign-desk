export const ADMIN_PEOPLE = [
  { slug: "cassidy", label: "Cassidy" },
  { slug: "sylvia", label: "Sylvia" },
  { slug: "kyle_onstott", label: "Kyle Onstott" },
  { slug: "carlos", label: "Carlos" },
  { slug: "kyle_morris", label: "Kyle Morris" },
  { slug: "luis_romero", label: "Luis Romero" },
] as const;

export function isValidAdminPerson(slug: string): boolean {
  return ADMIN_PEOPLE.some((p) => p.slug === slug);
}
