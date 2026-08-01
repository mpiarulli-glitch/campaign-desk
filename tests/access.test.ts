import assert from "node:assert/strict";
import test from "node:test";
import {
  PEOPLE,
  PRODUCTION_ACCESS,
  SEO_ONLY_PEOPLE,
  TEAM_FOCUS,
  campaignKindFor,
  doesCampaignWork,
  hasProductionAccess,
  isSeoOnly,
  isTeam,
  peopleWithoutTeam,
  personTeam,
  teamFocus,
  PERSON_TEAM,
  OWNER_SLUG,
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
];

test("production access is exactly the nine people named, no more", () => {
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
  for (const slug of ["carlos", "roy", "abel", "mike_hines"]) {
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

test("the SEO team is abel and carlos, and only them", () => {
  assert.deepEqual([...SEO_ONLY_PEOPLE].sort(), ["abel", "carlos"]);
  assert.equal(isSeoOnly("abel"), true);
  assert.equal(isSeoOnly("carlos"), true);
});

test("nobody else is blog-scoped, including the owner and unknown slugs", () => {
  for (const slug of [OWNER_SLUG, "jack", "cassidy", "sylvia", "nope"]) {
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

test("Randi's calendar is the social work, and is not treated as blog-scoped", () => {
  assert.deepEqual(teamFocus("randi"), ["social_post", "social_video_carousel"]);
  assert.equal(doesCampaignWork("randi"), true);
  // Two asset types, so the campaigns list must not be narrowed to blogs.
  assert.equal(campaignKindFor("randi"), null);
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
  for (const slug of ["jack", "paula", "cassidy", "sylvia", OWNER_SLUG]) {
    assert.equal(teamFocus(slug), null, `${slug} should be unrestricted`);
    assert.equal(doesCampaignWork(slug), true);
    assert.equal(campaignKindFor(slug), null);
  }
});

test("every focused slug is a real person", () => {
  // Widened, because PEOPLE is `as const` and the Set would otherwise infer the
  // literal union rather than string.
  const known = new Set<string>(PEOPLE.map((p) => p.slug));
  for (const slug of Object.keys(TEAM_FOCUS)) {
    assert.ok(known.has(slug), `${slug} is not in the roster`);
  }
});

test("Randi keeps production access alongside her narrowed calendar", () => {
  // Her focus limits what she sees on the calendar, not whether she can reach
  // upcoming productions.
  assert.equal(hasProductionAccess("randi"), true);
});

test("isSeoOnly still agrees with the focus map", () => {
  // Kept as a named list for readability; this guards the two from drifting.
  for (const slug of SEO_ONLY_PEOPLE) {
    assert.equal(campaignKindFor(slug), "blog", `${slug} should be blog-scoped`);
  }
  assert.equal(isSeoOnly("randi"), false);
});

/* -------------------------------------------------------------------- teams */

test("the stated team assignments are in place", () => {
  assert.equal(personTeam("abel"), "seo");
  assert.equal(personTeam("carlos"), "seo");
  assert.equal(personTeam("randi"), "social");
  assert.equal(personTeam("roy"), "web");
});

test("an unassigned person is unscoped rather than shut out", () => {
  // Failing open matters here: a missing entry should mean "sees everything",
  // never "sees nothing", or a team would lose sight of its own work.
  assert.equal(personTeam("jack"), null);
  assert.equal(personTeam("paula"), null);
  assert.equal(personTeam(OWNER_SLUG), null);
  assert.equal(personTeam(null), null);
  assert.equal(personTeam("not-a-person"), null);
});

test("peopleWithoutTeam lists exactly the gaps still to be filled", () => {
  const gaps = peopleWithoutTeam().map((p) => p.slug).sort();
  const assigned = Object.keys(TEAM_FOCUS);
  // Nobody with a stated team should appear as a gap.
  for (const slug of ["abel", "carlos", "randi", "roy"]) {
    assert.ok(!gaps.includes(slug), `${slug} has a team and should not be a gap`);
  }
  assert.ok(gaps.includes("jack"), "jack has no team yet");
  assert.ok(assigned.length > 0);
});

test("every team slug on a person is a real team", () => {
  for (const slug of Object.values(PERSON_TEAM)) {
    assert.equal(isTeam(slug), true, `${slug} is not a known team`);
  }
});

test("isTeam rejects anything not on the list", () => {
  assert.equal(isTeam("email"), true);
  assert.equal(isTeam("seo"), true);
  assert.equal(isTeam(""), false);
  assert.equal(isTeam("Email"), false, "team slugs are lowercase");
  assert.equal(isTeam("design"), false);
  assert.equal(isTeam(null), false);
});
