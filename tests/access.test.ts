import assert from "node:assert/strict";
import test from "node:test";
import {
  PEOPLE,
  PRODUCTION_ACCESS,
  SEO_ONLY_PEOPLE,
  hasProductionAccess,
  isSeoOnly,
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
  for (const slug of SEO_ONLY_PEOPLE) {
    assert.equal(
      hasProductionAccess(slug),
      false,
      `${slug} is SEO-only and should not have production`
    );
  }
});
