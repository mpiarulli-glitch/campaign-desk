import assert from "node:assert/strict";
import test from "node:test";
import { matchSnapshotDepartment } from "../src/lib/snapshot-basecamp-suggestions";

test("the add picker still classifies a Basecamp list", async (t) => {
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
    assert.equal(matchSnapshotDepartment({ title: "Boost the offer", place: "Meta Ads" }), "ads");
    assert.equal(matchSnapshotDepartment({ title: "Boost the offer", place: "Paid Social" }), "ads");
    assert.equal(matchSnapshotDepartment({ title: "Boost the offer", place: "Facebook Ads" }), "ads");
    assert.equal(matchSnapshotDepartment({ title: "Post the reel", place: "Social" }), "social");
    assert.equal(
      matchSnapshotDepartment({
        title: "Retarget the buyers",
        place: "Email / SMS / LinkedIn / Automations",
      }),
      "lifecycle"
    );
    assert.equal(
      matchSnapshotDepartment({ title: "Follow up", place: "To-dos", assigneeNames: ["Abel"] }),
      "unsorted"
    );
  });

  await t.test("unmapped work stays unsorted so the picker can ask", () => {
    assert.equal(
      matchSnapshotDepartment({ title: "Call the vendor", place: "To-dos › Misc" }),
      "unsorted"
    );
  });
});
