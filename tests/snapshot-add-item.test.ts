import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  pickerTodosForDepartment,
  snapshotHitsForPicker,
} from "../src/lib/snapshot-basecamp-suggestions";

test("picker rows use the list name for the department and the start date for status", () => {
  const hits = snapshotHitsForPicker(
    [
      {
        id: "42",
        title: "Move the mystery discount",
        list: "To Dos › Email / SMS / LinkedIn / Automations",
        completedAt: null,
        startsOn: null,
      },
      {
        id: "8",
        title: "Film the testimonial",
        list: "Onboarding Checklist › General",
        completedAt: null,
        startsOn: "2026-11-20",
      },
      {
        id: "7",
        title: "Launch the retargeting set",
        list: "To Dos › Meta Ads",
        completedAt: "2026-11-04T18:00:00Z",
      },
    ],
    "2026-11-06"
  );

  assert.equal(hits[0]?.department, "lifecycle");
  assert.equal(hits[0]?.status, "in_progress");
  assert.equal(hits[0]?.sourceKey, "todo:42");
  assert.equal(hits[0]?.place, "Email / SMS / LinkedIn / Automations");

  assert.equal(hits[1]?.department, "unsorted");
  assert.equal(hits[1]?.status, "scheduled");
  assert.equal(hits[1]?.place, "General");

  assert.equal(hits[2]?.department, "ads");
  assert.equal(hits[2]?.status, "completed");
});

test("a department add row offers its own lists and asks before an unmatched one", () => {
  const hits = snapshotHitsForPicker(
    [
      {
        id: "42",
        title: "Move the mystery discount",
        list: "Email / SMS",
      },
      {
        id: "8",
        title: "Film the testimonial",
        list: "General",
        startsOn: "2026-11-20",
      },
      {
        id: "7",
        title: "Launch the retargeting set",
        list: "Meta Ads",
        completedAt: "2026-11-04",
      },
    ],
    "2026-11-06"
  );

  const lifecycle = pickerTodosForDepartment(hits, "lifecycle", []);
  assert.deepEqual(
    lifecycle.matched.map((todo) => todo.title),
    ["Move the mystery discount"]
  );
  assert.deepEqual(
    lifecycle.unmatched.map((todo) => todo.title),
    ["Film the testimonial"]
  );

  const taken = pickerTodosForDepartment(hits, "lifecycle", ["todo:42"]);
  assert.equal(taken.matched.length, 0);
  assert.equal(taken.unmatched.length, 1);

  const ads = pickerTodosForDepartment(hits, "ads", []);
  assert.deepEqual(
    ads.matched.map((todo) => todo.sourceKey),
    ["todo:7"]
  );
  assert.equal(ads.matched[0]?.status, "completed");
});

test("the fill page adds from Basecamp or by typing, without a project search bar", () => {
  const week = fs.readFileSync(
    new URL("../src/components/SnapshotWeekDepartments.tsx", import.meta.url),
    "utf8"
  );
  const add = fs.readFileSync(
    new URL("../src/components/SnapshotDepartmentAdd.tsx", import.meta.url),
    "utf8"
  );
  const src = `${week}\n${add}`;
  assert.match(src, /Type it instead/);
  assert.match(src, /Pick a todo instead/);
  assert.match(src, /Refresh Basecamp/);
  assert.match(src, /Pick a department/);
  assert.doesNotMatch(src, /Search this project's to-dos/);
  assert.doesNotMatch(src, /snap-todo-search/);
  assert.match(week, /value="in_progress"/);
  assert.match(week, /value="scheduled"/);
  assert.match(week, /value="completed"/);
  assert.doesNotMatch(week, /type="checkbox"/);
});
