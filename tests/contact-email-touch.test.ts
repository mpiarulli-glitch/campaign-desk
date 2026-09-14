import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isMarketingEmailSource,
  isOutboundMarketingTouchMessage,
  isPostFormWorkflowAutomation,
  isTransactionalEmailContent,
  isTransactionalEmailSubject,
  formFilledAtByContactId,
} from "../src/lib/ghl-contact-email-touch";

describe("isMarketingEmailSource", () => {
  it("treats unknown/empty source as eligible unless strict", () => {
    assert.equal(isMarketingEmailSource(null), true);
    assert.equal(isMarketingEmailSource(""), true);
    assert.equal(isMarketingEmailSource(null, { strict: true }), false);
    assert.equal(isMarketingEmailSource("", { strict: true }), false);
  });

  it("accepts campaign and workflow sources", () => {
    assert.equal(isMarketingEmailSource("campaign"), true);
    assert.equal(
      isMarketingEmailSource("workflow", {
        strict: true,
        subject: "Three Details That Matter",
      }),
      true
    );
    assert.equal(isMarketingEmailSource("bulk_email"), true);
    assert.equal(isMarketingEmailSource("broadcast", { strict: true }), true);
  });

  it("rejects empty-subject workflow/automation in strict mode (Eric case)", () => {
    assert.equal(
      isMarketingEmailSource("workflow", { strict: true, subject: "" }),
      false
    );
    assert.equal(
      isMarketingEmailSource("workflow", { strict: true, subject: null }),
      false
    );
    assert.equal(
      isMarketingEmailSource("automation", { strict: true, subject: "  " }),
      false
    );
    // Non-strict still allows empty-subject workflow (legacy / loose mode).
    assert.equal(isMarketingEmailSource("workflow", { subject: "" }), true);
  });

  it("still accepts campaign/bulk with empty subject in strict mode", () => {
    assert.equal(
      isMarketingEmailSource("campaign", { strict: true, subject: "" }),
      true
    );
    assert.equal(
      isMarketingEmailSource("bulk", { strict: true, subject: "" }),
      true
    );
  });

  it("rejects clearly manual one-off sources", () => {
    assert.equal(isMarketingEmailSource("manual"), false);
    assert.equal(isMarketingEmailSource("staff"), false);
  });
});

describe("isTransactionalEmailSubject", () => {
  it("flags appointment confirmation subjects (Eric Smith case)", () => {
    assert.equal(
      isTransactionalEmailSubject(
        "Your Onsite Consultation Has Been Scheduled."
      ),
      true
    );
    assert.equal(
      isTransactionalEmailSubject("Appointment confirmation for Tuesday"),
      true
    );
    assert.equal(
      isTransactionalEmailSubject("Thanks for scheduling your free estimate"),
      true
    );
    assert.equal(
      isTransactionalEmailSubject("Reminder: your consultation tomorrow"),
      true
    );
  });

  it("keeps real marketing subjects", () => {
    assert.equal(
      isTransactionalEmailSubject("Summer promo: 20% off solar installs"),
      false
    );
    assert.equal(isTransactionalEmailSubject("Don't miss this week's tips"), false);
    assert.equal(isTransactionalEmailSubject(""), false);
    assert.equal(isTransactionalEmailSubject(null), false);
  });
});

describe("isTransactionalEmailContent", () => {
  it("flags confirmation body/snippet when subject is empty", () => {
    assert.equal(
      isTransactionalEmailContent(
        "Hi Eric, your onsite consultation has been scheduled for Tuesday."
      ),
      true
    );
    assert.equal(
      isTransactionalEmailContent(
        "<p>Thanks for booking your appointment. We look forward to meeting you.</p>"
      ),
      true
    );
    assert.equal(
      isTransactionalEmailContent("Don't miss this week's tips on solar"),
      false
    );
  });
});

