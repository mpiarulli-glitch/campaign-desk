import assert from "node:assert/strict";
import test from "node:test";
import {
  completedInSnapshotWeek,
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
    assert.equal(matchSnapshotDepartment({ title: "Filming the testimonial", place: "To-dos" }), "video");
    assert.equal(matchSnapshotDepartment({ title: "Update the website hero", place: "To-dos" }), "web");
    assert.equal(matchSnapshotDepartment({ title: "Send the SMS blast", place: "To-dos" }), "lifecycle");
    assert.equal(matchSnapshotDepartment({ title: "Klaviyo automation review", place: "To-dos" }), "lifecycle");
    assert.equal(matchSnapshotDepartment({ title: "Quarterly strategy deck", place: "To-dos" }), "strategy");
  });

  await t.test("the list name decides the department, and LinkedIn stays in Lifecycle", () => {
    assert.equal(
      matchSnapshotDepartment({
        title: "Move Mystery Discount",
        place: "Email / SMS / LinkedIn / Automations",
      }),
      "lifecycle"
    );
    assert.equal(matchSnapshotDepartment({ title: "Anything", place: "SEO" }), "seo");
    assert.equal(matchSnapshotDepartment({ title: "Post a reel", place: "LinkedIn" }), "lifecycle");
    assert.equal(
      matchSnapshotDepartment({ title: "Send the newsletter", place: "Instagram" }),
      "social"
    );
    assert.equal(matchSnapshotDepartment({ title: "Check in", place: "Videos" }), "video");
    assert.equal(matchSnapshotDepartment({ title: "Check in", place: "Landing page" }), "web");
    assert.equal(matchSnapshotDepartment({ title: "Check in", place: "Google Business" }), "seo");
    assert.equal(matchSnapshotDepartment({ title: "Check in", place: "Kickoff" }), "strategy");
    assert.equal(
      matchSnapshotDepartment({ title: "Follow up", place: "To-dos", assigneeNames: ["Abel"] }),
      "unsorted"
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

  await t.test("the Pacific week keeps Friday evening and drops the next Monday", () => {
    // 2026-11-02 is a Monday. Pacific is PST (UTC-8) after the November change.
    assert.equal(completedInSnapshotWeek("2026-11-03T20:02:54Z", WEEK), true);
    assert.equal(completedInSnapshotWeek("2026-11-02T08:00:00Z", WEEK), true);
    assert.equal(completedInSnapshotWeek("2026-11-09T07:59:59Z", WEEK), true);
    assert.equal(completedInSnapshotWeek("2026-11-02T07:59:59Z", WEEK), false);
    assert.equal(completedInSnapshotWeek("2026-11-09T08:00:00Z", WEEK), false);
    const shown = suggestionsForWeek({
      activities: [
        activity({
          sourceKey: "todo:10472139656",
          title: "Update current blog content",
          place: "SEO",
          completedAt: "2026-11-03T20:02:54Z",
        }),
        activity({
          sourceKey: "card:1",
          title: "Update the website hero",
          place: "Done",
          completedAt: "2026-11-04T18:00:00Z",
        }),
        activity({
          sourceKey: "card:2",
          title: "Call the vendor",
          place: "Done",
          completedAt: "2026-10-28T18:00:00Z",
        }),
      ],
      weekStart: WEEK,
      existingItems: [],
      dismissedKeys: [],
    });
    assert.deepEqual(
      shown.map((row) => [row.sourceKey, row.department]),
      [
        ["todo:10472139656", "seo"],
        ["card:1", "web"],
      ]
    );
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
