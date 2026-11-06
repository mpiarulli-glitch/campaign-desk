import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ADMIN_PEOPLE } from "../src/lib/admin-people";
import { fridayAskReturnHref, teamSnapshotHref } from "../src/lib/friday-ask-nav";
import {
  FRIDAY_ASK_PEOPLE,
  OWNER_SLUG,
  SNAPSHOT_ACCOUNT_MANAGERS,
  basecampNameForManager,
  canSeeFridayAsk,
  canSendFridaySnapshot,
  isSnapshotAccountManager,
  personLabel,
  personTeam,
} from "../src/lib/people";
import { parseWeekStart } from "../src/lib/week";

// Existing logins. Morris Kyle is kyle_morris. Kyle Onstott is a different admin.
const SENDERS = ["kyle_morris", "cassidy", "luis_romero", "jerald"] as const;
const OTHER_ADMINS = ["kyle_onstott", "sylvia", "carlos"] as const;
const FORECAST_USERS = ["jack", "roy", "abel"] as const;

test("Friday senders are existing roster identities, not new accounts", () => {
  assert.equal(basecampNameForManager("Kyle"), "Morris Kyle");
  assert.notEqual(basecampNameForManager("Kyle"), "Kyle Onstott");
  assert.equal(basecampNameForManager("Cassidy"), "Cassidy Merideth");
  assert.equal(basecampNameForManager("Luis"), "Luis Romero");

  assert.equal(personLabel("kyle_morris"), "Kyle Morris");
  assert.equal(personLabel("cassidy"), "Cassidy");
  assert.equal(personLabel("luis_romero"), "Luis Romero");
  assert.equal(personLabel("jerald"), "Jerald");
  assert.equal(
    ADMIN_PEOPLE.find((p) => p.slug === "kyle_onstott")?.label,
    "Kyle Onstott"
  );

  for (const slug of SENDERS) {
    assert.ok(
      ADMIN_PEOPLE.some((p) => p.slug === slug),
      `${slug} is an existing admin login`
    );
  }

  // Team and snapshot-fill scope stay as they were. Luis is onboarding, not
  // pulled onto the client-services specialist list. Jerald stays unassigned.
  assert.equal(personTeam("kyle_morris"), "client_services");
  assert.equal(personTeam("cassidy"), "client_services");
  assert.equal(personTeam("luis_romero"), "onboarding");
  assert.equal(personTeam("jerald"), null);
  assert.deepEqual([...SNAPSHOT_ACCOUNT_MANAGERS], ["cassidy", "kyle_morris"]);
  assert.equal(isSnapshotAccountManager("luis_romero"), false);
  assert.equal(isSnapshotAccountManager("jerald"), false);
  assert.equal(isSnapshotAccountManager("kyle_onstott"), false);
});

test("the Friday ask allowlist is Michael, Morris, Cassidy, Luis, and Jerald", () => {
  assert.deepEqual(
    [...FRIDAY_ASK_PEOPLE].sort(),
    ["cassidy", "jerald", "kyle_morris", "luis_romero", OWNER_SLUG].sort()
  );
  assert.equal(
    (FRIDAY_ASK_PEOPLE as readonly string[]).includes("kyle_onstott"),
    false
  );

  assert.equal(canSeeFridayAsk({ person: null, owner: true }), true);
  assert.equal(canSeeFridayAsk({ person: OWNER_SLUG, owner: false }), true);
  for (const slug of SENDERS) {
    assert.equal(canSeeFridayAsk({ person: slug, owner: false }), true, slug);
  }

  for (const slug of [...OTHER_ADMINS, ...FORECAST_USERS]) {
    assert.equal(canSeeFridayAsk({ person: slug, owner: false }), false, slug);
  }
  assert.equal(canSeeFridayAsk({ person: null, owner: false }), false);
  assert.equal(canSeeFridayAsk({ person: "", owner: false }), false);
});

