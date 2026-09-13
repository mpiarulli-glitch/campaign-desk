import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isMarketingEmailSource,
  isTransactionalEmailSubject,
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
    assert.equal(isMarketingEmailSource("workflow", { strict: true }), true);
    assert.equal(isMarketingEmailSource("bulk_email"), true);
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
