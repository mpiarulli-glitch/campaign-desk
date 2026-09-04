/* ---------------------------------------------------------------------------
   Per-person access
   ---------------------------------------------------------------------------
   One registry of everything a person can be given or denied, plus the rules
   that decide it. The owner edits this on /admin/access; every gate in the app
   reads the answer from here.

   Two layers, in this order:

     1. the default their role has always carried (defaultAllowed below)
     2. an explicit row the owner wrote in user_access, which wins

   Defaults stay in code on purpose. The alternative is seeding a row per person
   per capability, and then the shipped behaviour of the app is only legible by
   querying a database. Here a person with no rows behaves exactly as they did
   before this feature existed, and every row that does exist is a decision
   somebody actually made.

   defaultAllowed is a transcription of the rules that were spread across
   AppShell's two nav arrays, PRODUCTION_ACCESS, ADS_DASHBOARD_PEOPLE,
   SOCIAL_QA_PEOPLE, hasOwnerToolsAccess and TEAM_FOCUS. When one of those
   changes, change it there and mirror it here; tests/user-access.test.ts
   pins the pairs that matter so the two cannot drift silently.
   ------------------------------------------------------------------------- */

import {
  getDb,
  nowIso,
  type UserAccessRow,
  type UserCampaignKindRow,
  type UserForecastAccessRow,
} from "./db";
import { ADMIN_PEOPLE } from "./admin-people";
import {
  PEOPLE,
  OWNER_SLUG,
  campaignKindFor,
  doesCampaignWork,
  hasAdsDashboardAccess,
  hasOwnerToolsAccess,
  hasProductionAccess,
  hasSocialQaAccess,
  personLabel,
  type CampaignKindScope,
} from "./people";

export type CapabilityGroup = "page" | "tool";

export type Capability = {
  key: string;
  label: string;
  group: CapabilityGroup;
  /**
   * The route, when this page is also a sidebar link. Omitted for a page that
   * still exists and still needs gating but was deliberately taken out of the
   * nav, which is Snapshots: giving it an href here would put the link back.
   */
  href?: string;
  /** Icon name in AppShell's ICONS map. Present exactly when href is. */
  icon?: string;
  /** The one line the owner reads next to the toggle. */
  blurb: string;
  /**
   * Not togglable. Home is where every sign-in lands and Accounts/Access are
   * how the owner gets back in, so a switch on any of them is a way to lock
   * somebody, or yourself, out of the app.
   */
  fixed?: boolean;
};

/* ---------------------------------------------------------------------------
   Pages
   ---------------------------------------------------------------------------
   Listed in the order the admin sidebar renders them, since this array is now
   what builds it. One knock-on: a user-role person used to get Production at
   the very bottom of their sidebar and now gets it above Forecast, in the
   same slot an admin sees it. MEG Team Hub is Home and always first.
   ------------------------------------------------------------------------- */

