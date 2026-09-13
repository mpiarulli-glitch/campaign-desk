import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDiscoveryMeeting } from "../src/lib/ghl-conversion-analytics";

describe("isDiscoveryMeeting", () => {
  it("matches discovery in calendar name", () => {
    assert.equal(
      isDiscoveryMeeting({ calendarName: "MEG Discovery Call", title: null }),
      true
    );
  });

  it("matches discovery in event title", () => {
    assert.equal(
      isDiscoveryMeeting({ calendarName: "Sales", title: "Discovery Meeting" }),
      true
    );
  });

  it("rejects non-discovery meetings", () => {
    assert.equal(
      isDiscoveryMeeting({
        calendarName: "Client Kickoff",
        title: "Onboarding call",
      }),
      false
    );
  });

  it("does not match partial words", () => {
    assert.equal(
      isDiscoveryMeeting({ calendarName: "Rediscovery Workshop", title: null }),
      false
    );
  });
});
