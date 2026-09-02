import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "path";
import {
  PEOPLE,
  PRODUCTION_ACCESS,
  SEO_ONLY_PEOPLE,
  TEAM_FOCUS,
  campaignKindFor,
  doesCampaignWork,
  hasProductionAccess,
  hasOwnerToolsAccess,
  hasAdsDashboardAccess,
  isSeoOnly,
  isTeam,
  isSnapshotAccountManager,
  isValidPerson,
  peopleWithoutTeam,
  personTeam,
  teamFocus,
  PERSON_TEAM,
  OWNER_SLUG,
  usesLeadershipHome,
} from "../src/lib/people";
import { ADMIN_PEOPLE } from "../src/lib/admin-people";

// The exact list the owner asked for on 2026-08-01.
const EXPECTED_PRODUCTION = [
  "michael",
  "jack",
  "paula",
  "cassidy",
  "luis_romero",
  "sylvia",
  "kyle_morris",
  "kyle_onstott",
  "randi",
  "lana",
];

test("production access is exactly the people named, no more", () => {
  assert.deepEqual([...PRODUCTION_ACCESS].sort(), [...EXPECTED_PRODUCTION].sort());
  for (const slug of EXPECTED_PRODUCTION) {
    assert.equal(hasProductionAccess(slug), true, `${slug} should have it`);
  }
});

test("being an admin no longer implies production access", () => {
  // Carlos is an admin on the SEO side and must not see the shoot schedule.
  assert.ok(
    ADMIN_PEOPLE.some((p) => p.slug === "carlos"),
    "carlos is expected to still be an admin"
  );
  assert.equal(hasProductionAccess("carlos"), false);
});

test("the people left off the list do not have production access", () => {
  for (const slug of ["carlos", "roy", "abel", "mike_hines", "saqib", "jerald"]) {
    assert.equal(hasProductionAccess(slug), false, `${slug} should not have it`);
  }
});

test("every production slug is a real person", () => {
  const known = new Set<string>([
    ...PEOPLE.map((p) => p.slug),
    ...ADMIN_PEOPLE.map((p) => p.slug),
  ]);
  for (const slug of PRODUCTION_ACCESS) {
    assert.ok(known.has(slug), `${slug} is not in either roster`);
  }
});

test("the owner has production access", () => {
  assert.equal(hasProductionAccess(OWNER_SLUG), true);
});

test("campaign calendar is owner-only in the nav", () => {
  const michaelOwner = { role: "admin" as const, person: null, owner: true };
  const michaelNamed = { role: "admin" as const, person: "michael", owner: false };
  const cassidy = { role: "admin" as const, person: "cassidy", owner: false };
  const jack = { role: "forecast" as const, person: "jack", owner: false };
  const impersonating = {
    role: "admin" as const,
    person: "cassidy",
    owner: true,
    impersonating: true,
  };

  assert.equal(hasOwnerToolsAccess(michaelOwner), true);
  assert.equal(hasOwnerToolsAccess(michaelNamed), true);
  assert.equal(hasOwnerToolsAccess(cassidy), false);
  assert.equal(hasOwnerToolsAccess(jack), false);
  assert.equal(hasOwnerToolsAccess(impersonating), false);
  assert.equal(hasOwnerToolsAccess(null), false);
});

test("weekly ads is open to the owner plus Mike Hines, Jerald, and Kyle Morris", () => {
  const owner = { role: "admin" as const, person: null, owner: true };
  const michael = { role: "admin" as const, person: "michael", owner: false };
  const jerald = { role: "admin" as const, person: "jerald", owner: false };
  const kyle = { role: "admin" as const, person: "kyle_morris", owner: false };
  const mike = { role: "forecast" as const, person: "mike_hines", owner: false };
  const cassidy = { role: "admin" as const, person: "cassidy", owner: false };
  const jack = { role: "forecast" as const, person: "jack", owner: false };

  assert.equal(hasAdsDashboardAccess(owner), true);
  assert.equal(hasAdsDashboardAccess(michael), true);
  assert.equal(hasAdsDashboardAccess(jerald), true);
  assert.equal(hasAdsDashboardAccess(kyle), true);
  assert.equal(hasAdsDashboardAccess(mike), true);
  assert.equal(hasAdsDashboardAccess(cassidy), false);
  assert.equal(hasAdsDashboardAccess(jack), false);
  assert.equal(hasAdsDashboardAccess(null), false);
  assert.equal(
    hasAdsDashboardAccess({
      role: "admin",
      person: "cassidy",
      owner: true,
      impersonating: true,
    }),
    false
  );
  assert.equal(
    hasAdsDashboardAccess({
      role: "admin",
      person: "jerald",
      owner: true,
      impersonating: true,
    }),
    true
  );
});

