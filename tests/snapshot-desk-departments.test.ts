import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("the desk shows every department to a specialist", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-snap-desk-dept-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const { closeDbForTests } = await import("../src/lib/db");
  const revenue = await import("../src/lib/revenue");
  const enrollment = await import("../src/lib/snapshot-enrollment");
  const snapshot = await import("../src/lib/snapshot");
  const depts = await import("../src/lib/snapshot-departments");
  const fill = await import("../src/lib/snapshot-fill");
  const { SnapshotWeekDepartments } = await import("../src/components/SnapshotWeekDepartments");

  t.after(() => closeDbForTests());

  const client = revenue.createRevClient({
    name: "Ecoworkz",
    businessModel: "home_service",
  });
  enrollment.enrollSnapshotClient(client.id, "roy");
  snapshot.createDeliverable({
    clientId: client.id,
    category: "Email",
    name: "Weekly newsletter",
    cadence: "Weekly",
    team: "email",
  });
  const week = "2026-11-02";
  const roy = { role: "forecast" as const, person: "roy", owner: false };

  await t.test("a web specialist is not an admin and is focused on web", () => {
    assert.equal(roy.role, "forecast");
    assert.equal(fill.fillFocusTeam(roy), "web");
    assert.equal(fill.fillIsAccountManager(roy), false);
  });

  await t.test("the team slice hides this account, and the desk roster does not", () => {
    const webRows = snapshot.weekDesk(week, { team: "web" });
    assert.equal(
      webRows.some((row) => row.client_id === client.id),
      false
    );
    const accounts = snapshot.listSnapshotDeskAccounts();
    assert.ok(accounts.some((account) => account.id === client.id));
  });

  await t.test("every department slug, including an empty Ads list, is returned", () => {
    const notes = depts.departmentNotesForWeek(client.id, week);
    assert.deepEqual(
      notes.map((note) => note.department),
      ["lifecycle", "social", "ads", "video", "web", "seo", "strategy"]
    );
    const ads = notes.find((note) => note.department === "ads");
    assert.ok(ads);
    assert.equal(ads.items.length, 0);
    assert.equal(ads.label, "Ads Department");
    assert.equal(
      depts.filledDepartmentNotes(client.id, week).some((note) => note.department === "ads"),
      false
    );
  });

  await t.test("the editor renders every section, including the empty Ads field", () => {
    const html = renderToStaticMarkup(
      createElement(SnapshotWeekDepartments, { clientId: client.id, weekStart: week })
    );
    for (const label of [
      "Lifecycle Department",
      "Social Media Department",
      "Ads Department",
      "Video Department",
      "Web Department",
      "SEO Department",
      "Strategy Department",
    ]) {
      assert.match(html, new RegExp(label));
    }
    assert.match(html, /Ads Department: add an item/);
    assert.doesNotMatch(html, /From Basecamp/);
    assert.doesNotMatch(html, /<strong>Unsorted<\/strong>/);
  });

  await t.test("a video member's editor shows Video and leaves the other sections out", () => {
    const html = renderToStaticMarkup(
      createElement(SnapshotWeekDepartments, {
        clientId: client.id,
        weekStart: week,
        visibleDepartments: ["video"],
      })
    );
    assert.match(html, /Video Department/);
    assert.match(html, /Video Department: add an item/);
    assert.doesNotMatch(html, /From Basecamp/);
    assert.doesNotMatch(html, /<strong>Unsorted<\/strong>/);
    for (const label of [
      "Lifecycle Department",
      "Social Media Department",
      "Ads Department",
      "Web Department",
      "SEO Department",
      "Strategy Department",
    ]) {
      assert.equal(html.includes(label), false, label);
    }
  });

  await t.test("Abel and Carlos see Video and SEO, and no other section", () => {
    const html = renderToStaticMarkup(
      createElement(SnapshotWeekDepartments, {
        clientId: client.id,
        weekStart: week,
        visibleDepartments: ["video", "seo"],
      })
    );
    assert.match(html, /Video Department/);
    assert.match(html, /SEO Department/);
    for (const label of [
      "Lifecycle Department",
      "Social Media Department",
      "Ads Department",
      "Web Department",
      "Strategy Department",
    ]) {
      assert.equal(html.includes(label), false, label);
    }
  });
});
