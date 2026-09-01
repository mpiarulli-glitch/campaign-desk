import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "path";

test("the person forecast page keeps Today, List, Calendar, and Tasks — not Week", () => {
  const src = fs.readFileSync(
    path.join("src/app/admin/forecast/[person]/page.tsx"),
    "utf8"
  );

  assert.match(src, /type View = "today" \| "list" \| "calendar" \| "tasks"/);
  assert.match(src, />\s*Today\s*</);
  assert.match(src, />\s*List\s*</);
  assert.match(src, />\s*Calendar\s*</);
  assert.match(src, />\s*Tasks\s*/);
  assert.match(src, /ForecastTasksPanel/);
  assert.doesNotMatch(src, /setView\("week"\)/);
  assert.doesNotMatch(src, />\s*Week\s*</);
  assert.doesNotMatch(src, /ops-planner/);
  assert.doesNotMatch(src, /ops-day-col/);

  // Bookmarks with ?view=week must not land on an empty board.
  assert.match(src, /parseForecastView\(searchParams\.get\("view"\)/);
  assert.match(
    src,
    /if \(raw === "today" \|\| raw === "list" \|\| raw === "calendar" \|\| raw === "tasks"\)/
  );
});

test("the calendar task editor starts the same timer as the list rows", () => {
  const src = fs.readFileSync(
    path.join("src/app/admin/forecast/[person]/page.tsx"),
    "utf8"
  );

  const editorStart = src.indexOf("{editingTask ? (");
  const editorEnd = src.indexOf("</SlotPopover>", editorStart);
  assert.ok(editorStart >= 0 && editorEnd > editorStart, "edit popover is in the page");
  const editor = src.slice(editorStart, editorEnd);

  assert.match(editor, /<TimerButton task=\{editingTask\} compact/);
  assert.match(src, /async function toggleTimer\(task: Task\)/);
  assert.match(src, /compact\s*\?\s*"Start timer"/);
});
