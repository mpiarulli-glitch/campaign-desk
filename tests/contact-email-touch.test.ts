import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isMarketingEmailSource,
  isOutboundEmailMessage,
  isOutboundMarketingTouchMessage,
  isPostFormWorkflowAutomation,
  isTransactionalEmailContent,
  isTransactionalEmailSubject,
  outboundEmailIsBefore,
  formFilledAtByContactId,
  marketingEmailWasOpened,
  countsAsOpenedMarketingEmail,
  openedMarketingEmailLabel,
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

  it("rejects empty-subject workflow/automation without body in strict mode (Eric case)", () => {
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

  it("allows empty-subject workflow when bodyHint is substantial (GHL omits subject)", () => {
    assert.equal(
      isMarketingEmailSource("workflow", {
        strict: true,
        subject: "",
        bodyHint:
          "Here are three ways to cut your summer energy bill this month.",
      }),
      true
    );
    assert.equal(
      isMarketingEmailSource("workflow", {
        strict: true,
        subject: "",
        bodyHint: "short",
      }),
      false
    );
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

  it("does not flag nurture copy that merely mentions booking tips", () => {
    assert.equal(
      isTransactionalEmailContent(
        "Thanks for these booking tips: three ways to prep your home before we arrive."
      ),
      false
    );
  });

  it("still flags thanks-for-booking-your-appointment confirmations", () => {
    assert.equal(
      isTransactionalEmailContent(
        "Thanks for booking your appointment. We look forward to meeting you."
      ),
      true
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

  it("keeps empty-subject workflow nurture with non-transactional body (strict)", () => {
    const msg = {
      type: "Email",
      direction: "outbound",
      source: "workflow",
      subject: "",
      body: "Here are three ways to cut your summer energy bill this month with better insulation.",
      dateAdded: "2026-08-24T12:00:00.000Z",
    };
    assert.equal(isOutboundMarketingTouchMessage(msg, { strict: true }), true);
  });

  it("still rejects Eric-style empty-subject confirmation even with long transactional body", () => {
    const msg = {
      type: "Email",
      direction: "outbound",
      source: "workflow",
      subject: "",
      body: "Hi Eric, your onsite consultation has been scheduled for Tuesday at 2pm. We look forward to meeting you at the property.",
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

describe("opened marketing email before a form", () => {
  const openedCampaign = {
    type: "Email",
    direction: "outbound",
    source: "campaign",
    status: "opened",
    subject: "What a Bad Gutter Actually Costs",
    dateAdded: "2026-09-20T15:00:00.000Z",
  };

  it("counts an opened marketing email inside the 5 days before the form", () => {
    assert.equal(
      countsAsOpenedMarketingEmail(openedCampaign, "2026-09-23T18:00:00.000Z"),
      true
    );
  });

  it("does not count a marketing email that was only delivered", () => {
    assert.equal(
      countsAsOpenedMarketingEmail(
        { ...openedCampaign, status: "delivered" },
        "2026-09-23T18:00:00.000Z"
      ),
      false
    );
    assert.equal(marketingEmailWasOpened({ status: "sent" }), false);
    assert.equal(marketingEmailWasOpened({ status: "delivered" }), false);
    assert.equal(marketingEmailWasOpened({ status: "read" }), true);
    assert.equal(marketingEmailWasOpened({ status: "clicked" }), true);
    assert.equal(marketingEmailWasOpened({ events: { opened: 1 } }), true);
  });

  it("does not count an open more than 5 days before the form", () => {
    assert.equal(
      countsAsOpenedMarketingEmail(
        { ...openedCampaign, dateAdded: "2026-09-10T15:00:00.000Z" },
        "2026-09-23T18:00:00.000Z"
      ),
      false
    );
  });

  it("does not count an open after the form", () => {
    assert.equal(
      countsAsOpenedMarketingEmail(
        { ...openedCampaign, dateAdded: "2026-09-23T19:00:00.000Z" },
        "2026-09-23T18:00:00.000Z"
      ),
      false
    );
  });

  it("does not count an opened manual email", () => {
    assert.equal(
      countsAsOpenedMarketingEmail(
        { ...openedCampaign, source: "manual" },
        "2026-09-23T18:00:00.000Z"
      ),
      false
    );
  });

  it("does not count an opened appointment confirmation", () => {
    assert.equal(
      countsAsOpenedMarketingEmail(
        {
          ...openedCampaign,
          source: "workflow",
          subject: "Your Onsite Consultation Has Been Scheduled.",
        },
        "2026-09-23T18:00:00.000Z"
      ),
      false
    );
  });

  it("never uses an HTML body or tracking URL as the label", () => {
    assert.equal(
      openedMarketingEmailLabel(
        "[https://storage.googleapis.com/msgsndr/abc View this email"
      ),
      "Opened marketing email"
    );
    assert.equal(
      openedMarketingEmailLabel("What a Bad Gutter Actually Costs"),
      "What a Bad Gutter Actually Costs"
    );
    assert.equal(openedMarketingEmailLabel(""), "Opened marketing email");
  });
});

describe("outbound email before the form", () => {
  it("counts any outbound email message", () => {
    assert.equal(
      isOutboundEmailMessage({
        messageType: "TYPE_EMAIL",
        direction: "outbound",
        body: "View this email in browser https://link.msgsndr.co/x",
      }),
      true
    );
    assert.equal(
      isOutboundEmailMessage({
        messageType: "TYPE_EMAIL",
        direction: "inbound",
      }),
      false
    );
  });

  it("requires the email to land before a timed form fill", () => {
    assert.equal(
      outboundEmailIsBefore(
        "2026-10-13T15:00:00.000Z",
        "2026-10-13T18:00:00.000Z"
      ),
      true
    );
    assert.equal(
      outboundEmailIsBefore(
        "2026-10-13T19:00:00.000Z",
        "2026-10-13T18:00:00.000Z"
      ),
      false
    );
    assert.equal(
      outboundEmailIsBefore("2026-10-13T19:00:00.000Z", "2026-10-13"),
      true
    );
  });
});
