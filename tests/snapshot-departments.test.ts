import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("weekly snapshot department notes", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-snap-dept-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const revenue = await import("../src/lib/revenue");
  const depts = await import("../src/lib/snapshot-departments");
  const cs = await import("../src/lib/client-services");

  const client = revenue.createRevClient({
    name: "12 Volt Power",
    businessModel: "home_service",
  });
  const week = "2026-11-02";

  await t.test("the editor always has six departments, in order", () => {
    const notes = depts.departmentNotesForWeek(client.id, week);
    assert.deepEqual(
      notes.map((note) => note.label),
      [
        "Lifecycle Department",
        "Social Media Department",
        "Video Department",
        "Web Department",
        "SEO Department",
        "Strategy Department",
      ]
    );
    assert.equal(notes.every((note) => note.body === ""), true);
  });

  await t.test("a saved note comes back, and a blank one stays off the client list", () => {
    depts.saveDepartmentNote({
      clientId: client.id,
      weekStart: week,
      department: "social",
      body: "Posted three Reels.",
    });
    depts.saveDepartmentNote({
      clientId: client.id,
      weekStart: week,
      department: "seo",
      body: "   ",
    });
    depts.saveDepartmentNote({
      clientId: client.id,
      weekStart: week,
      department: "web",
      body: "Shipped the landing page.",
    });

    const filled = depts.filledDepartmentNotes(client.id, week);
    assert.deepEqual(
      filled.map((note) => note.department),
      ["social", "web"]
    );
    assert.equal(depts.departmentNotesForWeek(client.id, week).length, 6);

    depts.saveDepartmentNote({
      clientId: client.id,
      weekStart: week,
      department: "social",
      body: "Posted four Reels.",
    });
    assert.equal(
      depts.filledDepartmentNotes(client.id, week).find((note) => note.department === "social")?.body,
      "Posted four Reels."
    );
  });

  await t.test("the Friday email and Basecamp post include only filled departments", () => {
    const work = {
      wins: ["Booked the holiday shoot."],
      departments: depts.filledDepartmentNotes(client.id, week),
    };
    const mail = cs.weeklyAskEmail({
      client: revenue.getRevClient(client.id)!,
      am: null,
      ask: {
        month: "2026-10",
        monthLabel: "October 2026",
        unansweredLeads: [],
        revenueIn: true,
        revenueAmount: null,
      },
      link: "https://hub.example.com/snapshot/tok",
      work,
    });
    assert.match(mail.text, /Booked the holiday shoot/);
    assert.match(mail.text, /Social Media Department/);
    assert.match(mail.text, /Posted four Reels/);
    assert.match(mail.text, /Web Department/);
    assert.match(mail.html, /Shipped the landing page/);
    assert.doesNotMatch(mail.text, /Lifecycle Department/);
    assert.doesNotMatch(mail.text, /Video Department/);
    assert.doesNotMatch(mail.text, /SEO Department/);
    assert.doesNotMatch(mail.text, /Strategy Department/);
    assert.doesNotMatch(mail.text, /lead/i);

    const card = cs.weeklyAskMessageContent({
      ask: {
        month: "2026-10",
        monthLabel: "October 2026",
        unansweredLeads: [],
        revenueIn: true,
        revenueAmount: null,
      },
      link: "https://hub.example.com/snapshot/tok",
      mention: "@Pat",
      amLabel: "Cassidy",
      work,
    });
    assert.match(card.body, /Social Media Department/);
    assert.match(card.body, /Web Department/);
    assert.doesNotMatch(card.body, /Lifecycle Department/);
    assert.doesNotMatch(card.body, /SEO Department/);
  });

  await t.test("another week does not reuse this week's notes", () => {
    assert.equal(depts.filledDepartmentNotes(client.id, "2026-11-09").length, 0);
  });
});
