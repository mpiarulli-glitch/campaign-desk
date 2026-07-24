// productionAccess: entry-level forecast users normally get just Forecast,
// Calendar, and Snapshot — this additionally unlocks the (read-only, for
// non-admins) production scheduling tab.
export const PEOPLE = [
  { slug: "cassidy", label: "Cassidy", productionAccess: false },
  { slug: "carlos", label: "Carlos", productionAccess: false },
  { slug: "roy", label: "Roy", productionAccess: false },
  { slug: "michael", label: "Michael", productionAccess: false },
  { slug: "jack", label: "Jack", productionAccess: true },
  { slug: "paula", label: "Paula", productionAccess: true },
  { slug: "randi", label: "Randi", productionAccess: true },
  { slug: "abel", label: "Abel", productionAccess: false },
] as const;

export function personLabel(slug: string): string {
  return PEOPLE.find((p) => p.slug === slug)?.label || slug;
}

export function isValidPerson(slug: string): boolean {
  return PEOPLE.some((p) => p.slug === slug);
}

export function hasProductionAccess(slug: string): boolean {
  return PEOPLE.some((p) => p.slug === slug && p.productionAccess);
}
