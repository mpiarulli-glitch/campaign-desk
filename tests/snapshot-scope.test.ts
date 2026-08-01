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
  const untagged = snapshot.createDeliverable({
    clientId: "cl_1", category: "Strategy", name: "Quarterly review", cadence: "",
  });

  await t.test("a team sees its own work plus anything untagged", () => {
    const seo = snapshot.listDeliverables("cl_1", { team: "seo" });
    const names = seo.map((d) => d.name).sort();
    assert.deepEqual(names, ["Blog posts", "Quarterly review"]);
    // The email team's work is not in there.
    assert.ok(!names.includes("Broadcast emails"));
  });

  await t.test("no team means everything, which is what admins get", () => {
    assert.equal(snapshot.listDeliverables("cl_1").length, 3);
    assert.equal(snapshot.listDeliverables("cl_1", { team: null }).length, 3);
  });

  await t.test("an untagged deliverable is visible to every team, not to none", () => {
    for (const team of ["email", "seo", "social", "web"]) {
      const seen = snapshot.listDeliverables("cl_1", { team }).map((d) => d.name);
      assert.ok(
        seen.includes("Quarterly review"),
        `${team} should still see the untagged deliverable`
      );
    }
  });

  await t.test("a team with nothing of its own still sees the untagged rows", () => {
    const web = snapshot.listDeliverables("cl_1", { team: "web" });
    assert.deepEqual(web.map((d) => d.name), ["Quarterly review"]);
  });

  await t.test("an unknown team slug is normalised to unassigned on write", () => {
    const bogus = snapshot.createDeliverable({
      clientId: "cl_1", category: "Ops", name: "Mystery task", cadence: "", team: "not-a-team",
    });
    assert.equal(bogus.team, "");
    // And therefore shows up for everyone rather than vanishing.
    assert.ok(
      snapshot.listDeliverables("cl_1", { team: "social" }).some((d) => d.name === "Mystery task")
    );
  });

  await t.test("the team can be changed, and cleared back to unassigned", () => {
    const moved = snapshot.updateDeliverable(blog.id, { team: "social" });
    assert.equal(moved!.team, "social");
    assert.ok(
      !snapshot.listDeliverables("cl_1", { team: "seo" }).some((d) => d.name === "Blog posts"),
      "SEO should no longer see it"
    );

    const cleared = snapshot.updateDeliverable(blog.id, { team: "" });
    assert.equal(cleared!.team, "");
    assert.ok(
      snapshot.listDeliverables("cl_1", { team: "seo" }).some((d) => d.name === "Blog posts"),
      "cleared means visible to everyone again"
    );
  });

  await t.test("updating another field leaves the team alone", () => {
    // undefined must mean "leave it", or editing a cadence would silently
    // untag the deliverable.
    const before = snapshot.getDeliverable(email.id)!.team;
    const after = snapshot.updateDeliverable(email.id, { cadence: "3 per month" })!;
    assert.equal(after.team, before);
    assert.equal(after.cadence, "3 per month");
  });

  await t.test("scoping does not resurrect soft-deleted deliverables", () => {
    snapshot.deleteDeliverable(untagged.id);
    for (const team of ["email", "seo", undefined]) {
      const seen = snapshot
        .listDeliverables("cl_1", team ? { team } : undefined)
        .map((d) => d.name);
      assert.ok(!seen.includes("Quarterly review"), "deleted rows stay gone");
    }
  });
});