export const PAGES: Capability[] = [
  {
    key: "page.home",
    label: "MEG Team Hub",
    group: "page",
    href: "/admin/hub",
    icon: "users",
    blurb: "SOPs, training, HR and team sentiment. Where every sign in lands.",
    fixed: true,
  },
  {
    key: "page.clients",
    label: "Clients",
    group: "page",
    href: "/admin/clients",
    icon: "clients",
    blurb: "The client roster, briefs and strategy.",
  },
  {
    key: "page.campaigns",
    label: "Campaigns",
    group: "page",
    href: "/admin/campaigns",
    icon: "mail",
    blurb:
      "Review packages and their approvals. Narrow which kinds below once this is on.",
  },
  {
    key: "page.social_qa",
    label: "Social QA",
    group: "page",
    href: "/admin/social-qa",
    icon: "social",
    blurb:
      "Social post batches, Sprout links, internal QA and named sign-off.",
  },
  {
    key: "page.lifecycle",
    label: "Lifecycle",
    group: "page",
    href: "/admin/lifecycle",
    icon: "funnel",
    blurb: "Outreach, seats and per client economics.",
  },
  {
    key: "page.ads",
    label: "Ads",
    group: "page",
    href: "/admin/ads",
    icon: "ads",
    blurb: "The weekly paid media pass, per client.",
  },
  {
    key: "page.calendar",
    label: "Calendar",
    group: "page",
    href: "/admin/calendar",
    icon: "calendar",
    blurb: "The send calendar across every client. Owner only by default.",
  },
  {
    key: "page.production",
    label: "Production",
    group: "page",
    href: "/admin/production",
    icon: "video",
    blurb: "Shoot windows, crew links and briefs.",
  },
  {
    key: "page.forecast",
    label: "Forecast",
    group: "page",
    href: "/admin/forecast",
    icon: "forecast",
    blurb: "Their own week of work and hours.",
  },
  {
    key: "page.onboarding",
    label: "Onboarding",
    group: "page",
    href: "/admin/onboarding",
    icon: "check",
    blurb: "New client setup board and its steps.",
  },
  {
    key: "page.whiteboard",
    label: "Whiteboard",
    group: "page",
    href: "/admin/whiteboard",
    icon: "board",
    blurb: "Shared canvases and their revisions.",
  },
  {
    key: "page.client_services",
    label: "Client Services",
    group: "page",
    href: "/admin/client-services",
    icon: "ring",
    blurb: "The account health ring and what each client is owed.",
  },
  {
    key: "page.reports",
    label: "Reports",
    group: "page",
    href: "/admin/reports",
    icon: "note",
    blurb: "Rollups across every client and person.",
  },
  {
    key: "page.activity",
    label: "Activity",
    group: "page",
    href: "/admin/activity",
    icon: "activity",
    blurb: "Who changed what, across the whole app.",
  },
  {
    key: "page.snapshot",
    label: "Snapshots",
    group: "page",
    blurb:
      "Weekly account snapshots. Off the sidebar since Client Services replaced it, so this only governs direct and saved links.",
  },
];

/* ------------------------------------------------------------------- tools */

export const TOOLS: Capability[] = [
  {
    key: "tool.campaign_edit",
    label: "Build and edit campaigns",
    group: "tool",
    blurb: "Create review packages and change their content. Off means read only.",
  },
  {
    key: "tool.ai_revise",
    label: "AI revision",
    group: "tool",
    blurb: "Rewrite an asset from client feedback with the model.",
  },
  {
    key: "tool.calendar_import",
    label: "Calendar import",
    group: "tool",
    blurb: "Bulk load a month of sends from a spreadsheet. Owner only by default.",
  },
  {
    key: "tool.client_edit",
    label: "Add and edit clients",
    group: "tool",
    blurb: "Change the client registry, contracts and cadence.",
  },
  {
    key: "tool.chat",
    label: "Desk chat",
    group: "tool",
    blurb: "The in app assistant that can read account data.",
  },
  {
    key: "tool.forecast_all",
    label: "See the whole team's forecast",
    group: "tool",
    blurb: "The team wide board. Off limits them to the people picked below.",
  },
  {
    key: "tool.impersonate",
    label: "View as another person",
    group: "tool",
    blurb: "Open the app as somebody else sees it. Owner only by default.",
  },
  {
    key: "tool.accounts",
    label: "Manage logins",
    group: "tool",
    blurb: "Send invites, reset passwords, disable accounts.",
  },
  {
    key: "tool.access",
    label: "Manage permissions",
    group: "tool",
    blurb: "This page. Owner only, and not grantable.",
    fixed: true,
  },
];

export const CAPABILITIES: Capability[] = [...PAGES, ...TOOLS];

const BY_KEY = new Map(CAPABILITIES.map((c) => [c.key, c]));

export function capability(key: string): Capability | null {
  return BY_KEY.get(key) || null;
}

export function isCapability(key: string): boolean {
  return BY_KEY.has(key);
}

/** A capability the owner may actually toggle for somebody. */
export function isGrantable(key: string): boolean {
  const cap = BY_KEY.get(key);
  return Boolean(cap) && !cap!.fixed;
}

/* -------------------------------------------------------------- the person */

export type AccessSubject = {
  /** The session role. The owner is an admin whose person is null. */
  role: "admin" | "forecast";
  person: string | null;
  owner: boolean;
  /**
   * Whether this is an owner viewing the app as somebody else. It changes two
   * defaults on purpose: Calendar and Ads are written so that "view as Cassidy"
   * shows what Cassidy sees rather than what the owner sees.
   */
  impersonating?: boolean;
};

