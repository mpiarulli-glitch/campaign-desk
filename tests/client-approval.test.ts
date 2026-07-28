import assert from "node:assert/strict";
import test from "node:test";
import {
  campaignApprovalRevisionKey,
  clientApprovalMessageHtml,
  clientApprovalMessageText,
} from "../src/lib/client-approval";

const input = {
  clientContactName: "Katie Jones",
  campaignTitle: "Vitatherapy Welcome Series",
  previewUrl: "https://campaign-desk.example/review/client-token",
};

test("client approval message uses the approved template without subject lines", () => {
  const text = clientApprovalMessageText(input);
  assert.match(text, /^Hi Katie,/);
  assert.match(text, /Here's what to check:/);
  assert.match(text, /Copy: does the messaging reflect your brand/);
  assert.match(text, /Review the Vitatherapy Welcome Series:/);
  assert.match(text, /one round of revisions per campaign/);
  assert.match(text, /reply with "Approved"/);
  assert.doesNotMatch(text, /subject line/i);
});

test("Basecamp HTML escapes account data and links the external review", () => {
  const html = clientApprovalMessageHtml({
    clientContactName: "Katie <Admin>",
    campaignTitle: "Welcome & Wellness",
    previewUrl: 'https://example.com/review?client="vita"',
  });
  assert.match(html, /Hi Katie,/);
  assert.match(html, /Welcome &amp; Wellness/);
  assert.match(
    html,
    /https:\/\/example\.com\/review\?client=&quot;vita&quot;/
  );
  assert.doesNotMatch(html, /<Admin>/);
});

test("approval revision key changes only when campaign content changes", () => {
  const campaign = {
    title: "Vitatherapy Welcome Series",
    client_id: "client-1",
    external_token: "token-1",
  };
  const emails = [
    { id: "email-1", title: "Welcome", updated_at: "2026-07-27T10:00:00Z" },
  ];
  const first = campaignApprovalRevisionKey(campaign, emails);
  const same = campaignApprovalRevisionKey(campaign, emails);
  const changed = campaignApprovalRevisionKey(campaign, [
    { ...emails[0], updated_at: "2026-07-27T11:00:00Z" },
  ]);

  assert.equal(first, same);
  assert.notEqual(first, changed);
});
