import assert from "node:assert/strict";
import test from "node:test";
import {
  amSortKey,
  deliverableVisibleTo,
  fillCanSeeAll,
  fillCounts,
  fillFocusTeam,
  fillIsAccountManager,
  fillLane,
  fillPassSummary,
  fillPeriodHint,
  filterFillRows,
  inferDeliverableOwnership,
  sortFillRows,
  visibleFillRows,
} from "../src/lib/snapshot-fill";

test("inferDeliverableOwnership reads the stored team first", () => {
  assert.equal(
    inferDeliverableOwnership({ team: "seo", category: "Email", name: "Broadcasts" }),
    "seo"
  );
});

test("untagged rows are classified from category and name", () => {
  assert.equal(
    inferDeliverableOwnership({ team: "", category: "Email", name: "Broadcast emails" }),
    "email"
  );
  assert.equal(
    inferDeliverableOwnership({ team: "", category: "Lifecycle", name: "Welcome automation" }),
    "email"
  );
  assert.equal(
    inferDeliverableOwnership({ team: "", category: "", name: "Cold email sequences" }),
    "email"
  );
  assert.equal(
    inferDeliverableOwnership({ team: "", category: "CRM", name: "GoHighLevel automations" }),
    "email"
  );
  assert.equal(
    inferDeliverableOwnership({ team: "", category: "SMS", name: "Appointment reminders" }),
    "email"
  );
  assert.equal(
    inferDeliverableOwnership({ team: "", category: "SEO", name: "Blog posts" }),
    "seo"
  );
  assert.equal(
    inferDeliverableOwnership({ team: "", category: "Social", name: "Instagram and TikTok" }),
    "social"
  );
  assert.equal(
    inferDeliverableOwnership({ team: "", category: "Production", name: "Monthly video shoot" }),
    "social"
  );
  assert.equal(
    inferDeliverableOwnership({ team: "", category: "Onboarding", name: "Kickoff call" }),
    "onboarding"
  );
  assert.equal(
    inferDeliverableOwnership({ team: "", category: "Web", name: "Landing page updates" }),
    "web"
  );
  assert.equal(
    inferDeliverableOwnership({ team: "", category: "Strategy", name: "Quarterly review" }),
    "strategy"
  );
  assert.equal(
    inferDeliverableOwnership({ team: "", category: "Reporting", name: "Performance review" }),
    "strategy"
  );
});

test("LinkedIn outreach is email work, LinkedIn posts are social", () => {
  assert.equal(
    inferDeliverableOwnership({ team: "", category: "", name: "LinkedIn outreach" }),
    "email"
  );
  assert.equal(
    inferDeliverableOwnership({ team: "", category: "LinkedIn", name: "Connection requests" }),
    "email"
  );
  assert.equal(
    inferDeliverableOwnership({ team: "", category: "Social", name: "LinkedIn posts" }),
    "social"
  );
});

test("specialists only see their own work, inferred or tagged", () => {
  const blog = { team: "", category: "SEO", name: "Blog posts" };
  const social = { team: "", category: "Social", name: "Instagram posts" };
  const email = { team: "email", category: "Email", name: "Broadcasts" };
  const strategy = { team: "", category: "Strategy", name: "Quarterly review" };
  const mystery = { team: "", category: "Ops", name: "Mystery task" };

  assert.equal(deliverableVisibleTo(blog, "seo"), true);
  assert.equal(deliverableVisibleTo(blog, "social"), false);
  assert.equal(deliverableVisibleTo(social, "social"), true);
  assert.equal(deliverableVisibleTo(social, "email"), false);
  assert.equal(deliverableVisibleTo(email, "email"), true);
  assert.equal(deliverableVisibleTo(email, "seo"), false);
  assert.equal(deliverableVisibleTo(strategy, "seo"), false);
  assert.equal(deliverableVisibleTo(strategy, "email"), false);
  const onboard = { team: "", category: "Onboarding", name: "Kickoff call" };
  assert.equal(deliverableVisibleTo(onboard, "onboarding"), true);
  assert.equal(deliverableVisibleTo(onboard, "email"), false);
  assert.equal(deliverableVisibleTo(mystery, "social"), false);
  assert.equal(deliverableVisibleTo(blog, null), true);
  assert.equal(deliverableVisibleTo(strategy, null), true);
  assert.equal(deliverableVisibleTo(mystery, null), true);
});

test("account managers see strategy first, then mysteries, then specialist work", () => {
  const rows = [
    { team: "email", category: "Email", name: "Broadcasts" },
    { team: "", category: "Ops", name: "Mystery task" },
    { team: "", category: "Strategy", name: "Quarterly review" },
    { team: "seo", category: "SEO", name: "Blog posts" },
  ];
  assert.deepEqual(
    sortFillRows(rows, true).map((r) => r.name),
    ["Quarterly review", "Mystery task", "Broadcasts", "Blog posts"]
  );
  assert.equal(amSortKey(rows[2]), 0);
  assert.equal(amSortKey(rows[1]), 1);
  assert.equal(amSortKey(rows[0]), 2);
  // Owner See-all and specialists keep input order.
  assert.deepEqual(
    sortFillRows(rows, false).map((r) => r.name),
    rows.map((r) => r.name)
  );
});

