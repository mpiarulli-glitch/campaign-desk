import assert from "node:assert/strict";
import test from "node:test";
import {
  matchSnapshotDepartment,
  suggestionsForWeek,
  type BasecampActivity,
} from "../src/lib/snapshot-basecamp-suggestions";

const WEEK = "2026-11-02";

function activity(partial: Partial<BasecampActivity> & { title: string }): BasecampActivity {
  return {
    sourceKey: partial.sourceKey || `todo:${partial.title}`,
    title: partial.title,
    place: partial.place || "To-dos › General",
    assigneeNames: partial.assigneeNames || [],
    completedAt: partial.completedAt === undefined ? "2026-11-04T18:00:00.000Z" : partial.completedAt,
  };
}

test("snapshot Basecamp suggestion mapping and dedupe", async (t) => {
  await t.test("list and column names beat the title and the assignee", () => {
    assert.equal(
      matchSnapshotDepartment({
        title: "Write the blog post",
        place: "Videos › This week",
        assigneeNames: ["Abel"],
      }),
      "video"
    );
    assert.equal(
      matchSnapshotDepartment({
        title: "Check in",
        place: "Deliverables › SEO column",
      }),
      "seo"
    );
  });

  await t.test("title keywords pick a department when the list does not", () => {
    assert.equal(matchSnapshotDepartment({ title: "Publish the blog", place: "To-dos" }), "seo");
    assert.equal(matchSnapshotDepartment({ title: "Schedule Instagram reels", place: "To-dos" }), "social");
    assert.equal(matchSnapshotDepartment({ title: "Film the testimonial", place: "To-dos" }), "video");
    assert.equal(matchSnapshotDepartment({ title: "Update the website hero", place: "To-dos" }), "web");
    assert.equal(matchSnapshotDepartment({ title: "Send the SMS blast", place: "To-dos" }), "lifecycle");
    assert.equal(matchSnapshotDepartment({ title: "Klaviyo automation review", place: "To-dos" }), "lifecycle");
    assert.equal(matchSnapshotDepartment({ title: "Quarterly strategy deck", place: "To-dos" }), "strategy");
  });

  await t.test("a specialist assignee is used only when the words do not match", () => {
    assert.equal(
      matchSnapshotDepartment({ title: "Follow up", place: "To-dos", assigneeNames: ["Abel"] }),
      "seo"
    );
    assert.equal(
      matchSnapshotDepartment({ title: "Follow up", place: "To-dos", assigneeNames: ["Randi"] }),
      "social"
    );
    assert.equal(
      matchSnapshotDepartment({ title: "Follow up", place: "To-dos", assigneeNames: ["Roy"] }),
      "web"
    );
    assert.equal(
      matchSnapshotDepartment({ title: "Follow up", place: "To-dos", assigneeNames: ["Michael"] }),
      "lifecycle"
    );
    assert.equal(
      matchSnapshotDepartment({
        title: "Post the reel",
        place: "To-dos",
        assigneeNames: ["Abel"],
      }),
      "social"
    );
  });

  await t.test("unmapped work stays unsorted", () => {
    assert.equal(
      matchSnapshotDepartment({ title: "Call the vendor", place: "To-dos › Misc" }),
      "unsorted"
    );
  });

  await t.test("only this week's completions are suggested, once, and not if already logged or dismissed", () => {
    const activities = [
      activity({ sourceKey: "todo:1", title: "Publish the blog", place: "SEO" }),
      activity({ sourceKey: "todo:2", title: "Publish the blog", place: "SEO" }),
      activity({
        sourceKey: "todo:3",
        title: "Update the website hero",
        place: "Web",
        completedAt: "2026-11-09T18:00:00.000Z",
      }),
      activity({
        sourceKey: "todo:4",
        title: "Send the newsletter",
        place: "General",
        completedAt: "2026-11-02T08:30:00.000Z",
      }),
      activity({ sourceKey: "todo:5", title: "Call the vendor", place: "Misc" }),
      activity({ sourceKey: "todo:6", title: "Film the testimonial", place: "Video" }),
      activity({ sourceKey: "todo:7", title: "   ", place: "SEO" }),
    ];
    const shown = suggestionsForWeek({
      activities,
      weekStart: WEEK,
      existingItems: ["Publish the blog!"],
      dismissedKeys: ["todo:6"],
    });
    assert.deepEqual(
      shown.map((row) => row.sourceKey),
      ["todo:4", "todo:5"]
    );
    assert.equal(shown[0].department, "lifecycle");
    assert.equal(shown[1].department, "unsorted");
  });

  await t.test("a reworded list item still hides the to-do it came from", () => {
    const shown = suggestionsForWeek({
      activities: [
        activity({ sourceKey: "todo:1", title: "Publish the blog", place: "SEO" }),
        activity({ sourceKey: "todo:8", title: "Publish the blog", place: "SEO" }),
      ],
      weekStart: WEEK,
      existingItems: ["Published the November blog"],
      existingSourceKeys: ["todo:1"],
      dismissedKeys: [],
    });
    assert.deepEqual(
      shown.map((row) => row.sourceKey),
      ["todo:8"]
    );
  });
});
