import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("adding a snapshot client links a match and checks Basecamp", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-snap-add-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  const { closeDbForTests } = await import("../src/lib/db");
  closeDbForTests();
  const revenue = await import("../src/lib/revenue");
  const enrollment = await import("../src/lib/snapshot-enrollment");
  const add = await import("../src/lib/snapshot-add-client");

  t.after(() => {
    closeDbForTests();
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const names = new Map<string, string>([["47628800", "Hendo"]]);

  await t.test("a project URL is reduced to the project id", () => {
    assert.equal(
      add.snapshotProjectId("https://3.basecamp.com/5338018/projects/47628800"),
      "47628800"
    );
    assert.equal(
      add.snapshotProjectId("https://3.basecamp.com/5338018/buckets/47628800/todosets/1"),
      "47628800"
    );
    assert.equal(add.snapshotProjectId("47628800"), "47628800");
    assert.equal(add.snapshotProjectId("not a project"), "");
  });

  await t.test("a missing project is an inline error and nothing is created", async () => {
    const result = await add.addSnapshotClient(
      {
        name: "New Co",
        contactName: "Pat Lee",
        email: "pat@new.co",
        phone: "4155550134",
        basecampProjectId: "999",
      },
      async () => ""
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.field, "basecampProjectId");
    assert.match(result.error, /not found/);
    assert.equal(revenue.listRevClients(true).length, 0);
  });

  await t.test("a new business is created, enrolled, and confirmed by project name", async () => {
    const result = await add.addSnapshotClient(
      {
        name: "Hendo",
        contactName: "Alex Kim",
        email: "alex@hendo.test",
        phone: "(415) 555-0199",
        basecampProjectId: "https://3.basecamp.com/5338018/buckets/47628800",
        enrolledBy: "cassidy",
      },
      async (id) => names.get(id) || ""
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.linked, false);
    assert.equal(result.projectName, "Hendo");
    const saved = revenue.getRevClient(result.clientId)!;
    assert.equal(saved.name, "Hendo");
    assert.equal(saved.contact_name, "Alex Kim");
    assert.equal(saved.contact_email, "alex@hendo.test");
    assert.equal(saved.basecamp_project_id, "47628800");
    assert.equal(saved.poc, "Alex Kim");
    assert.equal(enrollment.isSnapshotEnrolled(result.clientId), true);
  });

  await t.test("the same project id links the existing client", async () => {
    const before = revenue.listRevClients(true).length;
    const result = await add.addSnapshotClient(
      {
        name: "Hendo Again",
        contactName: "Alex Kim",
        email: "alex@hendo.test",
        phone: "4155550199",
        basecampProjectId: "47628800",
      },
      async (id) => names.get(id) || ""
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.linked, true);
    assert.equal(revenue.listRevClients(true).length, before);
  });

  await t.test("a phone without an area code is refused", async () => {
    const result = await add.addSnapshotClient(
      {
        name: "Other Co",
        contactName: "Sam",
        email: "sam@other.test",
        phone: "555",
        basecampProjectId: "47628800",
      },
      async (id) => names.get(id) || ""
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.field, "phone");
  });
});
