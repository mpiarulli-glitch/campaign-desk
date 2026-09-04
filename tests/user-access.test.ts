import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Same shape as tests/users.test.ts: db.ts resolves its file from cwd at first
// import, so this chdirs to a throwaway directory and imports dynamically. One
// top-level test because tsx compiles to CJS here, with no top-level await.

test("per-person access", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-access-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const access = await import("../src/lib/access");
  const { OWNER_SLUG, ADS_DASHBOARD_PEOPLE, PRODUCTION_ACCESS, SOCIAL_QA_PEOPLE } = await import(
    "../src/lib/people"
  );

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const owner = access.subjectFor(OWNER_SLUG);
  const jack = access.subjectFor("jack"); // user role, production access
  const roy = access.subjectFor("roy"); // user role, empty campaign focus
  const abel = access.subjectFor("abel"); // user role, blog focus
  const carlos = access.subjectFor("carlos"); // admin role, SEO side
  const sylvia = access.subjectFor("sylvia"); // admin role, unscoped
  const jerald = access.subjectFor("jerald"); // admin role, on the ads list

  /* ------------------------------------------------------------- the shape */

  await t.test("every capability key is unique and namespaced", () => {
    const keys = access.CAPABILITIES.map((c) => c.key);
    assert.equal(new Set(keys).size, keys.length, "duplicate capability key");
    for (const key of keys) {
      assert.match(key, /^(page|tool)\./, `${key} is not namespaced`);
    }
  });

  await t.test("a page with an href has an icon, and vice versa", () => {
    for (const cap of access.PAGES) {
      assert.equal(
        Boolean(cap.href),
        Boolean(cap.icon),
        `${cap.key} has one of href/icon without the other`
      );
    }
  });

  await t.test("the sunset features are absent, so no toggle can revive them", () => {
    const hrefs = access.PAGES.map((p) => p.href);
    assert.ok(!hrefs.includes("/admin/revenue"));
    assert.ok(!hrefs.includes("/admin/todos"));
  });

  await t.test("Snapshots is gateable but stays off the sidebar", () => {
    // Client Services replaced it in the nav. It must remain gateable, because
    // the page and its API are still live for anyone with a saved link.
    const snap = access.capability("page.snapshot");
    assert.ok(snap, "page.snapshot should exist");
    assert.equal(snap!.href, undefined);
    assert.ok(!access.visiblePages(owner).some((p) => p.key === "page.snapshot"));
    assert.equal(access.allows(jack, "page.snapshot"), true);
  });

  await t.test("the new pages on main are in the registry", () => {
    const hrefs = access.PAGES.map((p) => p.href);
    assert.ok(hrefs.includes("/admin/ads"));
    assert.ok(hrefs.includes("/admin/client-services"));
    assert.ok(hrefs.includes("/admin/social-qa"));
  });

  await t.test("fixed capabilities are not grantable", () => {
    assert.equal(access.isGrantable("page.home"), false);
    assert.equal(access.isGrantable("tool.access"), false);
    assert.equal(access.isGrantable("page.clients"), true);
    assert.equal(access.isGrantable("nope"), false);
  });

  /* ---------------------------------------------------------- the subjects */

  await t.test("the owner is the only null-person subject", () => {
    assert.deepEqual(owner, { role: "admin", person: null, owner: true });
    assert.equal(jack.owner, false);
    assert.equal(jack.role, "forecast");
    assert.equal(carlos.role, "admin", "carlos is on both rosters, admin wins");
  });

  await t.test("the owner is not listed as a manageable account", () => {
    const slugs = access.manageableAccounts().map((a) => a.slug);
    assert.ok(!slugs.includes(OWNER_SLUG));
    assert.ok(slugs.includes("jack"));
    assert.ok(slugs.includes("sylvia"));
    // The people added since this feature was written show up on their own,
    // because the roster is read rather than copied.
    assert.ok(slugs.includes("lana"));
    assert.ok(slugs.includes("saqib"));
    assert.ok(slugs.includes("jerald"));
    // Overlapping slugs appear once, on the admin side.
    assert.equal(slugs.filter((s) => s === "carlos").length, 1);
    assert.equal(
      access.manageableAccounts().find((a) => a.slug === "carlos")?.role,
      "admin"
    );
  });

  /* ---------------------------------------------------------- the defaults */

  await t.test("the owner holds every capability, fixed ones included", () => {
    for (const cap of access.CAPABILITIES) {
      assert.equal(access.allows(owner, cap.key), true, `owner lost ${cap.key}`);
    }
  });

  await t.test("the admin sidebar defaults match what it used to render", () => {
    for (const key of [
      "page.clients",
      "page.lifecycle",
      "page.onboarding",
      "page.reports",
      "page.activity",
    ]) {
      assert.equal(access.allows(sylvia, key), true, `admin lost ${key}`);
      assert.equal(access.allows(jack, key), false, `user gained ${key}`);
    }
  });

  await t.test("the user sidebar defaults match what it used to render", () => {
    for (const key of [
      "page.home",
      "page.forecast",
      "page.whiteboard",
      "page.client_services",
    ]) {
      assert.equal(access.allows(jack, key), true, `user lost ${key}`);
    }
  });

  await t.test("production still follows the explicit list, not the role", () => {
    for (const slug of PRODUCTION_ACCESS) {
      if (slug === OWNER_SLUG) continue;
      assert.equal(
        access.allows(access.subjectFor(slug), "page.production"),
        true,
        `${slug} is on PRODUCTION_ACCESS and should have it`
      );
    }
    // Carlos is an admin on the SEO side and must not see the shoot schedule.
    assert.equal(access.allows(carlos, "page.production"), false);
    assert.equal(access.allows(roy, "page.production"), false);
  });

  await t.test("the calendar is an owner tool, so no admin gets it by default", () => {
    for (const who of [sylvia, carlos, jack, jerald]) {
      assert.equal(access.allows(who, "page.calendar"), false);
      assert.equal(access.allows(who, "tool.calendar_import"), false);
    }
    assert.equal(access.allows(owner, "page.calendar"), true);
  });

  await t.test("Ads follows ADS_DASHBOARD_PEOPLE", () => {
    for (const slug of ADS_DASHBOARD_PEOPLE) {
      assert.equal(
        access.allows(access.subjectFor(slug), "page.ads"),
        true,
        `${slug} is on the ads list and should have it`
      );
    }
    assert.equal(access.allows(sylvia, "page.ads"), false);
    assert.equal(access.allows(jack, "page.ads"), false);
    assert.equal(access.allows(owner, "page.ads"), true);
  });

  await t.test("Social QA follows SOCIAL_QA_PEOPLE", () => {
    for (const slug of SOCIAL_QA_PEOPLE) {
      if (slug === OWNER_SLUG) continue;
      assert.equal(
        access.allows(access.subjectFor(slug), "page.social_qa"),
        true,
        `${slug} is on SOCIAL_QA_PEOPLE and should have it`
      );
    }
    assert.equal(access.allows(roy, "page.social_qa"), false);
    assert.equal(access.allows(carlos, "page.social_qa"), false);
    assert.equal(access.allows(jack, "page.social_qa"), false);
    assert.equal(access.allows(owner, "page.social_qa"), true);
  });

  await t.test("the campaign pages still follow TEAM_FOCUS", () => {
    // Roy's focus is empty: no campaigns.
    assert.equal(access.allows(roy, "page.campaigns"), false);
    // Abel is user-role but blog-focused, so he keeps campaigns.
    assert.equal(access.allows(abel, "page.campaigns"), true);
    // An unfocused user is not given the campaigns page by default.
    assert.equal(access.allows(jack, "page.campaigns"), false);
    // An unscoped admin gets it.
    assert.equal(access.allows(sylvia, "page.campaigns"), true);
  });

  await t.test("editing tools stay on admin, and the escalating two on nobody", () => {
    for (const key of ["tool.campaign_edit", "tool.ai_revise", "tool.client_edit"]) {
      assert.equal(access.allows(sylvia, key), true, `admin lost ${key}`);
      assert.equal(access.allows(jack, key), false, `user gained ${key}`);
    }
    for (const who of [sylvia, jack, carlos]) {
      assert.equal(access.allows(who, "tool.impersonate"), false);
      assert.equal(access.allows(who, "tool.accounts"), false);
      assert.equal(access.allows(who, "tool.access"), false);
    }
  });

  await t.test("an unknown capability is refused rather than assumed", () => {
    assert.equal(access.allows(jack, "page.nonexistent"), false);
    assert.equal(access.defaultAllowed("tool.made_up", sylvia), false);
  });

  await t.test("impersonating follows the person being viewed", () => {
    // hasOwnerToolsAccess and hasAdsDashboardAccess both refuse an owner who is
    // viewing as somebody else, so "view as Cassidy" shows Cassidy's app.
    const asCassidy = { role: "admin" as const, person: "cassidy", owner: false, impersonating: true };
    assert.equal(access.defaultAllowed("page.calendar", asCassidy), false);
    assert.equal(access.defaultAllowed("page.ads", asCassidy), false);
    const asJerald = { role: "admin" as const, person: "jerald", owner: false, impersonating: true };
    assert.equal(access.defaultAllowed("page.ads", asJerald), true);
  });

  /* --------------------------------------------------------- the overrides */

  await t.test("an override beats a permissive default", () => {
    assert.equal(access.allows(sylvia, "page.reports"), true);
    access.setOverride("sylvia", "page.reports", false, "michael");
    assert.equal(access.allows(sylvia, "page.reports"), false);
  });

  await t.test("an override beats a restrictive default", () => {
    assert.equal(access.allows(jack, "page.clients"), false);
    access.setOverride("jack", "page.clients", true, "michael");
    assert.equal(access.allows(jack, "page.clients"), true);
  });

  await t.test("the owner tools can be granted to somebody else", () => {
    access.setOverride("sylvia", "page.calendar", true, "michael");
    assert.equal(access.allows(sylvia, "page.calendar"), true);
    // The import is its own switch, so granting the page does not grant it.
    assert.equal(access.allows(sylvia, "tool.calendar_import"), false);
  });

  await t.test("clearing one override goes back to the default, not to off", () => {
    access.setOverride("sylvia", "page.reports", null, "michael");
    assert.equal(access.allows(sylvia, "page.reports"), true);
  });

  await t.test("resolveAll reports where each answer came from", () => {
    const rows = access.resolveAll(jack);
    const clients = rows.find((r) => r.key === "page.clients")!;
    assert.equal(clients.allowed, true);
    assert.equal(clients.byDefault, false);
    assert.equal(clients.overridden, true);

    const hub = rows.find((r) => r.key === "page.home")!;
    assert.equal(hub.allowed, true);
    assert.equal(hub.overridden, false);
  });

  await t.test("the fixed capabilities cannot be written, even directly", () => {
    assert.throws(() => access.setOverride("jack", "page.home", false, "michael"));
    assert.throws(() => access.setOverride("jack", "tool.access", true, "michael"));
    assert.equal(access.allows(jack, "page.home"), true);
  });

  await t.test("the owner's own access cannot be edited away", () => {
    assert.throws(() => access.setOverride(OWNER_SLUG, "page.clients", false, "michael"));
    assert.throws(() => access.setForecastSubjects(OWNER_SLUG, [], "michael"));
    assert.equal(access.allows(owner, "page.clients"), true);
  });

  await t.test("visiblePages is the sidebar, in registry order", () => {
    const pages = access.visiblePages(roy).map((p) => p.href);
    assert.deepEqual(pages.slice(0, 2), ["/admin/hub", "/admin/forecast"]);
    assert.ok(!pages.includes("/admin/campaigns"), "roy does no campaign work");
    assert.ok(!pages.includes("/admin/production"));
    assert.ok(!pages.includes("/admin/calendar"), "the calendar is owner-only");
    assert.ok(!pages.includes("/admin/social-qa"), "roy is not on the social QA list");
    assert.ok(pages.includes("/admin/whiteboard"));
    assert.ok(pages.includes("/admin/client-services"));
    assert.ok(!pages.includes("/admin"), "old dashboard is no longer a nav item");

    // Every page with an href, and nothing without one.
    const ownerPages = access.visiblePages(owner).map((p) => p.href);
    assert.equal(ownerPages.length, access.PAGES.filter((p) => p.href).length);
  });

  await t.test("a reset drops every override for that person", () => {
    access.setOverride("jack", "page.lifecycle", true, "michael");
    access.clearOverrides("jack");
    assert.equal(access.allows(jack, "page.clients"), false);
    assert.equal(access.allows(jack, "page.lifecycle"), false);
    assert.equal(access.resolveAll(jack).filter((r) => r.overridden).length, 0);
    access.clearOverrides("sylvia");
  });

  /* ----------------------------------------------------- forecast visibility */

  await t.test("the defaults are every person for an admin, own week for a user", () => {
    assert.equal(access.forecastVisibility(owner), access.FORECAST_ALL);
    assert.equal(access.forecastVisibility(sylvia), access.FORECAST_ALL);
    assert.deepEqual(access.forecastVisibility(jack), ["jack"]);
    assert.equal(access.canSeeForecastOf(jack, "jack"), true);
    assert.equal(access.canSeeForecastOf(jack, "paula"), false);
    assert.equal(access.canSeeForecastOf(sylvia, "paula"), true);
  });

  await t.test("a named set replaces the default and always keeps their own week", () => {
    access.setForecastSubjects("jack", ["paula", "randi"], "michael");
    assert.deepEqual(
      [...(access.forecastVisibility(jack) as string[])].sort(),
      ["jack", "paula", "randi"]
    );
    assert.equal(access.canSeeForecastOf(jack, "abel"), false);
  });

  await t.test("a named set can narrow an admin too", () => {
    access.setForecastSubjects("sylvia", ["jack"], "michael");
    assert.deepEqual(
      [...(access.forecastVisibility(sylvia) as string[])].sort(),
      ["jack", "sylvia"]
    );
    assert.equal(access.canSeeForecastOf(sylvia, "paula"), false);
  });

  await t.test("an empty set still leaves them their own week", () => {
    access.setForecastSubjects("jack", [], "michael");
    assert.deepEqual(access.forecastVisibility(jack), ["jack"]);
  });

  await t.test("the everyone marker beats any named subject alongside it", () => {
    access.setForecastSubjects("jack", ["paula", access.FORECAST_ALL], "michael");
    assert.equal(access.forecastVisibility(jack), access.FORECAST_ALL);
    assert.equal(access.canSeeForecastOf(jack, "abel"), true);
  });

  await t.test("a subject who is not a real person is dropped on write", () => {
    access.setForecastSubjects("jack", ["paula", "not-a-person"], "michael");
    const visible = access.forecastVisibility(jack) as string[];
    assert.ok(visible.includes("paula"));
    assert.ok(!visible.includes("not-a-person"));
  });

  await t.test("clearing forecast access goes back to the role default", () => {
    access.clearForecastSubjects("jack");
    assert.deepEqual(access.forecastVisibility(jack), ["jack"]);
    access.clearForecastSubjects("sylvia");
    assert.equal(access.forecastVisibility(sylvia), access.FORECAST_ALL);
  });

  await t.test("granting tool.forecast_all widens a user with no named set", () => {
    access.setOverride("jack", "tool.forecast_all", true, "michael");
    assert.equal(access.forecastVisibility(jack), access.FORECAST_ALL);
    // A named set is more specific and still wins over the blanket grant.
    access.setForecastSubjects("jack", ["paula"], "michael");
    assert.deepEqual(
      [...(access.forecastVisibility(jack) as string[])].sort(),
      ["jack", "paula"]
    );
    access.clearOverrides("jack");
    access.clearForecastSubjects("jack");
  });

  await t.test("a signed out subject sees nothing", () => {
    const nobody = { role: "forecast" as const, person: null, owner: false };
    assert.equal(access.allows(nobody, "page.home"), false);
    assert.deepEqual(access.forecastVisibility(nobody), []);
  });

  await t.test("the forecast roster is the people roster", () => {
    const roster = access.forecastRoster().map((p) => p.slug);
    assert.ok(roster.includes("jack"));
    assert.ok(roster.includes("lana"));
    assert.ok(roster.every((s) => typeof s === "string" && s.length > 0));
  });

  /* ------------------------------------------------------- campaign kinds */

  await t.test("campaign kind defaults follow TEAM_FOCUS", () => {
    assert.equal(access.campaignKindStored("roy"), null);
    assert.equal(access.effectiveCampaignKind(roy), null);
    assert.equal(access.effectiveCampaignKind(abel), "blog");
    assert.equal(access.effectiveCampaignKind(jack), null);
    assert.equal(access.effectiveCampaignKind(owner), null);
  });

  await t.test("the owner can pin Roy to forms and quizzes only", () => {
    access.setCampaignKind("roy", "interactive", "michael");
    assert.equal(access.campaignKindStored("roy"), "interactive");
    assert.equal(access.effectiveCampaignKind(roy), "interactive");
    // The page is still off until they Allow Campaigns; kind only filters.
    assert.equal(access.allows(roy, "page.campaigns"), false);
    access.setOverride("roy", "page.campaigns", true, "michael");
    assert.equal(access.allows(roy, "page.campaigns"), true);
    access.clearOverrides("roy");
    access.clearCampaignKind("roy");
  });

  await t.test("all clears a blog default, and clear goes back to it", () => {
    assert.equal(access.effectiveCampaignKind(abel), "blog");
    access.setCampaignKind("abel", "all", "michael");
    assert.equal(access.effectiveCampaignKind(abel), null);
    access.clearCampaignKind("abel");
    assert.equal(access.effectiveCampaignKind(abel), "blog");
  });

  await t.test("an unknown campaign kind is refused on write", () => {
    assert.throws(
      () => access.setCampaignKind("roy", "email" as "blog", "michael"),
      /Unknown campaign kind/
    );
  });
});
