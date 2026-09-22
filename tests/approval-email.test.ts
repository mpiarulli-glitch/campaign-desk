import assert from "node:assert/strict";
import test from "node:test";
import {
  clientApprovalEmailBodies,
  clientApprovalEmailSubject,
  clientApprovalEmailText,
  clientApprovalMessageText,
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

test("approval email subject names the campaign", () => {
  assert.equal(
    clientApprovalEmailSubject(input),
    "Vitatherapy Welcome Series is ready for your review"
  );
});

test("approval email text asks for a reply by email, not Basecamp", () => {
  const text = clientApprovalEmailText(input);
  assert.match(text, /^Hi Katie,/);
  assert.match(text, /Here's what to check:/);
  assert.match(text, /reply to this email/);
  assert.doesNotMatch(text, /Basecamp card/);
  assert.doesNotMatch(text, /CC: @Sylvia/);
  assert.doesNotMatch(text, /bc-attachment/);
});

test("approval email adapts a custom Basecamp draft", () => {
  const draft = clientApprovalMessageText(input);
  const text = clientApprovalEmailText(input, draft);
  assert.match(text, /reply to this email/);
  assert.doesNotMatch(text, /Basecamp card/);
});

test("approval email bodies include a branded CTA and no Basecamp markup", () => {
  const { subject, html, text } = clientApprovalEmailBodies({
    input,
    clientName: "Vitatherapy",
    signer: "Kyle Morris",
  });
  assert.match(subject, /ready for your review/);
  assert.match(html, /Ready for your review/);
  assert.match(html, /Approve and notify email team/);
  assert.match(html, /campaign-desk\.example\/review\/client-token/);
  assert.match(html, /Kyle Morris/);
  assert.doesNotMatch(html, /bc-attachment/);
  assert.match(text, /Thanks,\nKyle Morris/);
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
