import assert from "node:assert/strict";
import test from "node:test";

import {
  inferDeliverableKind,
  isExplicitlyRecurring,
} from "../src/lib/snapshot-kind";

test("a deliverable is one-off unless the copy says it repeats", () => {
  assert.equal(isExplicitlyRecurring("Competitive Benchmarking Reports"), false);
  assert.equal(isExplicitlyRecurring("ICP Development"), false);
  assert.equal(isExplicitlyRecurring("Systems Access (Google, Social, Website)"), false);
  assert.equal(isExplicitlyRecurring("Editorial Calendar"), false);
  assert.equal(isExplicitlyRecurring("Brand Positioning & Messaging Framework"), false);
  assert.equal(isExplicitlyRecurring("Cookie Empire Tracking - Daily (50/day)"), false);
  assert.equal(isExplicitlyRecurring("AI Chatbot / Booking Bot"), false);
  assert.equal(isExplicitlyRecurring("Google Ads"), false);

  assert.equal(isExplicitlyRecurring("Monthly Strategy Meeting"), true);
  assert.equal(isExplicitlyRecurring("SEO Management - 15 hours/month"), true);
  assert.equal(isExplicitlyRecurring("Social Media Management - 3 posts/week"), true);
  assert.equal(isExplicitlyRecurring("Go-to-market strategy (updated quarterly)"), true);
  assert.equal(isExplicitlyRecurring("Google Business Profile Optimization – Monthly"), true);

  assert.equal(inferDeliverableKind("ICP Development", ""), "one_time");
  assert.equal(inferDeliverableKind("Monthly newsletter", ""), "recurring");
  assert.equal(inferDeliverableKind("Google Ads", "Monthly"), "recurring");
  assert.equal(inferDeliverableKind("Google Ads", "", "recurring"), "recurring");
  assert.equal(inferDeliverableKind("Monthly newsletter", "", "one_time"), "one_time");
});