/** The subject for a roster slug, as the owner previews it on /admin/access. */
export function subjectFor(slug: string): AccessSubject {
  if (slug === OWNER_SLUG) return { role: "admin", person: null, owner: true };
  const isAdmin = ADMIN_PEOPLE.some((p) => p.slug === slug);
  return { role: isAdmin ? "admin" : "forecast", person: slug, owner: false };
}

/* ------------------------------------------------------------------ default */

/**
 * What this person's role gave them before any override.
 *
 * Kept in one function so the answer is the same on the server and in the
 * sidebar. The delegating calls (hasProductionAccess, hasOwnerToolsAccess,
 * hasAdsDashboardAccess, TEAM_FOCUS, SOCIAL_QA_PEOPLE) are deliberate: those
 * lists stay the source of truth and this reads them rather than copying
 * their contents.
 */
export function defaultAllowed(key: string, who: AccessSubject): boolean {
  if (who.owner) return true;

  const cap = BY_KEY.get(key);
  if (!cap) return false;
  if (cap.fixed) return key === "page.home";

  const person = who.person;
  const admin = who.role === "admin";
  const session = {
    role: who.role,
    person: who.person,
    owner: who.owner,
    impersonating: who.impersonating,
  };

  // The campaign pages follow TEAM_FOCUS. An empty focus (the web team) loses
  // them outright; a narrowed focus that still includes campaign work (the SEO
  // side) keeps Campaigns even on the user role.
  const ownsCampaignWork = doesCampaignWork(person);
  const focusedOnCampaigns = campaignKindFor(person) !== null;

  switch (key) {
    case "page.forecast":
      return true;

    case "page.production":
      return Boolean(person) && hasProductionAccess(person!);

    case "page.ads":
      return hasAdsDashboardAccess(session);

    case "page.social_qa":
      return hasSocialQaAccess(session);

    // The campaign calendar is an owner tool, so this is false for everybody
    // else until the owner grants it.
    case "page.calendar":
    case "tool.calendar_import":
      return hasOwnerToolsAccess(session);

    case "page.campaigns":
      if (!ownsCampaignWork) return false;
      return admin || focusedOnCampaigns;

    // Open to both roles today. Team Hub itself is page.home (always on).
    case "page.whiteboard":
    case "page.client_services":
    case "page.snapshot":
      return true;

    // Admin sidebar only: each one aggregates across every client or person.
    case "page.clients":
    case "page.lifecycle":
    case "page.onboarding":
    case "page.reports":
    case "page.activity":
      return admin;

    // Tools that have always been gated on being an admin.
    case "tool.campaign_edit":
    case "tool.ai_revise":
    case "tool.client_edit":
      return admin;

    // Chat authorised any signed in session.
    case "tool.chat":
      return true;

    // The team wide forecast board is an admin view.
    case "tool.forecast_all":
      return admin;

    // Owner only until granted.
    case "tool.impersonate":
    case "tool.accounts":
      return false;

    default:
      return false;
  }
}

/* ---------------------------------------------------------------- overrides */

/** The rows the owner has written for one person, capability -> allowed. */
export function overridesFor(person: string): Map<string, boolean> {
  const rows = getDb()
    .prepare(`SELECT * FROM user_access WHERE person = ?`)
    .all(person) as UserAccessRow[];
  const map = new Map<string, boolean>();
  for (const row of rows) {
    if (isGrantable(row.capability)) map.set(row.capability, row.allowed === 1);
  }
  return map;
}

/**
 * Write, flip or clear one override.
 *
 * `null` deletes the row, which is how a capability goes back to following its
 * role default rather than being pinned to whatever the default happens to be
 * today.
 */
