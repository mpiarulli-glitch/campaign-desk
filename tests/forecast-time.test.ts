import assert from "node:assert/strict";
import test from "node:test";
import {
  CAL_END_HOUR,
  CAL_PX_PER_HOUR,
  CAL_START_HOUR,
  addHoursToTime,
  formatTimeLabel,
  hoursFromResize,
  layoutTimedBlocks,
  minutesFromMidnight,
  parseTimeInput,
  timeAtOffset,
  staggerStartTimes,
} from "../src/lib/forecast-time";

test("parseTimeInput accepts 24-hour and am/pm", () => {
  assert.equal(parseTimeInput("9:00"), "09:00");
  assert.equal(parseTimeInput("09:30"), "09:30");
  assert.equal(parseTimeInput("9:00 AM"), "09:00");
  assert.equal(parseTimeInput("12:00pm"), "12:00");
  assert.equal(parseTimeInput("12:00 am"), "00:00");
  assert.equal(parseTimeInput("5:45 PM"), "17:45");
  assert.equal(parseTimeInput(""), "");
  assert.equal(parseTimeInput("nope"), "");
});

test("addHoursToTime and labels", () => {
  assert.equal(addHoursToTime("09:00", 1.5), "10:30");
  assert.equal(addHoursToTime("23:00", 2), "01:00");
  assert.equal(formatTimeLabel("09:00"), "9 AM");
  assert.equal(formatTimeLabel("09:30"), "9:30 AM");
  assert.equal(minutesFromMidnight("09:30"), 570);
});

test("staggerStartTimes walks each slice forward", () => {
  assert.deepEqual(staggerStartTimes("09:00", [1, 2, 0.5]), ["09:00", "10:00", "12:00"]);
  assert.deepEqual(staggerStartTimes("", [1, 1]), ["", ""]);
});

test("layoutTimedBlocks stacks overlaps into columns", () => {
  const items = [
    { id: "a", start: "09:00", hours: 2 },
    { id: "b", start: "10:00", hours: 1 },
    { id: "c", start: "13:00", hours: 1 },
  ];
  const laid = layoutTimedBlocks(items, (t) => t.start, (t) => t.hours);
  assert.equal(laid.length, 3);
  const a = laid.find((b) => b.item.id === "a")!;
  const b = laid.find((b) => b.item.id === "b")!;
  const c = laid.find((b) => b.item.id === "c")!;
  assert.equal(a.col, 0);
  assert.equal(b.col, 1);
  assert.equal(a.cols, 2);
  assert.equal(b.cols, 2);
  assert.equal(c.col, 0);
  assert.equal(c.cols, 1);
});

/* ----------------------------------------------------- calendar drop targets */

// Pixels down the day column for a given clock time, so the cases below read as
// times rather than as arithmetic.
function yFor(hour: number, minute = 0): number {
  return ((hour * 60 + minute - CAL_START_HOUR * 60) / 60) * CAL_PX_PER_HOUR;
}

test("a drop lands on the nearest quarter hour", () => {
  assert.equal(timeAtOffset(yFor(9, 0)), "09:00");
  assert.equal(timeAtOffset(yFor(9, 7)), "09:00");
  assert.equal(timeAtOffset(yFor(9, 8)), "09:15");
  assert.equal(timeAtOffset(yFor(9, 22)), "09:15");
  assert.equal(timeAtOffset(yFor(9, 23)), "09:30");
});

test("a block dropped where it was grabbed keeps its start", () => {
  // Picked up 30 minutes into a block and dropped with the cursor at 11:30: the
  // block starts at 11:00, where its top edge actually is.
  assert.equal(timeAtOffset(yFor(11, 30), { grabOffsetMin: 30, durationMin: 60 }), "11:00");
});

test("a block can't be dropped off the bottom of the grid", () => {
  // A two-hour block dropped at the last hour is pulled back so it still ends
  // inside the hours the calendar draws.
  assert.equal(
    timeAtOffset(yFor(CAL_END_HOUR - 1), { durationMin: 120 }),
    `${CAL_END_HOUR - 2}:00`
  );
  assert.equal(timeAtOffset(yFor(CAL_START_HOUR - 2)), `0${CAL_START_HOUR}:00`);
});

test("resizing snaps to quarter hours and never reaches zero", () => {
  assert.equal(hoursFromResize(yFor(10, 30), "09:00"), 1.5);
  assert.equal(hoursFromResize(yFor(9, 5), "09:00"), 0.25);
  // Dragged above the block's own start, which would otherwise be a negative
  // length.
  assert.equal(hoursFromResize(yFor(8, 0), "09:00"), 0.25);
  // Dragged past the end of the day.
  assert.equal(hoursFromResize(yFor(CAL_END_HOUR + 3), "18:00"), 1);
});
