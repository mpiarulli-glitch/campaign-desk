import type { AssetType } from "./asset-kinds";
import { ADMIN_PEOPLE } from "./admin-people";

// productionAccess: entry-level forecast users normally get just Forecast,
// Calendar, and Snapshot — this additionally unlocks the (read-only, for
// non-admins) production scheduling tab.
// entryLevel: actually-active restricted forecast-role logins, i.e. the
// people who should show up in the owner's "view as team member" picker.
// cassidy/carlos/michael/kyle_morris/jerald are already covered by full
// admin logins, so they're excluded from that list.
export const PEOPLE = [
  { slug: "cassidy", label: "Cassidy", productionAccess: false, entryLevel: false },
  { slug: "sylvia", label: "Sylvia", productionAccess: false, entryLevel: false },
  { slug: "kyle_morris", label: "Kyle Morris", productionAccess: false, entryLevel: false },
  { slug: "carlos", label: "Carlos", productionAccess: false, entryLevel: false },
  { slug: "roy", label: "Roy", productionAccess: false, entryLevel: true },
  { slug: "michael", label: "Michael", productionAccess: false, entryLevel: false },
  { slug: "jack", label: "Jack", productionAccess: true, entryLevel: true },
  { slug: "paula", label: "Paula", productionAccess: true, entryLevel: true },
  { slug: "randi", label: "Randi", productionAccess: true, entryLevel: true },
  { slug: "abel", label: "Abel", productionAccess: false, entryLevel: true },
  { slug: "mike_hines", label: "Mike Hines", productionAccess: false, entryLevel: false },
  { slug: "lana", label: "Lana Verrecchio", productionAccess: true, entryLevel: true },
  { slug: "saqib", label: "Saqib", productionAccess: false, entryLevel: true },
  { slug: "jerald", label: "Jerald", productionAccess: false, entryLevel: false },
] as const;

// The single owner account. Logging in as this slug issues the null-person
// admin session that every existing owner check reads (see auth.ts), so the
// owner keeps full access while still having a real, self-managed password.
export const OWNER_SLUG = "michael";

/**
 * Whose forecast the current session is acting as — used by the global timer
 * dock, which must never ask for another person's running tasks.
 *
 * Owner sessions carry a null person (that's how every owner check works), so
 * they resolve to OWNER_SLUG. Forecast-role and named-admin sessions use the
 * slug on the cookie. Null when there is no session, or a session with no
 * person that isn't the owner.
 */
export function forecastSlugForSession(session: {
  role: "admin" | "forecast" | null;
  person: string | null;
  owner?: boolean;
} | null): string | null {
  if (!session) return null;
  if (session.owner || (session.role === "admin" && !session.person)) {
    return OWNER_SLUG;
  }
  return session.person;
}

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

   Snapshot fill uses PERSON_TEAM (below), not this map. Calendar types and
   snapshot deliverable teams are related but not 1:1 — LinkedIn outreach is
   email-team work even though it is not a calendar asset type.
   ------------------------------------------------------------------------- */
