export const PEOPLE = [
  { slug: "cassidy", label: "Cassidy" },
  { slug: "carlos", label: "Carlos" },
  { slug: "roy", label: "Roy" },
  { slug: "michael", label: "Michael" },
  { slug: "jack", label: "Jack" },
  { slug: "paula", label: "Paula" },
  { slug: "randi", label: "Randi" },
] as const;

export function personLabel(slug: string): string {
  return PEOPLE.find((p) => p.slug === slug)?.label || slug;
}

export function isValidPerson(slug: string): boolean {
  return PEOPLE.some((p) => p.slug === slug);
}