test("Cassidy's Friday tab is her login slug, not the account-owner label", () => {
  // The session cookie stores slug cassidy. The client field stores "Cassidy".
  // A display name must not open the tab, and the slug must.
  assert.equal(personLabel("cassidy"), "Cassidy");
  assert.equal(canSeeFridayAsk({ person: "cassidy", owner: false }), true);
  assert.equal(canSeeFridayAsk({ person: "Cassidy", owner: false }), false);
  assert.equal(canSeeFridayAsk({ person: "Cassidy Merideth", owner: false }), false);
  assert.equal((FRIDAY_ASK_PEOPLE as readonly string[]).includes("Cassidy"), false);
  assert.equal(
    canSendFridaySnapshot({ role: "admin", person: "cassidy", owner: false }, true),
    true
  );
  assert.equal(
    canSendFridaySnapshot({ role: "forecast", person: "cassidy", owner: false }, true),
    false
  );
  assert.equal(
    canSendFridaySnapshot({ role: "admin", person: "Cassidy", owner: false }, true),
    false
  );

  const page = fs.readFileSync(
    new URL("../src/app/admin/client-services/page.tsx", import.meta.url),
    "utf8"
  );
  assert.match(page, /setPerson\(data\.person \|\| null\)/);
  assert.match(page, /const fridayAsk = canSeeFridayAsk\(\{ person, owner \}\)/);
  assert.match(page, /teamSnapshotHref\(row\.clientId, summary\?\.weekStart \|\| ""\)/);
  assert.doesNotMatch(page, /href=\{`\/snapshot\//);
});

test("manual send authorization matches the Friday button", () => {
  const admin = (person: string | null, owner = false) => ({
    role: "admin" as const,
    person,
    owner,
  });

  assert.equal(canSendFridaySnapshot(admin(null, true), true), true);
  for (const slug of SENDERS) {
    assert.equal(canSendFridaySnapshot(admin(slug), true), true, slug);
    assert.equal(
      canSendFridaySnapshot(admin(slug), false),
      false,
      `${slug} loses send when Weekly Snapshots is revoked`
    );
  }

  for (const slug of OTHER_ADMINS) {
    assert.equal(
      canSendFridaySnapshot(admin(slug), true),
      false,
      `${slug} is an admin and still cannot send`
    );
  }

  assert.equal(
    canSendFridaySnapshot({ role: "forecast", person: "cassidy", owner: false }, true),
    false
  );
  assert.equal(
    canSendFridaySnapshot({ role: "forecast", person: "jack", owner: false }, true),
    false
  );
  assert.equal(canSendFridaySnapshot(null, true), false);
  assert.equal(canSendFridaySnapshot(admin("cassidy"), false), false);

  // View-as keeps the impersonated person. Owner flag is off in that session.
  assert.equal(canSendFridaySnapshot(admin("cassidy"), true), true);
  assert.equal(canSendFridaySnapshot(admin("kyle_morris"), true), true);
  assert.equal(canSendFridaySnapshot(admin("luis_romero"), true), true);
  assert.equal(canSendFridaySnapshot(admin("jerald"), true), true);
  assert.equal(canSendFridaySnapshot(admin("kyle_onstott"), true), false);
});

test("the Friday tab and the send route share that decision", () => {
  const page = fs.readFileSync(
    new URL("../src/app/admin/client-services/page.tsx", import.meta.url),
    "utf8"
  );
  const route = fs.readFileSync(
    new URL("../src/app/api/client-services/route.ts", import.meta.url),
    "utf8"
  );
  const layout = fs.readFileSync(
    new URL("../src/app/admin/client-services/layout.tsx", import.meta.url),
    "utf8"
  );

  assert.match(page, /const fridayAsk = canSeeFridayAsk\(\{ person, owner \}\)/);
  assert.match(page, /const canSendSnapshot = fridayAsk && isAdmin/);
  assert.match(page, /\{fridayAsk \? \(/);
  assert.match(page, /Friday ask/);
  assert.match(page, /\{canSendSnapshot \? \(/);
  assert.match(page, /Send now/);
  assert.match(page, /isAdmin=\{canSendSnapshot\}/);
  assert.match(layout, /requirePage\("page\.client_services_hub"\)/);

  const sendAt = route.indexOf('if (action === "send")');
  const deliverAt = route.indexOf("sendWeeklyAsk(");
  const calls = [...route.matchAll(/canSendFridaySnapshot\(/g)];
  assert.equal(calls.length, 1);
  assert.ok(sendAt > 0 && deliverAt > sendAt);
  assert.ok(calls[0].index! > sendAt && calls[0].index! < deliverAt);

  const pauseAt = route.indexOf('action === "pause"');
  assert.ok(pauseAt > 0 && pauseAt < sendAt);
  assert.equal(route.slice(0, sendAt).includes("canSendFridaySnapshot("), false);

  const account = fs.readFileSync(
    new URL("../src/app/admin/snapshot/[id]/page.tsx", import.meta.url),
    "utf8"
  );
  const wins = fs.readFileSync(
    new URL("../src/components/SnapshotDeskAccountViews.tsx", import.meta.url),
    "utf8"
  );
  assert.match(account, /parseWeekStart\(searchParams\.get\("week"\)\)/);
  assert.match(account, /fridayAskReturnHref\(\)/);
  assert.match(account, /onRemoved=/);
  assert.match(wins, /Delete this win\?/);
  assert.match(wins, /No wins logged for this week/);
  assert.match(wins, /method: "DELETE"/);
});

test("a Friday client name opens only that client's team snapshot week", () => {
  const href = teamSnapshotHref("client-cassidy", "2026-11-04");
  assert.equal(href, "/admin/snapshot/client-cassidy?week=2026-11-02&from=friday");
  assert.equal(href.includes("other-client"), false);
  assert.equal(href.startsWith("/snapshot/"), false);
  assert.equal(parseWeekStart("2026-11-02"), "2026-11-02");
  assert.equal(parseWeekStart("not-a-date"), null);
  assert.equal(fridayAskReturnHref(), "/admin/client-services?tab=friday");
  const other = teamSnapshotHref("top-notch", "2026-11-02");
  assert.equal(other.includes("client-cassidy"), false);
  assert.match(other, /^\/admin\/snapshot\/top-notch\?/);
});

test("navigation and capability overrides stay scoped", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-friday-ask-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const access = await import("../src/lib/access");
  const { closeDbForTests } = await import("../src/lib/db");
  t.after(() => closeDbForTests());

  const owner = access.subjectFor(OWNER_SLUG);
  assert.equal(owner.owner, true);
  assert.equal(owner.role, "admin");
  assert.equal(canSendFridaySnapshot(owner, access.allows(owner, "page.client_services")), true);
  assert.ok(access.visiblePages(owner).some((p) => p.href === "/admin/client-services"));

  for (const slug of SENDERS) {
    const who = access.subjectFor(slug);
    assert.equal(who.role, "admin", slug);
    assert.equal(who.owner, false, slug);
    assert.equal(access.allows(who, "page.client_services_hub"), true, slug);
    assert.equal(access.allows(who, "page.client_services"), true, slug);
    assert.ok(
      access.visiblePages(who).some((p) => p.href === "/admin/client-services"),
      `${slug} sees Client Services in the sidebar`
    );
    assert.equal(
      canSendFridaySnapshot(who, access.allows(who, "page.client_services")),
      true,
      slug
    );
  }

  for (const slug of OTHER_ADMINS) {
    const who = access.subjectFor(slug);
    assert.equal(who.role, "admin", slug);
    assert.equal(access.allows(who, "page.client_services_hub"), true, `${slug} keeps the hub`);
    assert.equal(access.allows(who, "page.clients"), true, `${slug} keeps admin pages`);
    assert.ok(
      access.visiblePages(who).some((p) => p.href === "/admin/client-services"),
      `${slug} still has the Client Services link`
    );
    assert.equal(
      canSendFridaySnapshot(who, access.allows(who, "page.client_services")),
      false,
      slug
    );
  }

  for (const slug of FORECAST_USERS) {
    const who = access.subjectFor(slug);
    assert.equal(who.role, "forecast", slug);
    assert.equal(access.allows(who, "page.client_services_hub"), false, slug);
    assert.ok(!access.visiblePages(who).some((p) => p.href === "/admin/client-services"));
    assert.equal(
      canSendFridaySnapshot(who, access.allows(who, "page.client_services")),
      false,
      slug
    );
  }

  access.setOverride("cassidy", "page.client_services", false, "michael");
  const cassidy = access.subjectFor("cassidy");
  assert.equal(access.allows(cassidy, "page.client_services_hub"), true);
  assert.equal(
    canSendFridaySnapshot(cassidy, access.allows(cassidy, "page.client_services")),
    false
  );

  access.setOverride("jack", "page.client_services_hub", true, "michael");
  access.setOverride("jack", "page.client_services", true, "michael");
  const jack = access.subjectFor("jack");
  assert.equal(access.allows(jack, "page.client_services_hub"), true);
  assert.equal(canSeeFridayAsk({ person: "jack", owner: false }), false);
  assert.equal(
    canSendFridaySnapshot(jack, access.allows(jack, "page.client_services")),
    false
  );
});
