import assert from "node:assert/strict";
import test from "node:test";

test("editorial calendar type filter", async () => {
  const { sendMatchesTypeFilter } = await import("../src/lib/calendar-type-filter");

  // Nothing selected is "show the whole calendar", including types that have
  // no chip of their own.
  assert.equal(sendMatchesTypeFilter("email_campaign", []), true);
  assert.equal(sendMatchesTypeFilter("blog_post", []), true);
  assert.equal(sendMatchesTypeFilter("social_post", []), true);
  assert.equal(sendMatchesTypeFilter("", []), true);

  assert.equal(sendMatchesTypeFilter("email_campaign", ["email"]), true);
  assert.equal(sendMatchesTypeFilter("social_video_carousel", ["video"]), true);
  assert.equal(sendMatchesTypeFilter("crm_automation", ["sms"]), true);

  assert.equal(sendMatchesTypeFilter("blog_post", ["email"]), false);
  assert.equal(sendMatchesTypeFilter("social_post", ["video"]), false);
  assert.equal(sendMatchesTypeFilter("", ["sms"]), false);

  assert.equal(sendMatchesTypeFilter("email_campaign", ["email", "sms"]), true);
  assert.equal(sendMatchesTypeFilter("crm_automation", ["email", "sms"]), true);
  assert.equal(sendMatchesTypeFilter("social_video_carousel", ["email", "sms"]), false);
});
