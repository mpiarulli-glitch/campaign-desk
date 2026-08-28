import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Scoping the weekly snapshot to a team. The behaviour that matters is what a
// person sees, so this exercises listDeliverables against a real table rather
// than testing the map in isolation.

test("weekly snapshot scoped to a team", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-snap-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const snapshot = await import("../src/lib/snapshot");
  const { getDb, nowIso } = await import("../src/lib/db");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const now = nowIso();
  getDb()
    .prepare(`INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run("cl_1", "Humble Somm", now, now);

  const email = snapshot.createDeliverable({
    clientId: "cl_1", category: "Email", name: "Broadcast emails", cadence: "2 per month", team: "email",
  });
  const blog = snapshot.createDeliverable({
    clientId: "cl_1", category: "SEO", name: "Blog posts", cadence: "4 per month", team: "seo",
  });
  snapshot.createDeliverable({
    clientId: "cl_1", category: "Strategy", name: "Quarterly review", cadence: "",
  });
  snapshot.createDeliverable({
    clientId: "cl_1", category: "Social", name: "Instagram posts", cadence: "12 per month",
  });
  snapshot.createDeliverable({
    clientId: "cl_1", category: "", name: "LinkedIn outreach", cadence: "weekly",
  });
  snapshot.createDeliverable({
    clientId: "cl_1", category: "SMS", name: "Appointment reminders", cadence: "as needed",
  });
  snapshot.createDeliverable({
    clientId: "cl_1", category: "Ops", name: "Mystery task", cadence: "",
  });

  snapshot.createDeliverable({
    clientId: "cl_1", category: "Onboarding", name: "Kickoff call", cadence: "",
  });
  snapshot.createDeliverable({
    clientId: "cl_1", category: "Web", name: "Landing page updates", cadence: "as needed",
  });

  await t.test("SEO sees SEO work, not strategy or another team's untagged rows", () => {
    const names = snapshot.listDeliverables("cl_1", { team: "seo" }).map((d) => d.name).sort();
    assert.deepEqual(names, ["Blog posts"]);
  });

  await t.test("social sees social media and video, not LinkedIn outreach or blogs", () => {
    const names = snapshot.listDeliverables("cl_1", { team: "social" }).map((d) => d.name).sort();
    assert.deepEqual(names, ["Instagram posts"]);
  });

  await t.test("email sees tagged email, SMS, and LinkedIn outreach", () => {
    const names = snapshot.listDeliverables("cl_1", { team: "email" }).map((d) => d.name).sort();
    assert.deepEqual(names, ["Appointment reminders", "Broadcast emails", "LinkedIn outreach"]);
  });

  await t.test("strategy and untagged mysteries stay on the unscoped AM list", () => {
    const all = snapshot.listDeliverables("cl_1").map((d) => d.name);
    assert.ok(all.includes("Quarterly review"));
    assert.ok(all.includes("Mystery task"));
    assert.equal(snapshot.listDeliverables("cl_1", { team: null }).length, 9);
    const web = snapshot.listDeliverables("cl_1", { team: "web" }).map((d) => d.name);
    assert.deepEqual(web, ["Landing page updates"]);
    const onboard = snapshot.listDeliverables("cl_1", { team: "onboarding" }).map((d) => d.name);
    assert.deepEqual(onboard, ["Kickoff call"]);
  });

  await t.test("an unknown team slug is normalised to unassigned on write", () => {
    const bogus = snapshot.createDeliverable({
      clientId: "cl_1", category: "Ops", name: "Second mystery", cadence: "", team: "not-a-team",
    });
    assert.equal(bogus.team, "");
    assert.ok(
      !snapshot.listDeliverables("cl_1", { team: "social" }).some((d) => d.name === "Second mystery"),
      "specialists do not inherit untagged mysteries"
    );
    assert.ok(
      snapshot.listDeliverables("cl_1").some((d) => d.name === "Second mystery"),
      "account managers still see the row so it gets filled"
    );
  });

  await t.test("the team can be changed, and clearing falls back to inference", () => {
    const moved = snapshot.updateDeliverable(blog.id, { team: "social" });
    assert.equal(moved!.team, "social");
    assert.ok(
      !snapshot.listDeliverables("cl_1", { team: "seo" }).some((d) => d.name === "Blog posts"),
      "SEO should no longer see a row tagged social"
    );
    assert.ok(
      snapshot.listDeliverables("cl_1", { team: "social" }).some((d) => d.name === "Blog posts")
    );

    const cleared = snapshot.updateDeliverable(blog.id, { team: "" });
    assert.equal(cleared!.team, "");
    assert.ok(
      snapshot.listDeliverables("cl_1", { team: "seo" }).some((d) => d.name === "Blog posts"),
      "untagged Blog posts still infer as SEO"
    );
    assert.ok(
      !snapshot.listDeliverables("cl_1", { team: "social" }).some((d) => d.name === "Blog posts"),
      "social does not inherit an untagged SEO row"
    );
  });

  await t.test("updating another field leaves the team alone", () => {
    const before = snapshot.getDeliverable(email.id)!.team;
    const after = snapshot.updateDeliverable(email.id, { cadence: "3 per month" })!;
    assert.equal(after.team, before);
    assert.equal(after.cadence, "3 per month");
  });

  await t.test("scoping does not resurrect soft-deleted deliverables", () => {
    snapshot.deleteDeliverable(
      snapshot.listDeliverables("cl_1").find((d) => d.name === "Quarterly review")!.id
    );
    for (const team of ["email", "seo", undefined] as const) {
      const seen = snapshot
        .listDeliverables("cl_1", team ? { team } : undefined)
        .map((d) => d.name);
      assert.ok(!seen.includes("Quarterly review"), "deleted rows stay gone");
    }
  });
});
