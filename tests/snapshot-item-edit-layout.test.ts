import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DepartmentItemEditor } from "../src/components/SnapshotItemEditor";

const LONG =
  "Reaching out to woocommerce support for help with the discount code that kept failing at checkout for returning members across both locations.";

test("department item editing uses a full-width multiline field", () => {
  const html = renderToStaticMarkup(
    createElement(DepartmentItemEditor, {
      label: "Lifecycle Department",
      value: LONG,
      onChange: () => {},
      onSave: () => {},
      onCancel: () => {},
    })
  );
  assert.match(html, /<textarea/);
  assert.match(html, /class="snap-edit-text"/);
  assert.match(html, /class="snap-dept-edit"/);
  assert.match(html, /aria-label="Edit Lifecycle Department item"/);
  assert.match(html, />Save</);
  assert.match(html, />Cancel</);
  assert.match(html, new RegExp(LONG.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(/<input\b/.test(html), false);

  const css = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.snap-dept-items li\.is-editing[\s\S]*flex-wrap:\s*wrap/);
  assert.match(css, /\.snap-dept-edit[\s\S]*flex:\s*1 1 100%/);
  assert.match(css, /\.snap-edit-text[\s\S]*min-height:\s*4\.5rem/);
  assert.match(css, /\.snap-edit-text[\s\S]*resize:\s*vertical/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.snap-dept-items li\.is-editing/);

  const dept = fs.readFileSync(
    new URL("../src/components/SnapshotWeekDepartments.tsx", import.meta.url),
    "utf8"
  );
  assert.match(dept, /className="snap-dept-item-body"/);
  assert.match(dept, /className=\{`snap-status is-/);
  assert.match(dept, /editing\?\.id === item\.id \? "is-editing"/);
  assert.match(dept, /<DepartmentItemEditor/);
  assert.equal(dept.includes('type="checkbox"'), false);
  assert.match(dept, /className="snap-drag"/);

  const wins = fs.readFileSync(
    new URL("../src/components/SnapshotDeskAccountViews.tsx", import.meta.url),
    "utf8"
  );
  assert.match(wins, /className="snap-desk-win-edit"/);
  assert.match(wins, /<SnapshotEditTextarea/);
  assert.match(wins, /aria-label="Edit win"/);
  assert.match(css, /\.snap-desk-win-edit[\s\S]*flex:\s*1 1 18rem/);
});
