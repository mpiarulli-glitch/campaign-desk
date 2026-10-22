import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_MANAGER_REVIEW_SECTIONS,
  accountManagerQueueNote,
  accountManagerReviewSection,
  campaignAssignedToAccountManager,
  campaignInAccountManagerQueue,
  isCampaignAccountManagerSlug,
} from "../src/lib/campaign-review-queue";

test("account manager queue is the internal loop for their clients or their assignment", () => {
  assert.equal(isCampaignAccountManagerSlug("cassidy"), true);
  assert.equal(isCampaignAccountManagerSlug("kyle_morris"), true);
  assert.equal(isCampaignAccountManagerSlug("luis_romero"), true);
  assert.equal(isCampaignAccountManagerSlug("kyle_onstott"), false);
  assert.equal(isCampaignAccountManagerSlug("michael"), false);
  assert.equal(isCampaignAccountManagerSlug(null), false);

  assert.deepEqual(
    ACCOUNT_MANAGER_REVIEW_SECTIONS.map((section) => section.status),
    ["internal_review", "revisions_made", "needs_revisions_internal"]
  );
  assert.equal(accountManagerReviewSection("internal_review"), "needs_review");
  assert.equal(accountManagerReviewSection("revisions_made"), "revisions_made");
  assert.equal(
    accountManagerReviewSection("needs_revisions_internal"),
    "revisions_left"
  );
  assert.equal(accountManagerReviewSection("draft"), null);
  assert.equal(accountManagerReviewSection("in_review"), null);
  assert.equal(
    accountManagerQueueNote("needs_revisions_internal"),
    "Waiting on Michael"
  );
  assert.equal(accountManagerQueueNote("revisions_made"), null);

  const cassidyClient = {
    status: "internal_review",
    owner_key: "cassidy",
    review_assignee: "",
  };
  assert.equal(campaignInAccountManagerQueue(cassidyClient, "cassidy"), true);
  assert.equal(campaignInAccountManagerQueue(cassidyClient, "kyle_morris"), false);

  const assignedToKyle = {
    status: "revisions_made",
    owner_key: "cassidy",
    review_assignee: "kyle_morris",
  };
  assert.equal(campaignAssignedToAccountManager(assignedToKyle, "kyle_morris"), true);
  assert.equal(campaignInAccountManagerQueue(assignedToKyle, "kyle_morris"), true);
  assert.equal(campaignInAccountManagerQueue(assignedToKyle, "cassidy"), true);

  const waiting = {
    status: "needs_revisions_internal",
    owner_key: "luis_romero",
    review_assignee: "luis_romero",
  };
  assert.equal(campaignInAccountManagerQueue(waiting, "luis_romero"), true);

  const draft = { status: "draft", owner_key: "cassidy", review_assignee: "cassidy" };
  assert.equal(campaignInAccountManagerQueue(draft, "cassidy"), false);

  const sent = { status: "in_review", owner_key: "cassidy", review_assignee: "cassidy" };
  assert.equal(campaignInAccountManagerQueue(sent, "cassidy"), false);

  const unassigned = {
    status: "internal_review",
    owner_key: "unassigned",
    review_assignee: "",
  };
  assert.equal(campaignInAccountManagerQueue(unassigned, "cassidy"), false);
});
