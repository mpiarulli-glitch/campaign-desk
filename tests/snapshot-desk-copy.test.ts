import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  deskCustomItemLabel,
  deskDepartmentHeading,
  deskItemParts,
  deskTodoCountLine,
  deskWinNeededLine,
} from "../src/lib/snapshot-desk-copy";

test("this week copy matches the approved desk", () => {
  assert.equal(deskWinNeededLine(1), "1 account still needs a win this week.");
  assert.equal(deskWinNeededLine(2), "2 accounts still need a win this week.");
  assert.equal(deskDepartmentHeading("Video Department"), "Video department");
  assert.equal(deskDepartmentHeading("SEO Department"), "SEO department");
  assert.equal(
    deskTodoCountLine(7, 29),
    "7 to-dos in this department · 29 unassigned"
  );
  assert.equal(deskTodoCountLine(1, 0), "1 to-do in this department");
  assert.equal(deskCustomItemLabel("H1"), 'Add "H1" as a custom item');
});

test("a logged line can show a title and a description without inventing one", () => {
  assert.deepEqual(
    deskItemParts(
      "Monthly Video Deliverables Completed Description: Completed all 8 video deliverables for October."
    ),
    {
      title: "Monthly Video Deliverables Completed",
      description: "Completed all 8 video deliverables for October.",
    }
  );
  assert.deepEqual(deskItemParts("Edited the reel\nCut for social."), {
    title: "Edited the reel",
    description: "Cut for social.",
  });
  assert.deepEqual(deskItemParts("One short line"), {
    title: "One short line",
    description: "",
  });
});

test("the week desk opts into the new layout and the account page does not", () => {
  const desk = fs.readFileSync(
    new URL("../src/app/admin/snapshot/desk/page.tsx", import.meta.url),
    "utf8"
  );
  const account = fs.readFileSync(
    new URL("../src/app/admin/snapshot/[id]/page.tsx", import.meta.url),
    "utf8"
  );
  assert.match(desk, /snap-week-desk/);
  assert.match(desk, /variant="week"/);
  assert.match(desk, /deskWinNeededLine/);
  assert.equal(account.includes('variant="week"'), false);
  assert.equal(account.includes("snap-week-desk"), false);

  const departments = fs.readFileSync(
    new URL("../src/components/SnapshotWeekDepartments.tsx", import.meta.url),
    "utf8"
  );
  assert.match(departments, /Move to…/);
  assert.match(departments, /note\.label/);
});