test("the ads page and APIs use the ads allowlist, not owner-only tools", () => {
  const layout = fs.readFileSync(path.join("src/app/admin/ads/layout.tsx"), "utf8");
  const list = fs.readFileSync(path.join("src/app/api/ads/route.ts"), "utf8");
  const patch = fs.readFileSync(
    path.join("src/app/api/ads/[clientId]/route.ts"),
    "utf8"
  );
  assert.match(layout, /isAdsDashboardAuthenticated/);
  assert.match(list, /isAdsDashboardAuthenticated/);
  assert.match(patch, /isAdsDashboardAuthenticated/);
  assert.doesNotMatch(layout, /isOwnerToolsAuthenticated/);
});

test("the app shell hides calendar unless the owner is signed in", () => {
  const shell = fs.readFileSync(
    path.join("src/components/AppShell.tsx"),
    "utf8"
  );
  assert.match(shell, /hasOwnerToolsAccess/);
  assert.match(shell, /canSeeOwnerTools/);
  assert.match(shell, /item\.href === "\/admin\/calendar" && !canSeeOwnerTools/);
  assert.match(shell, /hasAdsDashboardAccess/);
  assert.match(shell, /item\.href === "\/admin\/ads" && !canSeeAds/);
});

test("the SEO team is abel and carlos, and only them", () => {
  assert.deepEqual([...SEO_ONLY_PEOPLE].sort(), ["abel", "carlos"]);
  assert.equal(isSeoOnly("abel"), true);
  assert.equal(isSeoOnly("carlos"), true);
});

test("nobody else is blog-scoped, including the owner and unknown slugs", () => {
  for (const slug of [OWNER_SLUG, "jack", "cassidy", "sylvia", "lana", "nope"]) {
    assert.equal(isSeoOnly(slug), false, `${slug} should not be blog-scoped`);
  }
  assert.equal(isSeoOnly(null), false);
});

test("nobody is both on the SEO team and on production", () => {
  for (const slug of SEO_ONLY_PEOPLE as readonly string[]) {
    assert.equal(
      hasProductionAccess(slug),
      false,
      `${slug} is SEO-only and should not have production`
    );
  }
});

/* --------------------------------------------------------------- team focus */

test("the SEO pair's calendar is blog work only", () => {
  for (const slug of ["abel", "carlos"]) {
    assert.deepEqual(teamFocus(slug), ["blog_post"]);
    assert.equal(campaignKindFor(slug), "blog");
    assert.equal(doesCampaignWork(slug), true);
  }
});

test("the social pair's calendar is posts and video/carousel, not blog-scoped", () => {
  for (const slug of ["randi", "lana"]) {
    assert.deepEqual(teamFocus(slug), ["social_post", "social_video_carousel"]);
    assert.equal(doesCampaignWork(slug), true);
    // Two asset types, so the campaigns list must not be narrowed to blogs.
    assert.equal(campaignKindFor(slug), null);
  }
});

test("Roy is on the web team and does no campaign work", () => {
  assert.deepEqual(teamFocus("roy"), []);
  assert.equal(doesCampaignWork("roy"), false);
  assert.equal(campaignKindFor("roy"), null);
});

test("an empty focus is distinct from no focus at all", () => {
  // [] means "owns nothing" and must filter everything out; null means
  // "unrestricted". Conflating them would silently show Roy the whole calendar.
  assert.deepEqual(teamFocus("roy"), []);
  assert.equal(teamFocus("jack"), null);
  assert.equal(teamFocus(OWNER_SLUG), null);
  assert.equal(teamFocus(null), null);
});

test("anyone without a focus entry owns everything", () => {
  for (const slug of ["jack", "paula", "cassidy", "kyle_morris", "sylvia", OWNER_SLUG]) {
    assert.equal(teamFocus(slug), null, `${slug} should be unrestricted`);
    assert.equal(doesCampaignWork(slug), true);
    assert.equal(campaignKindFor(slug), null);
  }
});

test("Kyle Morris is on the forecast roster", () => {
  assert.equal(isValidPerson("kyle_morris"), true);
  assert.equal(PEOPLE.find((p) => p.slug === "kyle_morris")?.label, "Kyle Morris");
  assert.equal(PEOPLE.find((p) => p.slug === "kyle_morris")?.entryLevel, false);
});

test("Luis Romero is on the forecast roster", () => {
  assert.equal(isValidPerson("luis_romero"), true);
  assert.equal(PEOPLE.find((p) => p.slug === "luis_romero")?.label, "Luis Romero");
  assert.equal(PEOPLE.find((p) => p.slug === "luis_romero")?.entryLevel, false);
  assert.equal(hasProductionAccess("luis_romero"), true);
  assert.equal(personTeam("luis_romero"), "onboarding");
});

test("Saqib is a restricted forecast login", () => {
  assert.equal(isValidPerson("saqib"), true);
  const person = PEOPLE.find((p) => p.slug === "saqib");
  assert.equal(person?.label, "Saqib");
  assert.equal(person?.entryLevel, true, "saqib should show in view-as");
  assert.equal(person?.productionAccess, false);
  assert.equal(hasProductionAccess("saqib"), false);
  assert.equal(teamFocus("saqib"), null, "saqib should be unrestricted");
  assert.equal(personTeam("saqib"), "web");
});

