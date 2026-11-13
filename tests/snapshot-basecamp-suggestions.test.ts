import assert from "node:assert/strict";
import test from "node:test";
import {
  matchSnapshotDepartment,
  pickerTodosForDepartment,
  snapshotHitsForPicker,
  snapshotListPlace,
} from "../src/lib/snapshot-basecamp-suggestions";

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

  await t.test("Ecoworkz video and SEO to-dos are not swallowed by a shared list", () => {
    assert.equal(snapshotListPlace("To-dos › SEO"), "SEO");
    assert.equal(snapshotListPlace("To Dos › Meta Ads"), "Meta Ads");
    assert.equal(
      matchSnapshotDepartment({
        title: "Book production day for this week's open window",
        place: "Social / Content / Production",
      }),
      "video"
    );
    assert.equal(
      matchSnapshotDepartment({
        title: "Film Ad & Publish It",
        place: "Social / Content / Production",
      }),
      "video"
    );
    assert.equal(
      matchSnapshotDepartment({
        title: "Optimize Social Pages Bios & Links",
        place: "Social / Content / Production",
      }),
      "social"
    );
    assert.equal(
      matchSnapshotDepartment({
        title: "Set up GBP",
        place: "Social / Content / Production",
      }),
      "seo"
    );
    assert.equal(
      matchSnapshotDepartment({
        title: "Set up LinkedIn",
        place: "Social / Content / Production",
      }),
      "lifecycle"
    );
    assert.equal(
      matchSnapshotDepartment({
        title: "Artificial Turf Installation – Corona Service Page",
        place: "SEO",
      }),
      "seo"
    );
    assert.equal(
      matchSnapshotDepartment({ title: "Keyword research for Corona", place: "Forecast" }),
      "seo"
    );
    assert.equal(
      matchSnapshotDepartment({ title: "Final Video", place: "Forecast" }),
      "video"
    );
    assert.equal(
      matchSnapshotDepartment({ title: "Editing and uploads", place: "Forecast" }),
      "video"
    );
    assert.equal(
      matchSnapshotDepartment({ title: "07 Oct Vid", place: "VIDEOS › Ready for Review" }),
      "video"
    );
    assert.equal(
      matchSnapshotDepartment({ title: "Client raw files", place: "VIDEOS › Content Files" }),
      "video"
    );
    assert.equal(
      matchSnapshotDepartment({ title: "Call the vendor", place: "Forecast" }),
      "unsorted"
    );
    assert.equal(
      matchSnapshotDepartment({
        title: "Service page copy",
        place: "Web Development / Web Design",
      }),
      "web"
    );
  });

  await t.test("the picker offers those to-dos and still falls back when none match", () => {
    const hits = snapshotHitsForPicker(
      [
        {
          id: "1",
          title: "Book production day for this week's open window",
          list: "To-dos › Social / Content / Production",
        },
        {
          id: "2",
          title: "Set up GBP",
          list: "To-dos › Social / Content / Production",
        },
        {
          id: "3",
          title: "Artificial Turf Installation – Corona Service Page",
          list: "To-dos › SEO",
        },
        {
          id: "4",
          title: "Send the newsletter",
          list: "To-dos › Email / SMS / LinkedIn / Automations",
        },
        {
          id: "5",
          title: "Call the vendor",
          list: "To-dos › Misc.",
        },
        {
          id: "9",
          title: "07 Oct Vid",
          list: "VIDEOS › Ready for Review",
          kind: "card",
        },
      ],
      "2026-11-12"
    );
    const video = pickerTodosForDepartment(hits, "video", []);
    assert.deepEqual(
      video.matched.map((todo) => todo.title),
      ["Book production day for this week's open window", "07 Oct Vid"]
    );
    assert.equal(video.matched[1]?.sourceKey, "card:9");
    assert.equal(video.matched[1]?.place, "VIDEOS › Ready for Review");
    assert.deepEqual(
      video.unmatched.map((todo) => todo.title),
      ["Call the vendor"]
    );

    const seo = pickerTodosForDepartment(hits, "seo", []);
    assert.deepEqual(
      seo.matched.map((todo) => todo.title),
      ["Set up GBP", "Artificial Turf Installation – Corona Service Page"]
    );
    assert.deepEqual(
      seo.unmatched.map((todo) => todo.title),
      ["Call the vendor"]
    );

    const onlyLifecycle = snapshotHitsForPicker(
      [
        {
          id: "4",
          title: "Send the newsletter",
          list: "To-dos › Email / SMS / LinkedIn / Automations",
        },
      ],
      "2026-11-12"
    );
    assert.deepEqual(pickerTodosForDepartment(onlyLifecycle, "video", []), {
      matched: [],
      unmatched: [],
    });
    assert.deepEqual(pickerTodosForDepartment(onlyLifecycle, "seo", []), {
      matched: [],
      unmatched: [],
    });
    assert.equal(pickerTodosForDepartment(onlyLifecycle, "lifecycle", []).matched.length, 1);
  });
});
