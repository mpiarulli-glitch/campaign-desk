import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { snapshotDepartmentScopeLine, snapshotScopeFromPayload } from "../src/lib/snapshot-department-list";
import { SNAPSHOT_DEPARTMENT_SEED } from "../src/lib/snapshot-department-seed";

test("snapshot department scope line", () => {
  assert.equal(snapshotDepartmentScopeLine(["video"]), "Showing your department: Video");
  assert.equal(
    snapshotDepartmentScopeLine(["social", "web"]),
    "Showing your departments: Social Media, Web"
  );
  assert.equal(snapshotDepartmentScopeLine([]), null);
  assert.deepEqual(snapshotScopeFromPayload({ filtered: true, departments: ["video"] }), {
    filtered: true,
    departments: ["video"],
    line: "Showing your department: Video",
  });
  assert.equal(snapshotScopeFromPayload({ filtered: true, departments: [] }).filtered, false);
  assert.equal(snapshotScopeFromPayload(null).filtered, false);
});

test("weekly snapshot department assignments", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-snap-dept-access-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const { closeDbForTests, getDb } = await import("../src/lib/db");
  const access = await import("../src/lib/snapshot-department-access");
  const depts = await import("../src/lib/snapshot-departments");
  const revenue = await import("../src/lib/revenue");
  const { SNAPSHOT_DEPARTMENT_SEED_KEY } = await import("../src/lib/snapshot-department-seed");
  const { subjectFor } = await import("../src/lib/access");

  t.after(() => closeDbForTests());

  const viewer = (slug: string) => subjectFor(slug);

  await t.test("the seed matches the roster, with Abel and Carlos on Video and SEO", () => {
    assert.deepEqual(
      SNAPSHOT_DEPARTMENT_SEED.map((entry) => `${entry.slug}:${entry.department}`),
      [
        "jack:video",
        "paula:video",
        "abel:video",
        "abel:seo",
        "carlos:video",
        "carlos:seo",
        "randi:social",
        "lana:social",
        "mike_hines:ads",
        "saqib:web",
        "roy:web",
        "cassidy:strategy",
        "jerald:strategy",
        "kyle_morris:strategy",
        "luis_romero:strategy",
      ]
    );
  });

  await t.test("known people land on the departments Michael named", () => {
    assert.deepEqual(access.assignedSnapshotDepartments("jack"), ["video"]);
    assert.deepEqual(access.assignedSnapshotDepartments("paula"), ["video"]);
    assert.deepEqual(access.assignedSnapshotDepartments("abel"), ["video", "seo"]);
    assert.deepEqual(access.assignedSnapshotDepartments("carlos"), ["video", "seo"]);
    assert.deepEqual(access.assignedSnapshotDepartments("randi"), ["social"]);
    assert.deepEqual(access.assignedSnapshotDepartments("lana"), ["social"]);
    assert.deepEqual(access.assignedSnapshotDepartments("mike_hines"), ["ads"]);
    assert.deepEqual(access.assignedSnapshotDepartments("saqib"), ["web"]);
    assert.deepEqual(access.assignedSnapshotDepartments("roy"), ["web"]);
    for (const slug of ["cassidy", "jerald", "kyle_morris", "luis_romero"]) {
      assert.deepEqual(access.assignedSnapshotDepartments(slug), ["strategy"], slug);
      assert.equal(access.visibleSnapshotDepartments(viewer(slug)), null, slug);
      assert.equal(access.canWriteSnapshotDepartment(viewer(slug), "video"), true, slug);
    }
    const seo = getDb()
      .prepare(
        `SELECT person FROM user_snapshot_departments WHERE department = 'seo' ORDER BY person`
      )
      .all() as Array<{ person: string }>;
    assert.deepEqual(
      seo.map((row) => row.person),
      ["abel", "carlos"]
    );
  });

  await t.test("people who are not on the roster stay out of the user list", () => {
    const rows = getDb()
      .prepare(`SELECT slug, label FROM users`)
      .all() as Array<{ slug: string; label: string }>;
    const haystack = rows.map((row) => `${row.slug} ${row.label}`.toLowerCase()).join("\n");
    for (const name of ["nathan", "zipagan", "samar", "naeem", "maroof"]) {
      assert.equal(haystack.includes(name), false, name);
    }
  });

  await t.test("everyone else has no department", () => {
    assert.deepEqual(
      access.usersWithoutSnapshotDepartment().map((row) => row.slug),
      ["kyle_onstott", "michael", "sylvia"]
    );
  });

  await t.test("the owner and Friday-send account managers see every department", () => {
    const owner = { role: "admin" as const, person: null, owner: true };
    assert.equal(access.visibleSnapshotDepartments(owner), null);
    assert.equal(access.canWriteSnapshotDepartment(owner, "seo"), true);
    for (const slug of ["cassidy", "kyle_morris", "luis_romero", "jerald"]) {
      access.setSnapshotDepartments(slug, ["video"], "michael");
      assert.equal(access.visibleSnapshotDepartments(viewer(slug)), null, slug);
      assert.equal(access.canWriteSnapshotDepartment(viewer(slug), "strategy"), true, slug);
    }
  });

  await t.test("a person with no department still sees every section", () => {
    assert.equal(access.visibleSnapshotDepartments(viewer("sylvia")), null);
    assert.equal(access.canWriteSnapshotDepartment(viewer("sylvia"), "ads"), true);
    assert.equal(access.visibleSnapshotDepartments(viewer("kyle_onstott")), null);
  });

  await t.test("a specialist can write only their departments", () => {
    assert.deepEqual(access.visibleSnapshotDepartments(viewer("jack")), ["video"]);
    assert.equal(access.canWriteSnapshotDepartment(viewer("jack"), "video"), true);
    assert.equal(access.canWriteSnapshotDepartment(viewer("jack"), "seo"), false);
    assert.deepEqual(access.visibleSnapshotDepartments(viewer("abel")), ["video", "seo"]);
    assert.deepEqual(access.visibleSnapshotDepartments(viewer("carlos")), ["video", "seo"]);
    assert.equal(access.canWriteSnapshotDepartment(viewer("carlos"), "video"), true);
    assert.equal(access.canWriteSnapshotDepartment(viewer("carlos"), "seo"), true);
    assert.equal(access.canWriteSnapshotDepartment(viewer("carlos"), "web"), false);
    assert.equal(access.canWriteSnapshotDepartment(viewer("roy"), "web"), true);
    assert.equal(access.canWriteSnapshotDepartment(viewer("roy"), "video"), false);
    assert.deepEqual(access.visibleSnapshotDepartments(viewer("randi")), ["social"]);
    assert.deepEqual(access.visibleSnapshotDepartments(viewer("mike_hines")), ["ads"]);
    access.setSnapshotDepartments("roy", ["web", "seo"], "michael");
    assert.deepEqual(access.visibleSnapshotDepartments(viewer("roy")), ["web", "seo"]);
    assert.equal(access.canWriteSnapshotDepartment(viewer("roy"), "seo"), true);
    assert.equal(access.canWriteSnapshotDepartment(viewer("roy"), "ads"), false);
  });

  await t.test("clearing a department is not restored on the next boot", () => {
    access.setSnapshotDepartments("jack", [], "michael");
    closeDbForTests();
    assert.deepEqual(access.assignedSnapshotDepartments("jack"), []);
    assert.equal(access.visibleSnapshotDepartments(viewer("jack")), null);
  });

  await t.test("a seed row that has not been applied yet is filled on the next boot", () => {
    const db = getDb();
    const raw = db
      .prepare(`SELECT value FROM app_settings WHERE key = ?`)
      .get(SNAPSHOT_DEPARTMENT_SEED_KEY) as { value: string };
    const keys = (JSON.parse(raw.value) as string[]).filter((key) => key !== "paula:video");
    db.prepare(`DELETE FROM user_snapshot_departments WHERE person = 'paula'`).run();
    db.prepare(`UPDATE app_settings SET value = ? WHERE key = ?`).run(
      JSON.stringify(keys),
      SNAPSHOT_DEPARTMENT_SEED_KEY
    );
    closeDbForTests();
    assert.deepEqual(access.assignedSnapshotDepartments("paula"), ["video"]);
  });

  await t.test("hiding a department on the desk leaves the saved item in place", () => {
    access.setSnapshotDepartments("jack", ["video"], "michael");
    const client = revenue.createRevClient({
      name: "Harbor Fixture",
      businessModel: "home_service",
    });
    const week = "2026-11-09";
    depts.addDepartmentItem({
      clientId: client.id,
      weekStart: week,
      department: "lifecycle",
      body: "Sent the welcome flow.",
    });
    depts.addDepartmentItem({
      clientId: client.id,
      weekStart: week,
      department: "video",
      body: "Cut the spring testimonial.",
    });
    const filled = depts.filledDepartmentNotes(client.id, week).map((note) => note.department);
    assert.deepEqual(filled, ["lifecycle", "video"]);
    const jackNotes = access.filterDepartmentNotesForViewer(
      depts.departmentNotesForWeek(client.id, week),
      viewer("jack")
    );
    assert.deepEqual(
      jackNotes.map((note) => note.department),
      ["video"]
    );
    assert.equal(jackNotes[0]?.items[0]?.body, "Cut the spring testimonial.");
    const stored = depts.departmentNotesForWeek(client.id, week);
    assert.equal(
      stored.find((note) => note.department === "lifecycle")?.items[0]?.body,
      "Sent the welcome flow."
    );
  });

  await t.test("an unknown department is refused", () => {
    assert.throws(
      () => access.setSnapshotDepartments("roy", ["email"], "michael"),
      /weekly snapshot list/
    );
  });
});