describe("isOutboundMarketingTouchMessage", () => {
  it("rejects Eric-style empty-subject workflow confirmation (strict)", () => {
    const ericMsg = {
      type: "Email",
      direction: "outbound",
      source: "workflow",
      subject: "",
      body: "Your Onsite Consultation Has Been Scheduled. See you soon.",
      dateAdded: "2026-08-25T15:00:00.000Z",
    };
    assert.equal(
      isOutboundMarketingTouchMessage(ericMsg, { strict: true }),
      false
    );
  });

  it("rejects empty-subject workflow even without body text (strict)", () => {
    const msg = {
      messageType: "email",
      direction: "outgoing",
      source: "workflow",
      // GHL Conversations often omits subject entirely on workflow mail.
      snippet: "",
      dateAdded: "2026-08-25T15:00:00.000Z",
    };
    assert.equal(isOutboundMarketingTouchMessage(msg, { strict: true }), false);
  });

  it("rejects workflow with confirmation only in snippet/meta (strict)", () => {
    const msg = {
      type: 3,
      direction: "outbound",
      source: "automation",
      meta: {
        snippet: "Appointment confirmation for your free estimate visit.",
      },
      dateAdded: "2026-08-25T15:00:00.000Z",
    };
    assert.equal(isOutboundMarketingTouchMessage(msg, { strict: true }), false);
  });

  it("keeps real campaign / workflow marketing mail (strict)", () => {
    assert.equal(
      isOutboundMarketingTouchMessage(
        {
          type: "Email",
          direction: "outbound",
          source: "campaign",
          subject: "Three Details That Matter",
          dateAdded: "2026-08-25T12:00:00.000Z",
        },
        { strict: true }
      ),
      true
    );
    assert.equal(
      isOutboundMarketingTouchMessage(
        {
          type: "Email",
          direction: "outbound",
          source: "workflow",
          subject: "Solar tips for August",
          body: "Here are three ways to cut your bill this month.",
          dateAdded: "2026-08-24T12:00:00.000Z",
        },
        { strict: true }
      ),
      true
    );
  });

  it("rejects post-form workflow mail even with a non-transactional subject (form→email→booked)", () => {
    const msg = {
      type: "Email",
      direction: "outbound",
      source: "workflow",
      subject: "Thanks for reaching out",
      body: "We got your request and will be in touch.",
      dateAdded: "2026-08-25T16:00:00.000Z",
    };
    // Without form context this would look like marketing (non-empty subject).
    assert.equal(
      isOutboundMarketingTouchMessage(msg, { strict: true }),
      true
    );
    // With form fill earlier the same day: post-form automation, not a driver.
    assert.equal(
      isOutboundMarketingTouchMessage(msg, {
        strict: true,
        formFilledAt: "2026-08-25",
      }),
      false
    );
  });

  it("still counts campaign nurture after a form fill", () => {
    assert.equal(
      isOutboundMarketingTouchMessage(
        {
          type: "Email",
          direction: "outbound",
          source: "campaign",
          subject: "Three Details That Matter",
          dateAdded: "2026-08-26T12:00:00.000Z",
        },
        { strict: true, formFilledAt: "2026-08-25" }
      ),
      true
    );
  });

  it("still counts workflow marketing that arrived before the form fill", () => {
    assert.equal(
      isOutboundMarketingTouchMessage(
        {
          type: "Email",
          direction: "outbound",
          source: "workflow",
          subject: "Solar tips for August",
          body: "Here are three ways to cut your bill this month.",
          dateAdded: "2026-08-20T12:00:00.000Z",
        },
        { strict: true, formFilledAt: "2026-08-25" }
      ),
      true
    );
  });
});

describe("isPostFormWorkflowAutomation", () => {
  it("flags workflow/automation on or after form day", () => {
    assert.equal(
      isPostFormWorkflowAutomation("workflow", "2026-08-25", "2026-08-25"),
      true
    );
    assert.equal(
      isPostFormWorkflowAutomation("automation", "2026-08-26", "2026-08-25"),
      true
    );
    assert.equal(
      isPostFormWorkflowAutomation("workflow", "2026-08-24", "2026-08-25"),
      false
    );
    assert.equal(
      isPostFormWorkflowAutomation("campaign", "2026-08-26", "2026-08-25"),
      false
    );
    assert.equal(
      isPostFormWorkflowAutomation("workflow", "2026-08-26", null),
      false
    );
  });
});

describe("formFilledAtByContactId", () => {
  it("keeps the latest form day per contact", () => {
    assert.deepEqual(
      formFilledAtByContactId([
        {
          id: "form:a",
          contactId: "a",
          at: "2026-08-20",
          kind: "form_fill",
        },
        {
          id: "form:a2",
          contactId: "a",
          at: "2026-08-25",
          kind: "form_fill",
        },
        {
          id: "appt:a",
          contactId: "a",
          at: "2026-08-26",
          kind: "appointment",
        },
      ]),
      { a: "2026-08-25" }
    );
  });
});
