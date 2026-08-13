import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Whether a client has an editorial calendar at all, which is what the "build
// this client's calendar" prompt hangs off. The distinction that matters is
// "nothing ever" versus "nothing in the month on screen": prompting somebody to
// start a calendar that is already full, because they paged into a quiet
// December, would be worse than saying nothing.

// The exact shape that broke this: an editorial import wrote each entry's
// description, hook, and CTA into production_brief instead of note. Under the old
// "brief is not empty" rule, a year of videos and SMS became camera shoots.
const EDITORIAL_TEXT_IN_BRIEF =
  "Description: Encourage viewers to interact with the video.\n" +
  "Hook/message: Place your finger on a logo\n" +
  "CTA: Join the Krak Circle\n" +
  "Source: August 2026 in Krak Boba Editorial Calendar 2026.xlsx";

// What an intake form or an admin edit actually stores.
const REAL_BRIEF = JSON.stringify({
  locations: "Main shop, 123 Example St",
  onsiteContactName: "Dana",
  powerAccess: "Yes, indoor outlets",
});

test("a production is told apart from content by the shape of its brief", async () => {
  const { isProductionBrief, parseProductionBrief } = await import(
    "../src/lib/production-brief"
  );

  // A real brief is machine-written JSON.
  assert.equal(isProductionBrief(REAL_BRIEF), true);
  assert.equal(parseProductionBrief(REAL_BRIEF)?.onsiteContactName, "Dana");

  // Freeform prose in the column is not a brief, however long it is.
  assert.equal(isProductionBrief(EDITORIAL_TEXT_IN_BRIEF), false);
  assert.equal(parseProductionBrief(EDITORIAL_TEXT_IN_BRIEF), null);

  assert.equal(isProductionBrief(""), false);
  assert.equal(isProductionBrief("   "), false);
  assert.equal(isProductionBrief(null), false);
  assert.equal(isProductionBrief(undefined), false);
  // Valid JSON that is not an object cannot pass as a brief.
  assert.equal(isProductionBrief('"just a string"'), false);
  assert.equal(isProductionBrief("[1,2,3]"), false);
  assert.equal(isProductionBrief("null"), false);
  assert.equal(isProductionBrief("42"), false);
  // Malformed JSON that merely starts like an object does not throw.
  assert.equal(isProductionBrief('{"unterminated": '), false);
  // An empty brief object is still a brief: the form was submitted.
  assert.equal(isProductionBrief("{}"), true);
});

test("a client's editorial calendar footprint", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-summary-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const { getDb, nowIso } = await import("../src/lib/db");
  const { clientCalendarSummary, createSend, cancelSend, updateSend } = await import(
    "../src/lib/calendar"
  );

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const client = (id: string) => {
    const now = nowIso();
    getDb()
      .prepare(`INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(id, `Client ${id}`, now, now);
    return id;
  };

  await t.test("a client with nothing has no calendar", () => {
    const id = client("sum_empty");
    const s = clientCalendarSummary(id);
    assert.equal(s.total, 0);
    assert.equal(s.productions, 0);
    assert.equal(s.firstDate, "");
    assert.equal(s.lastDate, "");
    assert.deepEqual(s.months, []);
  });

  await t.test("planned content counts, and reports the range and months", () => {
    const id = client("sum_full");
    createSend({ clientId: id, title: "September newsletter", sendDate: "2026-09-01" });
    createSend({ clientId: id, title: "Fall promo", sendDate: "2026-09-15" });
    createSend({ clientId: id, title: "November recap", sendDate: "2026-11-03" });

    const s = clientCalendarSummary(id);
    assert.equal(s.total, 3);
    assert.equal(s.firstDate, "2026-09-01");
    assert.equal(s.lastDate, "2026-11-03");
    // Only the months that hold something, so the UI can say "nothing in October"
    // and offer the nearest month that does.
    assert.deepEqual(s.months, ["2026-09", "2026-11"]);
  });

  await t.test("a client with only shoots still has no editorial calendar", () => {
    const id = client("sum_shoots");
    createSend({ clientId: id, title: "September shoot", sendDate: "2026-09-10", requestedByClient: true });
    const briefed = createSend({ clientId: id, title: "October shoot", sendDate: "2026-10-08" });
    updateSend(briefed.id, { productionBrief: REAL_BRIEF });

    const s = clientCalendarSummary(id);
    // The prompt to build a calendar must still appear: a booked shoot is
    // scheduling, not a plan for what to publish.
    assert.equal(s.total, 0);
    assert.equal(s.productions, 2);
    // Counted separately so the prompt can say so rather than claiming the
    // account is completely empty.
    assert.deepEqual(s.months, []);
  });

  await t.test("editorial prose in the brief column is still editorial", () => {
    const id = client("sum_prose");
    // Three imported content entries whose descriptions landed in the wrong
    // column. Every one of them counted as a production before, so this client
    // read as having no calendar while holding a full one.
    for (const [i, title] of ["VID #1 Pick a Number", "SMS: Tryouts", "VID #3 Slay"].entries()) {
      const send = createSend({ clientId: id, title, sendDate: `2026-08-0${i + 3}` });
      updateSend(send.id, { productionBrief: EDITORIAL_TEXT_IN_BRIEF });
    }

    const s = clientCalendarSummary(id);
    assert.equal(s.total, 3, "content is counted as content");
    assert.equal(s.productions, 0, "and not as camera shoots");
    assert.deepEqual(s.months, ["2026-08"]);
  });

  await t.test("a cancelled entry does not make an empty calendar look occupied", () => {
    const id = client("sum_cancelled");
    const send = createSend({ clientId: id, title: "Called off", sendDate: "2026-09-01" });
    assert.equal(clientCalendarSummary(id).total, 1);

    cancelSend(send.id, true);
    assert.equal(clientCalendarSummary(id).total, 0, "a called-off entry is not owed");

    // And uncancelling puts it back.
    cancelSend(send.id, false);
    assert.equal(clientCalendarSummary(id).total, 1);
  });

  await t.test("one client's calendar is not another's", () => {
    const mine = client("sum_mine");
    const other = client("sum_other");
    createSend({ clientId: mine, title: "Mine", sendDate: "2026-09-01" });

    assert.equal(clientCalendarSummary(mine).total, 1);
    assert.equal(clientCalendarSummary(other).total, 0);
  });

  await t.test("the footprint is not narrowed by asset type", async () => {
    // The summary answers a question about the account, so it must not be scoped
    // the way the month listing is: a viewer who only sees social work must not be
    // told to build a calendar already full of email.
    const id = client("sum_types");
    createSend({ clientId: id, title: "Email", sendDate: "2026-09-01", assetType: "email_campaign" });
    createSend({ clientId: id, title: "Post", sendDate: "2026-09-02", assetType: "social_post" });
    createSend({ clientId: id, title: "Blog", sendDate: "2026-09-03", assetType: "blog_post" });

    assert.equal(clientCalendarSummary(id).total, 3);
  });
});
