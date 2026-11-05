import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("weekly snapshot department items", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-snap-dept-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const { getDb, nowIso } = await import("../src/lib/db");
  const revenue = await import("../src/lib/revenue");
  const depts = await import("../src/lib/snapshot-departments");
  const cs = await import("../src/lib/client-services");

  const client = revenue.createRevClient({
    name: "12 Volt Power",
    businessModel: "home_service",
  });
  const week = "2026-11-02";

  await t.test("the editor always has six departments, in order, with no items yet", () => {
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
    assert.equal(notes.every((note) => note.items.length === 0), true);
  });

  await t.test("a legacy single note becomes one list item and is not copied again", () => {
    const now = nowIso();
    getDb()
      .prepare(
        `INSERT INTO snapshot_department_notes
           (id, client_id, week_start, department, body, logged_by, created_at, updated_at, migrated)
         VALUES (?, ?, ?, 'seo', ?, '', ?, ?, 0)`
      )
      .run("legacy-seo", client.id, week, "  Fixed three title tags.  ", now, now);
    const first = depts.departmentNotesForWeek(client.id, week);
    const seo = first.find((note) => note.department === "seo");
    assert.equal(seo?.items.length, 1);
    assert.equal(seo?.items[0].body, "Fixed three title tags.");
    depts.deleteDepartmentItem(seo!.items[0].id);
    const again = depts.departmentNotesForWeek(client.id, week);
    assert.equal(again.find((note) => note.department === "seo")?.items.length, 0);
  });

  await t.test("items stay in the order they were added, and blanks are refused", () => {
    assert.equal(
      depts.addDepartmentItem({
        clientId: client.id,
        weekStart: week,
        department: "social",
        body: "   ",
      }),
      null
    );
    depts.addDepartmentItem({
      clientId: client.id,
      weekStart: week,
      department: "social",
      body: "Posted three Reels.",
    });
    depts.addDepartmentItem({
      clientId: client.id,
      weekStart: week,
      department: "social",
      body: "Replied to comments.",
    });
    depts.addDepartmentItem({
      clientId: client.id,
      weekStart: week,
      department: "web",
      body: "Shipped the landing page.",
    });
    const social = depts
      .departmentNotesForWeek(client.id, week)
      .find((note) => note.department === "social");
    assert.deepEqual(
      social?.items.map((item) => item.body),
      ["Posted three Reels.", "Replied to comments."]
    );

    const edited = depts.updateDepartmentItem({
      itemId: social!.items[0].id,
      body: "Posted four Reels.",
    });
    assert.equal(edited?.body, "Posted four Reels.");
    assert.equal(depts.updateDepartmentItem({ itemId: social!.items[1].id, body: "  " }), null);

    const filled = depts.filledDepartmentNotes(client.id, week);
    assert.deepEqual(
      filled.map((note) => note.department),
      ["social", "web"]
    );
    assert.equal(depts.departmentNotesForWeek(client.id, week).length, 6);
  });

  await t.test("the Friday email and Basecamp post bullet only the filled departments", () => {
    const work = {
      wins: ["Booked the holiday shoot."],
      departments: depts.filledDepartmentNotes(client.id, week).map((note) => ({
        label: note.label,
        items: note.items.map((item) => item.body),
      })),
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
    assert.match(mail.text, /- Posted four Reels\./);
    assert.match(mail.text, /- Replied to comments\./);
    assert.match(mail.html, /<ul/);
    assert.match(mail.html, /<li/);
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
    assert.match(card.body, /<ul>/);
    assert.match(card.body, /<li>Posted four Reels\.<\/li>/);
    assert.match(card.body, /Social Media Department/);
    assert.match(card.body, /Web Department/);
    assert.doesNotMatch(card.body, /Lifecycle Department/);
    assert.doesNotMatch(card.body, /SEO Department/);
  });

  await t.test("another week does not reuse this week's items", () => {
    assert.equal(depts.filledDepartmentNotes(client.id, "2026-11-09").length, 0);
  });
});
