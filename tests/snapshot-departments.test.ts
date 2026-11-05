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

  await t.test("the editor always has every department, in order, with no items yet", () => {
    const notes = depts.departmentNotesForWeek(client.id, week);
    assert.deepEqual(
      notes.map((note) => note.label),
      [
        "Lifecycle Department",
        "Social Media Department",
        "Ads Department",
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
    assert.equal(depts.departmentNotesForWeek(client.id, week).length, 7);
  });

  await t.test("the Friday email and Basecamp post bullet only the filled departments", () => {
    depts.addDepartmentItem({
      clientId: client.id,
      weekStart: week,
      department: "ads",
      body: "Launched the retargeting set.",
    });
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
    assert.match(mail.html, /2 updates/);
    assert.match(mail.text, /Social Media Department · 2 updates/);
    assert.match(mail.text, /Ads Department · 1 update/);
    assert.match(mail.text, /- Launched the retargeting set\./);
    assert.match(mail.html, /border-left:3px solid #c48a00/);
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
    assert.match(card.body, /Ads Department/);
    assert.match(card.body, /<li>Launched the retargeting set\.<\/li>/);
    assert.match(card.body, /Web Department/);
    assert.doesNotMatch(card.body, /Lifecycle Department/);
    assert.doesNotMatch(card.body, /SEO Department/);
  });

  await t.test("a Basecamp item stays checked, and a typed item does not until marked done", () => {
    const checked = depts.addDepartmentItem({
      clientId: client.id,
      weekStart: week,
      department: "video",
      body: "Film the testimonial",
      completed: true,
      sourceKey: "todo:44",
    });
    assert.equal(checked?.completed, true);
    assert.equal(checked?.sourceKey, "todo:44");
    const typed = depts.addDepartmentItem({
      clientId: client.id,
      weekStart: week,
      department: "video",
      body: "Rough cut notes",
    });
    assert.equal(typed?.completed, false);
    const marked = depts.updateDepartmentItem({ itemId: typed!.id, completed: true });
    assert.equal(marked?.completed, true);
    const stored = depts
      .departmentNotesForWeek(client.id, week)
      .find((note) => note.department === "video");
    assert.deepEqual(
      stored?.items.map((item) => [item.body, item.completed]),
      [
        ["Film the testimonial", true],
        ["Rough cut notes", true],
      ]
    );

    const mail = cs.snapshotWeekCopy({
      departments: [
        {
          label: "Video Department",
          items: (stored?.items || []).map((item) => ({
            body: item.body,
            completed: item.completed,
          })),
        },
      ],
    });
    assert.match(mail.html, /&#10003;/);
    assert.match(mail.text, /✓ Film the testimonial/);
    assert.match(mail.text, /✓ Rough cut notes/);
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
      work: {
        departments: [
          {
            label: "Video Department",
            items: [{ body: "Film the testimonial", completed: true }],
          },
        ],
      },
    });
    assert.match(card.body, /&#10003; Film the testimonial/);

    const reworded = depts.updateDepartmentItem({
      itemId: checked!.id,
      body: "Filmed the customer testimonial",
    });
    assert.equal(reworded?.body, "Filmed the customer testimonial");
    assert.equal(reworded?.completed, true);
    assert.equal(reworded?.sourceKey, "todo:44");
    const after = depts
      .departmentNotesForWeek(client.id, week)
      .find((note) => note.department === "video");
    assert.equal(after?.items[0].sourceKey, "todo:44");
    assert.equal(after?.items[0].completed, true);
    const clientCopy = cs.snapshotWeekCopy({
      departments: [
        {
          label: "Video Department",
          items: (after?.items || []).map((item) => ({
            body: item.body,
            completed: item.completed,
          })),
        },
      ],
    });
    assert.match(clientCopy.text, /✓ Filmed the customer testimonial/);
    assert.doesNotMatch(clientCopy.text, /Film the testimonial/);
    assert.doesNotMatch(clientCopy.html, /todo:44/);
  });

  await t.test("another week does not reuse this week's items", () => {
    assert.equal(depts.filledDepartmentNotes(client.id, "2026-11-09").length, 0);
  });

  await t.test("moving keeps the text, check, Basecamp id, and sent badge", () => {
    const sent = depts.addDepartmentItem({
      clientId: client.id,
      weekStart: week,
      department: "lifecycle",
      body: "Move Mystery Discount",
      completed: false,
      sourceKey: "todo:mystery",
      mark: "sent",
    });
    const second = depts.addDepartmentItem({
      clientId: client.id,
      weekStart: week,
      department: "lifecycle",
      body: "Send the SMS blast",
      completed: true,
      sourceKey: "todo:sms",
    });
    const web = depts.addDepartmentItem({
      clientId: client.id,
      weekStart: week,
      department: "web",
      body: "Update the website hero",
      completed: true,
      sourceKey: "card:hero",
    });
    assert.equal(sent?.mark, "sent");
    assert.equal(
      depts.moveDepartmentItem({
        itemId: sent!.id,
        department: "web",
        beforeId: web!.id,
      })?.weekStart,
      week
    );
    const after = depts.departmentNotesForWeek(client.id, week);
    const webItems = after.find((note) => note.department === "web")!.items;
    const mystery = webItems.find((item) => item.id === sent!.id)!;
    const heroAt = webItems.findIndex((item) => item.id === web!.id);
    const mysteryAt = webItems.findIndex((item) => item.id === sent!.id);
    assert.ok(mysteryAt >= 0 && mysteryAt < heroAt);
    assert.equal(mystery.body, "Move Mystery Discount");
    assert.equal(mystery.completed, false);
    assert.equal(mystery.sourceKey, "todo:mystery");
    assert.equal(mystery.mark, "sent");
    assert.equal(
      after.find((note) => note.department === "lifecycle")!.items.some((item) => item.id === sent!.id),
      false
    );
    assert.equal(
      depts.moveDepartmentItem({
        itemId: second!.id,
        department: "lifecycle",
        beforeId: null,
      }) !== null,
      true
    );
    const lifecycle = depts
      .departmentNotesForWeek(client.id, week)
      .find((note) => note.department === "lifecycle")!;
    assert.equal(lifecycle.items[lifecycle.items.length - 1].id, second!.id);
    assert.equal(lifecycle.items[lifecycle.items.length - 1].completed, true);
    assert.equal(lifecycle.items[lifecycle.items.length - 1].sourceKey, "todo:sms");
  });
});
