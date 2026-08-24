import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planLinks } from "../src/lib/ghl-tools";

test("planLinks exact-matches Ecoworkz even when the location has LLC", () => {
  const plan = planLinks(
    [
      { id: "c1", name: "Ecoworkz", ghl_location_id: "" },
      { id: "c2", name: "Humble Somm", ghl_location_id: "" },
    ],
    [
      { id: "loc-eco", name: "Ecoworkz LLC" },
      { id: "loc-humble", name: "Humble Somm" },
    ]
  );
  const eco = plan.proposals.find((p) => p.clientId === "c1");
  assert.ok(eco);
  assert.equal(eco?.locationId, "loc-eco");
  assert.equal(eco?.confidence, "exact");
});

test("applyExactLinkPlan writes unique matches and skips close ones", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-ghl-links-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const revenue = await import("../src/lib/revenue");
  const { planLinks: plan } = await import("../src/lib/ghl-tools");
  const { applyExactLinkPlan } = await import("../src/lib/ghl-links");

  const eco = revenue.createRevClient({
    name: "Ecoworkz",
    businessModel: "home_service",
  });
  const close = revenue.createRevClient({
    name: "BLuu",
    businessModel: "home_service",
  });

  const result = applyExactLinkPlan(
    plan(
      [
        { id: eco.id, name: "Ecoworkz", ghl_location_id: "" },
        { id: close.id, name: "BLuu", ghl_location_id: "" },
      ],
      [
        { id: "loc-eco", name: "Ecoworkz LLC" },
        { id: "loc-bluu", name: "BLuu Construction" },
      ]
    )
  );

  assert.equal(revenue.getRevClient(eco.id)?.ghl_location_id, "loc-eco");
  assert.equal(revenue.getRevClient(close.id)?.ghl_location_id, "");
  assert.equal(result.linked, 1);
  assert.deepEqual(result.names, ["Ecoworkz"]);
});