export function setOverride(
  person: string,
  key: string,
  allowed: boolean | null,
  by: string
): void {
  if (!isGrantable(key)) throw new Error(`Not a grantable capability: ${key}`);
  if (person === OWNER_SLUG) throw new Error("The owner's access cannot be changed.");

  const db = getDb();
  if (allowed === null) {
    db.prepare(`DELETE FROM user_access WHERE person = ? AND capability = ?`).run(
      person,
      key
    );
    return;
  }
  db.prepare(
    `INSERT INTO user_access (person, capability, allowed, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(person, capability) DO UPDATE SET
       allowed = excluded.allowed,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`
  ).run(person, key, allowed ? 1 : 0, nowIso(), by);
}

/** Drop every override for a person, putting them back on their role default. */
export function clearOverrides(person: string): void {
  getDb().prepare(`DELETE FROM user_access WHERE person = ?`).run(person);
}

/* ---------------------------------------------------------------- effective */

export function allows(who: AccessSubject, key: string): boolean {
  if (who.owner) return true;
  if (!who.person) return false;
  const override = overridesFor(who.person).get(key);
  return override === undefined ? defaultAllowed(key, who) : override;
}

/** The whole matrix for one person, with where each answer came from. */
export type ResolvedCapability = {
  key: string;
  label: string;
  group: CapabilityGroup;
  href?: string;
  icon?: string;
  blurb: string;
  fixed: boolean;
  allowed: boolean;
  byDefault: boolean;
  /** True when a row in user_access is what decided it. */
  overridden: boolean;
};

export function resolveAll(who: AccessSubject): ResolvedCapability[] {
  const overrides: Map<string, boolean> =
    who.person && !who.owner ? overridesFor(who.person) : new Map();
  return CAPABILITIES.map((cap) => {
    const byDefault = defaultAllowed(cap.key, who);
    const override = overrides.get(cap.key);
    const allowed = override === undefined ? byDefault : override;
    return {
      key: cap.key,
      label: cap.label,
      group: cap.group,
      href: cap.href,
      icon: cap.icon,
      blurb: cap.blurb,
      fixed: Boolean(cap.fixed),
      allowed,
      byDefault,
      overridden: override !== undefined && override !== byDefault,
    };
  });
}

/**
 * The sidebar, in registry order.
 *
 * Only pages that carry an href, so a gated-but-unlinked page (Snapshots)
 * stays out of the nav no matter how its toggle is set.
 */
export function visiblePages(who: AccessSubject): Capability[] {
  return PAGES.filter((p) => p.href && allows(who, p.key));
}

/* ----------------------------------------------------------------- forecast */

export const FORECAST_ALL = "*";

/**
 * Whose forecast this person may open.
 *
 * Absence of rows means "follow the default", which is every person for an
 * admin and only themselves for a user. A stored set replaces that entirely,
 * with one exception below: their own week is never taken away.
 */
export function forecastSubjectsFor(person: string): string[] | null {
  const rows = getDb()
    .prepare(`SELECT * FROM user_forecast_access WHERE person = ?`)
    .all(person) as UserForecastAccessRow[];
  if (!rows.length) return null;
  return rows.map((r) => r.subject);
}

export function setForecastSubjects(
  person: string,
  subjects: string[],
  by: string
): void {
  if (person === OWNER_SLUG) throw new Error("The owner's access cannot be changed.");

  const clean = Array.from(new Set(subjects)).filter(
    (s) => s === FORECAST_ALL || PEOPLE.some((p) => p.slug === s)
  );
  const db = getDb();
  const now = nowIso();
  db.transaction(() => {
    db.prepare(`DELETE FROM user_forecast_access WHERE person = ?`).run(person);
    const insert = db.prepare(
      `INSERT INTO user_forecast_access (person, subject, updated_at, updated_by)
       VALUES (?, ?, ?, ?)`
    );
    for (const subject of clean) insert.run(person, subject, now, by);
  })();
}

/** Put someone back on their role default for forecast visibility. */
export function clearForecastSubjects(person: string): void {
  getDb().prepare(`DELETE FROM user_forecast_access WHERE person = ?`).run(person);
}

/**
 * The effective set, or FORECAST_ALL for no restriction.
 *
 * Their own week is always in the set. Hiding a person's own forecast from them
 * would break the page their sidebar links to, and nothing is protected by it.
 */
