import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

test("only the grip handle is draggable in the snapshot editor", () => {
  const source = fs.readFileSync(
    new URL("../src/components/SnapshotWeekDepartments.tsx", import.meta.url),
    "utf8"
  );
  const handles = source.match(/className="snap-drag"[\s\S]{0,80}draggable/g) || [];
  assert.equal(handles.length, 1, "the grip is the only draggable control");
  assert.equal((source.match(/\bdraggable\b/g) || []).length, 1);
  assert.equal(/<li\b[^>]*\bdraggable\b/.test(source), false);
  assert.doesNotMatch(source, /snap-suggest-label/);
  assert.doesNotMatch(source, /snap-suggest-edit/);
  assert.doesNotMatch(source, /departments\/suggestions/);
});
