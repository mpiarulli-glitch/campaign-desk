// productionAccess: entry-level forecast users normally get just Forecast,
// Calendar, and Snapshot — this additionally unlocks the (read-only, for
// non-admins) production scheduling tab.
// entryLevel: actually-active restricted forecast-role logins, i.e. the
// people who should show up in the owner's "view as team member" picker.
// cassidy/carlos/michael are legacy entries already covered by full
// ADMIN_ACCOUNTS logins, so they're excluded from that list.
export const PEOPLE = [
  { slug: "cassidy", label: "Cassidy", productionAccess: false, entryLevel: false },
  { slug: "carlos", label: "Carlos", productionAccess: false, entryLevel: false },
  { slug: "roy", label: "Roy", productionAccess: false, entryLevel: true },
  { slug: "michael", label: "Michael", productionAccess: false, entryLevel: false },
  { slug: "jack", label: "Jack", productionAccess: true, entryLevel: true },
  { slug: "paula", label: "Paula", productionAccess: true, entryLevel: true },
  { slug: "randi", label: "Randi", productionAccess: true, entryLevel: true },
  { slug: "abel", label: "Abel", productionAccess: false, entryLevel: true },
  { slug: "mike_hines", label: "Mike Hines", productionAccess: false, entryLevel: false },
] as const;

// The single owner account. Logging in as this slug issues the null-person
// admin session that every existing owner check reads (see auth.ts), so the
// owner keeps full access while still having a real, self-managed password.
export const OWNER_SLUG = "michael";

export function personLabel(slug: string): string {
  return PEOPLE.find((p) => p.slug === slug)?.label || slug;
}

export function isValidPerson(slug: string): boolean {
  return PEOPLE.some((p) => p.slug === slug);
}

export function hasProductionAccess(slug: string): boolean {
  return PEOPLE.some((p) => p.slug === slug && p.productionAccess);
}

export function entryLevelPeople() {
  return PEOPLE.filter((p) => p.entryLevel);
}
