import type { AssetType } from "./asset-kinds";

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

/* ---------------------------------------------------------------------------
   Team focus
   ---------------------------------------------------------------------------
   Which kinds of work a person owns. Everything scoped per team reads from this
   one map, so a new rule is one line here rather than a new flag threaded
   through the app.

     absent from the map -> owns everything (the default; most admins)
     a list              -> the campaign calendar shows those types by default
     an empty list       -> does no campaign work, so those features are hidden

   "By default" is deliberate: the calendar has a "See all" toggle, so this is
   the view someone starts in, not a wall. The one exception is an empty list,
   which hides the feature outright.

   Next use for this map: scoping the weekly snapshot to the portion a team owns.
   ------------------------------------------------------------------------- */
export const TEAM_FOCUS: Record<string, readonly AssetType[]> = {
  // SEO: blog content.
  abel: ["blog_post"],
  carlos: ["blog_post"],
  // Social: posts and the video/carousel work that feeds production.
  randi: ["social_post", "social_video_carousel"],
  // Web team, no campaign work for now.
  roy: [],
};

// The asset types this person's calendar shows by default. null means no
// restriction at all, which is different from [] meaning "none".
export function teamFocus(slug: string | null): readonly AssetType[] | null {
  if (!slug) return null;
  return Object.prototype.hasOwnProperty.call(TEAM_FOCUS, slug)
    ? TEAM_FOCUS[slug]
    : null;
}

// False only for people whose focus is explicitly empty.
export function doesCampaignWork(slug: string | null): boolean {
  const focus = teamFocus(slug);
  return focus === null || focus.length > 0;
}

// Campaign review packages are tagged with AssetKind, not AssetType, so the
// blog overlap is mapped explicitly. Returns null when nothing is restricted.
export function campaignKindFor(slug: string | null): "blog" | null {
  const focus = teamFocus(slug);
  if (!focus) return null;
  return focus.length === 1 && focus[0] === "blog_post" ? "blog" : null;
}

export function personLabel(slug: string): string {
  return PEOPLE.find((p) => p.slug === slug)?.label || slug;
}

export function isValidPerson(slug: string): boolean {
  return PEOPLE.some((p) => p.slug === slug);
}

// Exactly who can see Production scheduling, by slug. An explicit list rather
// than "any admin", because being an admin and needing the shoot schedule are
// different things: Carlos is an admin on the SEO side and has no reason to see
// it. The owner is included so the rule reads in one place, though the owner
// passes every check anyway.
export const PRODUCTION_ACCESS: readonly string[] = [
  OWNER_SLUG, // michael
  "jack",
  "paula",
  "randi",
  "cassidy",
  "sylvia",
  "luis_romero",
  "kyle_morris",
  "kyle_onstott",
] as const;

export function hasProductionAccess(slug: string): boolean {
  return PRODUCTION_ACCESS.includes(slug);
}

// SEO side of the team. They work on blog content only, so the campaigns list is
// filtered to blog assets for them rather than showing every client email.
export const SEO_ONLY_PEOPLE: readonly string[] = ["abel", "carlos"] as const;

export function isSeoOnly(slug: string | null): boolean {
  return Boolean(slug) && SEO_ONLY_PEOPLE.includes(slug as string);
}

export function entryLevelPeople() {
  return PEOPLE.filter((p) => p.entryLevel);
}
