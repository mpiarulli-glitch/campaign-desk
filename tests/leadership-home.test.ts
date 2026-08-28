import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "path";
import { isValidPerson, usesLeadershipHome } from "../src/lib/people";
import { weekSummaryForAllPeople } from "../src/lib/forecast";
import { currentWeek } from "../src/lib/week";

test("Sylvia has a forecast roster slot like everyone else", () => {
  assert.equal(isValidPerson("sylvia"), true);
  const week = weekSummaryForAllPeople(currentWeek());
  assert.ok(
    week.some((p) => p.person === "sylvia"),
    "Sylvia should appear in the all-team forecast"
  );
});

test("Luis Romero has a forecast roster slot", () => {
  assert.equal(isValidPerson("luis_romero"), true);
  const week = weekSummaryForAllPeople(currentWeek());
  assert.ok(
    week.some((p) => p.person === "luis_romero"),
    "Luis should appear in the all-team forecast"
  );
});

test("Saqib and Jerald have forecast roster slots", () => {
  assert.equal(isValidPerson("saqib"), true);
  assert.equal(isValidPerson("jerald"), true);
  const week = weekSummaryForAllPeople(currentWeek());
  assert.ok(week.some((p) => p.person === "saqib"), "Saqib should appear in the all-team forecast");
  assert.ok(week.some((p) => p.person === "jerald"), "Jerald should appear in the all-team forecast");
});

test("the admin home routes leadership slugs to LeadershipHome", () => {
  const src = fs.readFileSync(
    path.join("src/app/admin/page.tsx"),
    "utf8"
  );
  assert.match(src, /usesLeadershipHome/);
  assert.match(src, /LeadershipHome/);
  assert.match(src, /AssignTodoPanel/);
  assert.equal(usesLeadershipHome("sylvia"), true);
  assert.equal(usesLeadershipHome("kyle_onstott"), true);
  assert.equal(usesLeadershipHome("luis_romero"), true);
  assert.equal(usesLeadershipHome("kyle_morris"), true);
});