export const TEAM_FOCUS: Record<string, readonly AssetType[]> = {
  // SEO: blog content.
  abel: ["blog_post"],
  carlos: ["blog_post"],
  // Social: posts and the video/carousel work that feeds production.
  randi: ["social_post", "social_video_carousel"],
  lana: ["social_post", "social_video_carousel"],
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

/* ---------------------------------------------------------------------------
   Teams
   ---------------------------------------------------------------------------
   A team owns deliverables. The weekly snapshot shows someone the portion their
   team is responsible for, which needs two halves: which team a person is on
   (below) and which team owns a deliverable (snapshot_deliverables.team).

   Specialists (a slug in PERSON_TEAM) default to their own work. Account
   managers are an explicit list (SNAPSHOT_ACCOUNT_MANAGERS): they see every
   row, with strategy and account work sorted to the top. Untagged rows are
   classified from their category/name rather than shown to every specialist
   — see snapshot-fill.ts.
   ------------------------------------------------------------------------- */
export type Team = "email" | "seo" | "social" | "web" | "onboarding" | "client_services";

export const TEAMS: Array<{ slug: Team; label: string }> = [
  { slug: "email", label: "Email" },
  { slug: "seo", label: "SEO" },
  { slug: "social", label: "Social" },
  { slug: "web", label: "Web" },
  { slug: "onboarding", label: "Onboarding" },
  { slug: "client_services", label: "Client Services" },
];

export function isTeam(v: unknown): v is Team {
  return TEAMS.some((t) => t.slug === v);
}

export function teamLabelFor(slug: string): string {
  return TEAMS.find((t) => t.slug === slug)?.label || slug;
}

/**
 * Snapshot fill roster (stated 2026-08-28).
 *
 *    Specialist slug → team. The owner slug is on email so Michael's fill list
 * starts there even though the owner session itself carries a null person.
 * Cassidy and Kyle Morris are client services here and also account managers
 * (SNAPSHOT_ACCOUNT_MANAGERS): they get a team focus label but still see every
 * deliverable unscoped via isSnapshotAccountManager in snapshot fill.
 *
 *   michael      email
 *   abel         seo
 *   carlos       seo
 *   randi        social
 *   lana         social
 *   roy          web
 *   saqib        web
 *   luis_romero  onboarding
 *   cassidy      client_services
 *   kyle_morris  client_services
 */
export const PERSON_TEAM: Record<string, Team> = {
  michael: "email",
  abel: "seo",
  carlos: "seo",
  randi: "social",
  lana: "social",
  roy: "web",
  saqib: "web",
  luis_romero: "onboarding",
  cassidy: "client_services",
  kyle_morris: "client_services",
};

/** Cassidy and Kyle Morris: every deliverable, strategy/account rows first. */
export const SNAPSHOT_ACCOUNT_MANAGERS = ["cassidy", "kyle_morris"] as const;

export function isSnapshotAccountManager(slug: string | null): boolean {
  return Boolean(slug) && (SNAPSHOT_ACCOUNT_MANAGERS as readonly string[]).includes(slug!);
}

export function personTeam(slug: string | null): Team | null {
  if (!slug) return null;
  return PERSON_TEAM[slug] ?? null;
}

// Roster members with no specialist team. Account managers for snapshot fill
// are the explicit SNAPSHOT_ACCOUNT_MANAGERS list, not everyone in this gap.
export function peopleWithoutTeam(): Array<{ slug: string; label: string }> {
  return PEOPLE.filter((p) => !PERSON_TEAM[p.slug]).map((p) => ({
    slug: p.slug,
    label: p.label,
  }));
}

export function personLabel(slug: string): string {
  return PEOPLE.find((p) => p.slug === slug)?.label || slug;
}

/**
 * Display name for a stored actor tag, as written by sessionActor in ./auth.
 *
 * Consults both rosters because they do not fully overlap: a few admin logins
 * (kyle_onstott, luis_romero) are not on the forecast roster, and personLabel
 * alone would render them as their raw slug.
 *
 * A tag can carry an `:impersonated` marker. That is kept visible on purpose. The
 * session cookie does not record which admin was acting, so the only honest
 * reading of an impersonated write is "this is filed under Randi, but Randi may
 * not have typed it" — and crediting it to her flatly would be a small lie in a
 * record whose entire job is saying who did the work.
 */
export function actorLabel(tag: string): string {
  if (!tag) return "";
  const [slug, marker] = tag.split(":");
  if (!slug) return "";
  const label =
    PEOPLE.find((p) => p.slug === slug)?.label ||
    ADMIN_PEOPLE.find((p) => p.slug === slug)?.label ||
    slug;
  return marker === "impersonated" ? `${label} (via admin)` : label;
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
  "lana",
  "cassidy",
  "sylvia",
  "luis_romero",
  "kyle_morris",
  "kyle_onstott",
] as const;

export function hasProductionAccess(slug: string): boolean {
  return PRODUCTION_ACCESS.includes(slug);
}

/**
 * Campaign calendar and weekly ads are owner-only tools. The owner session
 * (null person) and Michael's named admin login both pass; impersonating does
 * not, so "view as Cassidy" matches what Cassidy would see.
 */
export function hasOwnerToolsAccess(session: {
  role: "admin" | "forecast" | null;
  person: string | null;
  owner?: boolean;
  impersonating?: boolean;
} | null): boolean {
  if (!session || session.impersonating) return false;
  if (session.role !== "admin") return false;
  return Boolean(session.owner) || session.person === OWNER_SLUG;
}

/**
 * Kyle Onstott, Sylvia, Luis, and Morris land on a team-ops home instead of
 * the campaign dashboard: every forecast, production highlights, and a door
 * into Client Services.
 */
export const LEADERSHIP_HOME_SLUGS = [
  "kyle_onstott",
  "sylvia",
  "luis_romero",
  "kyle_morris",
] as const;

export function usesLeadershipHome(slug: string | null): boolean {
  return Boolean(slug) && (LEADERSHIP_HOME_SLUGS as readonly string[]).includes(slug!);
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

// An account manager is stored on a client as a first name, and the Basecamp
// display name does not follow from it. "Kyle" is Morris Kyle; Kyle Onstott is a
// different person who was being notified instead. "Luis" matched Luis Romero
// only by luck of roster order, with Debbie/Luis Mares also a candidate.
//
// Mapped explicitly, because a notification that pings the wrong colleague is
// worse than one that pings nobody. An unmapped value resolves to nothing rather
// than the nearest name.
export const ACCOUNT_MANAGER_BASECAMP_NAME: Record<string, string> = {
  kyle: "Morris Kyle",
  cassidy: "Cassidy Merideth",
  luis: "Luis Romero",
  sylvia: "Sylvia Artiga",
};

// Basecamp display name used when CC'ing Sylvia on review notes. Same mapping
// as the account-manager table so a first-name match cannot ping the wrong person.
export const SYLVIA_BASECAMP_NAME = ACCOUNT_MANAGER_BASECAMP_NAME.sylvia;

export function basecampNameForManager(value: string): string {
  return ACCOUNT_MANAGER_BASECAMP_NAME[(value || "").trim().toLowerCase()] || "";
}