export function forecastVisibility(who: AccessSubject): string[] | typeof FORECAST_ALL {
  if (who.owner) return FORECAST_ALL;
  if (!who.person) return [];

  const stored = forecastSubjectsFor(who.person);
  if (stored === null) {
    return allows(who, "tool.forecast_all") ? FORECAST_ALL : [who.person];
  }
  if (stored.includes(FORECAST_ALL)) return FORECAST_ALL;
  return Array.from(new Set([who.person, ...stored]));
}

export function canSeeForecastOf(who: AccessSubject, subject: string): boolean {
  const visible = forecastVisibility(who);
  return visible === FORECAST_ALL || visible.includes(subject);
}

/* ---------------------------------------------------------- campaign kinds */

/** Stored choice on /admin/access. 'all' means every kind; null means default. */
export type CampaignKindChoice = "all" | CampaignKindScope;

export const CAMPAIGN_KIND_CHOICES: Array<{
  value: CampaignKindChoice;
  label: string;
  blurb: string;
}> = [
  {
    value: "all",
    label: "All campaigns",
    blurb: "Every review package, of every kind.",
  },
  {
    value: "blog",
    label: "Blog posts only",
    blurb: "Packages that contain a blog post.",
  },
  {
    value: "interactive",
    label: "Forms / quizzes only",
    blurb: "Packages that contain a form or quiz.",
  },
];

function isCampaignKindChoice(value: unknown): value is CampaignKindChoice {
  return value === "all" || value === "blog" || value === "interactive";
}

/**
 * The owner's stored campaign-kind choice, or null when they have never set one
 * (so the person still follows campaignKindFor / TEAM_FOCUS).
 */
export function campaignKindStored(person: string): CampaignKindChoice | null {
  const row = getDb()
    .prepare(`SELECT * FROM user_campaign_kind WHERE person = ?`)
    .get(person) as UserCampaignKindRow | undefined;
  if (!row || !isCampaignKindChoice(row.kind)) return null;
  return row.kind;
}

export function setCampaignKind(
  person: string,
  kind: CampaignKindChoice,
  by: string
): void {
  if (person === OWNER_SLUG) throw new Error("The owner's access cannot be changed.");
  if (!isCampaignKindChoice(kind)) throw new Error("Unknown campaign kind.");
  getDb()
    .prepare(
      `INSERT INTO user_campaign_kind (person, kind, updated_at, updated_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(person) DO UPDATE SET
         kind = excluded.kind,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`
    )
    .run(person, kind, nowIso(), by);
}

export function clearCampaignKind(person: string): void {
  getDb().prepare(`DELETE FROM user_campaign_kind WHERE person = ?`).run(person);
}

/**
 * Effective list filter for Campaigns.
 *
 * null means unrestricted. A stored 'all' also means unrestricted. Otherwise
 * the stored kind wins over the TEAM_FOCUS default (blog for the SEO pair).
 */
export function effectiveCampaignKind(
  who: AccessSubject
): CampaignKindScope | null {
  if (who.owner || !who.person) return null;
  const stored = campaignKindStored(who.person);
  if (stored === "all") return null;
  if (stored === "blog" || stored === "interactive") return stored;
  return campaignKindFor(who.person);
}

/* ------------------------------------------------------------------ roster */

/** Everyone whose forecast can be handed out, for the picker on /admin/access. */
export function forecastRoster(): Array<{ slug: string; label: string }> {
  return PEOPLE.map((p) => ({ slug: p.slug, label: p.label }));
}

/** Every account the owner can edit access for. The owner is not one of them. */
export function manageableAccounts(): Array<{
  slug: string;
  label: string;
  role: "admin" | "forecast";
}> {
  const seen = new Map<string, { slug: string; label: string; role: "admin" | "forecast" }>();
  // ADMIN_PEOPLE has no owner entry, so only the PEOPLE pass needs the guard.
  for (const p of ADMIN_PEOPLE) {
    seen.set(p.slug, { slug: p.slug, label: p.label, role: "admin" });
  }
  for (const p of PEOPLE) {
    if (p.slug === OWNER_SLUG || seen.has(p.slug)) continue;
    seen.set(p.slug, { slug: p.slug, label: p.label, role: "forecast" });
  }
  return Array.from(seen.values()).sort((a, b) => {
    if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

export { personLabel };