test("Jerald is a named full-access admin", () => {
  assert.ok(ADMIN_PEOPLE.some((p) => p.slug === "jerald"));
  assert.equal(isValidPerson("jerald"), true);
  const person = PEOPLE.find((p) => p.slug === "jerald");
  assert.equal(person?.label, "Jerald");
  assert.equal(person?.entryLevel, false, "jerald should not show in view-as team members");
  assert.equal(person?.productionAccess, false);
  assert.equal(hasProductionAccess("jerald"), false);
  assert.equal(teamFocus("jerald"), null);
  assert.equal(personTeam("jerald"), null);
});

test("Sylvia is on the forecast roster", () => {
  assert.equal(isValidPerson("sylvia"), true);
  assert.equal(PEOPLE.find((p) => p.slug === "sylvia")?.label, "Sylvia");
  assert.equal(PEOPLE.find((p) => p.slug === "sylvia")?.entryLevel, false);
  assert.equal(hasProductionAccess("sylvia"), true);
});

test("Kyle, Sylvia, Luis, and Morris get the leadership home", () => {
  for (const slug of ["kyle_onstott", "sylvia", "luis_romero", "kyle_morris"]) {
    assert.equal(usesLeadershipHome(slug), true, slug);
  }
  assert.equal(usesLeadershipHome("michael"), false);
  assert.equal(usesLeadershipHome("cassidy"), false);
  assert.equal(usesLeadershipHome(null), false);
});

test("every focused slug is a real person", () => {
  // Widened, because PEOPLE is `as const` and the Set would otherwise infer the
  // literal union rather than string.
  const known = new Set<string>(PEOPLE.map((p) => p.slug));
  for (const slug of Object.keys(TEAM_FOCUS)) {
    assert.ok(known.has(slug), `${slug} is not in the roster`);
  }
});

test("the social pair keep production access alongside their narrowed calendar", () => {
  // Focus limits what they see on the calendar, not whether they can reach
  // upcoming productions ? social owns the video/carousel work that feeds it.
  for (const slug of ["randi", "lana"]) {
    assert.equal(hasProductionAccess(slug), true, `${slug} should keep production`);
  }
});

test("isSeoOnly still agrees with the focus map", () => {
  // Kept as a named list for readability; this guards the two from drifting.
  for (const slug of SEO_ONLY_PEOPLE) {
    assert.equal(campaignKindFor(slug), "blog", `${slug} should be blog-scoped`);
  }
  assert.equal(isSeoOnly("randi"), false);
  assert.equal(isSeoOnly("lana"), false);
});

/* -------------------------------------------------------------------- teams */

test("the stated team assignments are in place", () => {
  assert.equal(personTeam("michael"), "email");
  assert.equal(personTeam(OWNER_SLUG), "email");
  assert.equal(personTeam("abel"), "seo");
  assert.equal(personTeam("carlos"), "seo");
  assert.equal(personTeam("randi"), "social");
  assert.equal(personTeam("lana"), "social");
  assert.equal(personTeam("roy"), "web");
  assert.equal(personTeam("saqib"), "web");
  assert.equal(personTeam("luis_romero"), "onboarding");
  assert.equal(personTeam("cassidy"), "client_services");
  assert.equal(personTeam("kyle_morris"), "client_services");
});

test("account managers are Cassidy and Kyle Morris, not every unassigned person", () => {
  assert.equal(isSnapshotAccountManager("cassidy"), true);
  assert.equal(isSnapshotAccountManager("kyle_morris"), true);
  assert.equal(isSnapshotAccountManager("michael"), false);
  assert.equal(isSnapshotAccountManager("jack"), false);
  assert.equal(isSnapshotAccountManager("paula"), false);
  assert.equal(personTeam("jack"), null);
  assert.equal(personTeam("paula"), null);
  assert.equal(personTeam("jerald"), null);
  assert.equal(personTeam(null), null);
  assert.equal(personTeam("not-a-person"), null);
});

test("peopleWithoutTeam lists roster members with no specialist team", () => {
  const gaps = peopleWithoutTeam().map((p) => p.slug);
  for (const slug of [
    "michael",
    "abel",
    "carlos",
    "randi",
    "lana",
    "roy",
    "saqib",
    "luis_romero",
    "cassidy",
    "kyle_morris",
  ]) {
    assert.ok(!gaps.includes(slug), `${slug} has a specialist team`);
  }
  assert.ok(gaps.includes("jack"));
});

test("every team slug on a person is a real team", () => {
  for (const slug of Object.values(PERSON_TEAM)) {
    assert.equal(isTeam(slug), true, `${slug} is not a known team`);
  }
});

test("isTeam rejects anything not on the list", () => {
  assert.equal(isTeam("onboarding"), true);
  assert.equal(isTeam("client_services"), true);
  assert.equal(isTeam("email"), true);
  assert.equal(isTeam("seo"), true);
  assert.equal(isTeam(""), false);
  assert.equal(isTeam("Email"), false, "team slugs are lowercase");
  assert.equal(isTeam("design"), false);
  assert.equal(isTeam(null), false);
});
