import assert from "node:assert/strict";
import test from "node:test";
import { snapPopPlacement } from "../src/lib/snapshot-pop-placement";

const view = { viewportWidth: 1200, viewportHeight: 800, chromeHeight: 36 };

test("the typeahead opens under the field when the menu fits", () => {
  const place = snapPopPlacement({
    ...view,
    anchorTop: 200,
    anchorBottom: 240,
    anchorLeft: 40,
    anchorWidth: 640,
    menuHeight: 160,
  });
  assert.equal(place.flip, false);
  assert.equal(place.top, 244);
  assert.equal(place.left, 40);
  assert.equal(place.width, 640);
  assert.equal(place.maxHeight, 160);
  assert.equal(place.listMaxHeight, 124);
});

test("the typeahead flips above the field when the card sits at the bottom", () => {
  const place = snapPopPlacement({
    ...view,
    anchorTop: 700,
    anchorBottom: 740,
    anchorLeft: 40,
    anchorWidth: 640,
    menuHeight: 180,
  });
  assert.equal(place.flip, true);
  assert.equal(place.maxHeight, 180);
  assert.equal(place.top, 700 - 4 - 180);
  assert.ok(place.top + place.maxHeight <= 700);
});

test("a menu taller than the open side scrolls instead of leaving the screen", () => {
  const place = snapPopPlacement({
    ...view,
    anchorTop: 40,
    anchorBottom: 80,
    anchorLeft: 40,
    anchorWidth: 640,
    menuHeight: 900,
  });
  assert.equal(place.flip, false);
  assert.equal(place.top, 84);
  assert.ok(place.top + place.maxHeight <= view.viewportHeight - 8);
  assert.ok(place.listMaxHeight < place.maxHeight);
  assert.ok(place.listMaxHeight > 0);
});
