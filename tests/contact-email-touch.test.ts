import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isMarketingEmailSource } from "../src/lib/ghl-contact-email-touch";

describe("isMarketingEmailSource", () => {
  it("treats unknown/empty source as eligible", () => {
    assert.equal(isMarketingEmailSource(null), true);
    assert.equal(isMarketingEmailSource(""), true);
  });

  it("accepts campaign and workflow sources", () => {
    assert.equal(isMarketingEmailSource("campaign"), true);
    assert.equal(isMarketingEmailSource("workflow"), true);
    assert.equal(isMarketingEmailSource("bulk_email"), true);
  });

  it("rejects clearly manual one-off sources", () => {
    assert.equal(isMarketingEmailSource("manual"), false);
    assert.equal(isMarketingEmailSource("staff"), false);
  });
});
