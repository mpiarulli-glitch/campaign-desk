import assert from "node:assert/strict";
import test from "node:test";
import {
  clientApprovalEmailBodies,
  clientApprovalEmailSubject,
  clientApprovalEmailText,
  clientReviewFollowupEmailBodies,
  clientReviewFollowupEmailText,
} from "../src/lib/client-approval";
import {
  APPROVAL_EMAIL_CC,
  resolveApprovalEmailTo,
  sendApprovalEmail,
} from "../src/lib/approval-email";
import { SYLVIA_CC_EMAIL } from "../src/lib/review-cc";

const input = {
  clientContactName: "Katie Jones",
  campaignTitle: "Vitatherapy Welcome Series",
  previewUrl: "https://campaign-desk.example/review/client-token",
};

test("approval email uses the pending-campaign subject", () => {
  assert.equal(
    clientApprovalEmailSubject(),
    "Your Campaign Is Waiting For Approval"
  );
});

test("approval email text matches the ops template", () => {
  const text = clientApprovalEmailText(input);
  assert.match(text, /^Hi Katie,/);
  assert.match(text, /ready and waiting for your approval/);
  assert.match(text, /Review Pending Campaign:/);
  assert.match(text, /campaign-desk\.example\/review\/client-token/);
  assert.match(text, /The Marketing Empire Group Team/);
  assert.doesNotMatch(text, /Basecamp/);
  assert.doesNotMatch(text, /Here's what to check/);
});

test("approval email HTML is the pending-campaign template", () => {
  const { subject, html, text } = clientApprovalEmailBodies({
    input,
    clientName: "Vitatherapy",
    signer: "Kyle Morris",
  });
  assert.equal(subject, "Your Campaign Is Waiting For Approval");
  assert.match(html, /Review Pending Campaign/);
  assert.match(html, /#00d4e8/);
  assert.match(html, /campaign-desk\.example\/review\/client-token/);
  assert.match(html, /6916cb1921776f532bcab29e/);
  assert.match(html, /Please review the campaign and approve it/);
  assert.doesNotMatch(html, /bc-attachment/);
  assert.doesNotMatch(html, /\{\{contact\./);
  assert.match(text, /Thank you,\nThe Marketing Empire Group Team/);
});

test("resolveApprovalEmailTo prefers the saved contact email", () => {
  assert.equal(
    resolveApprovalEmailTo({
      contactEmail: "katie@vita.example",
      rosterEmail: "other@basecamp.example",
    }),
    "katie@vita.example"
  );
  assert.equal(
    resolveApprovalEmailTo({
      contactEmail: "  ",
      rosterEmail: "other@basecamp.example",
    }),
    "other@basecamp.example"
  );
  assert.equal(
    resolveApprovalEmailTo({ contactEmail: "", rosterEmail: "" }),
    ""
  );
});

test("sendApprovalEmail skips when there is no To address", async () => {
  const result = await sendApprovalEmail({
    client: {
      id: "c1",
      name: "Vitatherapy",
      contact_email: "",
      contact_name: "Katie",
      account_manager: "kyle",
    } as never,
    to: "",
    messageInput: input,
  });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, "no contact email");
});

test("approval emails CC Michael, not Sylvia", () => {
  assert.equal(APPROVAL_EMAIL_CC, "mpiarulli@marketingempiregroup.com");
  assert.notEqual(APPROVAL_EMAIL_CC, SYLVIA_CC_EMAIL);
});

test("follow-up email uses the quick-review subject and template", () => {
  const text = clientReviewFollowupEmailText(input);
  assert.match(text, /^Hi Katie,/);
  assert.match(text, /friendly follow-up/);
  assert.match(text, /Review Pending Campaign:/);
  assert.doesNotMatch(text, /Basecamp/);

  const { subject, html } = clientReviewFollowupEmailBodies({
    input,
    clientName: "Vitatherapy",
    signer: "Kyle Morris",
  });
  assert.equal(subject, "Quick Review Needed For Your Campaign");
  assert.match(html, /still ready and waiting for your approval/);
  assert.match(html, /Review Pending Campaign/);
  assert.doesNotMatch(html, /bc-attachment/);
});
