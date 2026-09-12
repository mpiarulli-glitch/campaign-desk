import assert from "node:assert/strict";
import test from "node:test";
import {
  INTEGRATION_PROVIDERS,
  maskCredential,
  providerLabel,
} from "../src/lib/client-integrations";
import {
  clientHasCrmTracking,
  resolveCrmClientId,
} from "../src/lib/crm-conversion-analytics";

test("INTEGRATION_PROVIDERS covers Housecall Pro and HubSpot", () => {
  const ids = INTEGRATION_PROVIDERS.map((p) => p.id);
  assert.deepEqual(ids, ["housecall", "hubspot"]);
  assert.equal(providerLabel("housecall"), "Housecall Pro");
  assert.equal(providerLabel("hubspot"), "HubSpot");
});

test("maskCredential hides the middle of API credentials", () => {
  assert.equal(maskCredential("short"), "••••");
  assert.equal(maskCredential("pk_live_abcdefghijklmnop"), "pk_l••••mnop");
});

test("resolveCrmClientId returns null when nothing is linked", () => {
  assert.equal(resolveCrmClientId("missing-client", [], "housecall"), null);
  assert.equal(resolveCrmClientId("missing-client", [], "hubspot"), null);
  assert.equal(clientHasCrmTracking("missing-client", []), false);
});
