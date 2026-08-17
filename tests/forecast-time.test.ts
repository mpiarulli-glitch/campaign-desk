import assert from "node:assert/strict";
import test from "node:test";
import {
  addHoursToTime,
  formatTimeLabel,
  layoutTimedBlocks,
  minutesFromMidnight,
  parseTimeInput,
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