test("visibleFillRows combines specialist filter and AM sort", () => {
  const rows = [
    { team: "email", category: "Email", name: "Broadcasts" },
    { team: "", category: "Strategy", name: "Account planning" },
    { team: "", category: "Social", name: "Reels" },
  ];
  assert.deepEqual(
    visibleFillRows(rows, "social").map((r) => r.name),
    ["Reels"]
  );
  assert.deepEqual(
    visibleFillRows(rows, "email").map((r) => r.name),
    ["Broadcasts"]
  );
  assert.deepEqual(
    visibleFillRows(rows, null, { accountManager: true }).map((r) => r.name),
    ["Account planning", "Broadcasts", "Reels"]
  );
});

test("the stated roster drives focus, AM sort, and See all", () => {
  const owner = { role: "admin" as const, person: null, owner: true };
  const michael = { role: "admin" as const, person: "michael", owner: false };
  const abel = { role: "forecast" as const, person: "abel", owner: false };
  const lana = { role: "forecast" as const, person: "lana", owner: false };
  const roy = { role: "forecast" as const, person: "roy", owner: false };
  const cassidy = { role: "admin" as const, person: "cassidy", owner: false };
  const kyle = { role: "admin" as const, person: "kyle_morris", owner: false };
  const carlos = { role: "admin" as const, person: "carlos", owner: false };
  const randi = { role: "forecast" as const, person: "randi", owner: false };
  const saqib = { role: "forecast" as const, person: "saqib", owner: false };
  const luis = { role: "admin" as const, person: "luis_romero", owner: false };
  const jack = { role: "forecast" as const, person: "jack", owner: false };

  assert.equal(fillFocusTeam(owner), "email");
  assert.equal(fillIsAccountManager(owner), false);
  assert.equal(fillCanSeeAll(owner), true);
  assert.equal(fillFocusTeam(michael), "email");
  assert.equal(fillCanSeeAll(michael), true);
  assert.equal(fillFocusTeam(abel), "seo");
  assert.equal(fillCanSeeAll(abel), false);
  assert.equal(fillFocusTeam(lana), "social");
  assert.equal(fillFocusTeam(roy), "web");

  assert.equal(fillFocusTeam(cassidy), null);
  assert.equal(fillIsAccountManager(cassidy), true);
  assert.equal(fillCanSeeAll(cassidy), false);

  assert.equal(fillFocusTeam(kyle), null);
  assert.equal(fillIsAccountManager(kyle), true);

  assert.equal(fillFocusTeam(carlos), "seo");
  assert.equal(fillIsAccountManager(carlos), false);
  assert.equal(fillCanSeeAll(carlos), true);

  assert.equal(fillFocusTeam(randi), "social");
  assert.equal(fillCanSeeAll(randi), false);

  assert.equal(fillFocusTeam(saqib), "web");
  assert.equal(fillFocusTeam(luis), "onboarding");
  assert.equal(fillCanSeeAll(luis), true);

  assert.equal(fillFocusTeam(jack), null);
  assert.equal(fillIsAccountManager(jack), false);
});

test("fill counts and the weekly pass copy", () => {
  const rows = [
    { deliverable_id: "a", status: "not_started" as const },
    { deliverable_id: "b", status: "in_progress" as const },
    { deliverable_id: "c", status: "completed" as const },
    { deliverable_id: "d", status: "shared" as const },
  ];
  const overdue = new Set(["a"]);
  const counts = fillCounts(rows, overdue);
  assert.equal(counts.overdue, 1);
  assert.equal(counts.todo, 1);
  assert.equal(counts.done, 2);
  assert.equal(counts.attention, 2);
  assert.equal(fillLane(rows[0], overdue), "overdue");
  assert.equal(fillPassSummary(counts, true), "1 overdue · 1 still needs an update");
  assert.deepEqual(
    filterFillRows(rows, "todo", overdue).map((r) => r.deliverable_id),
    ["a", "b"]
  );
  assert.equal(
    fillPassSummary({ total: 3, overdue: 0, todo: 0, done: 3, attention: 0 }, true),
    "Clear — all 3 deliverables are logged for this period."
  );
});

test("period hint names the cadence without repeating the week nav", () => {
  assert.equal(
    fillPeriodHint({
      kind: "recurring",
      cadence_unit: "monthly",
      cadence: "2x/mo",
      period_start: "2026-08-01",
    }),
    "August 2026 · 2x/mo"
  );
  assert.equal(
    fillPeriodHint({
      kind: "recurring",
      cadence_unit: "quarterly",
      cadence: "",
      period_start: "2026-07-01",
    }),
    "Q3 2026"
  );
  assert.equal(
    fillPeriodHint({
      kind: "one_time",
      cadence_unit: "weekly",
      cadence: "",
      period_start: "",
      due_date: "2026-09-15",
    }),
    "One-time · due Sep 15"
  );
});
