import { ADMIN_PEOPLE } from "./admin-people";
import { PEOPLE } from "./people";

// Unified roster of assignable/taggable people across both account systems
// (full admins + entry-level forecast members), de-duplicated by slug. Used by
// todos (assignee + @mentions) and chat authorship. Admin-people labels win
// when a slug exists in both lists.
export interface TeamMember {
  slug: string;
  label: string;
}

export const TEAM: TeamMember[] = (() => {
  const map = new Map<string, string>();
  for (const p of PEOPLE) map.set(p.slug, p.label);
  for (const p of ADMIN_PEOPLE) map.set(p.slug, p.label); // admin label wins
  return Array.from(map, ([slug, label]) => ({ slug, label })).sort((a, b) =>
    a.label.localeCompare(b.label)
  );
})();

export function teamLabel(slug: string): string {
  return TEAM.find((p) => p.slug === slug)?.label || slug;
}

export function isTeamMember(slug: string): boolean {
  return TEAM.some((p) => p.slug === slug);
}

// Slugs that have a real headshot in /public/avatars/{slug}.png. Everyone else
// falls back to initials. Add a slug here once its photo is dropped in.
const AVATAR_SLUGS = new Set(["abel", "luis_romero", "sylvia"]);

export function avatarFor(slug: string): string | null {
  return AVATAR_SLUGS.has(slug) ? `/avatars/${slug}.png` : null;
}
