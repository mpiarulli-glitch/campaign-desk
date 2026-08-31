import assert from "node:assert/strict";
import test from "node:test";
import {
  findNthOccurrence,
  ordinalOfSlice,
  quotedFeedback,
} from "../src/lib/copy-quote";

test("ordinalOfSlice counts earlier copies of the same passage", () => {
  const hay = "Book now. Book now. Book later.";
  assert.equal(ordinalOfSlice(hay, "Book now", 0), 0);
  assert.equal(ordinalOfSlice(hay, "Book now", 10), 1);
  assert.equal(ordinalOfSlice(hay, "Book later", hay.indexOf("Book later")), 0);
});

test("findNthOccurrence returns the matching slice", () => {
  const hay = "Save 20% this weekend. Save 20% next weekend.";
  assert.deepEqual(findNthOccurrence(hay, "Save 20%", 0), { start: 0, end: 8 });
  assert.deepEqual(findNthOccurrence(hay, "Save 20%", 1), {
    start: hay.lastIndexOf("Save 20%"),
    end: hay.lastIndexOf("Save 20%") + 8,
  });
  assert.equal(findNthOccurrence(hay, "Save 20%", 2), null);
  assert.equal(findNthOccurrence(hay, "", 0), null);
});

test("quotedFeedback names the passage the reviewer highlighted", () => {
  assert.equal(
    quotedFeedback("Book a consultation", "Make this shorter."),
    `On the highlighted copy: "Book a consultation"\n\nMake this shorter.`
  );
  assert.equal(quotedFeedback(null, "Overall looks good."), "Overall looks good.");
  assert.equal(
    quotedFeedback("Get 20% off", ""),
    `On the highlighted copy: "Get 20% off"`
  );
});
