import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Importing a client's editorial calendar spreadsheet. The behaviour that matters
// is what lands on the calendar, so the apply tests run against a real table
// rather than mocking the writes.

test("CSV parsing survives what spreadsheets actually export", async () => {
  const { parseCsv, sniffDelimiter, mapColumns } = await import("../src/lib/csv");

  const quoted = parseCsv('Date,Title\n2026-09-01,"Sale, part two"\n');
  assert.deepEqual(quoted[1], ["2026-09-01", "Sale, part two"]);

  const escaped = parseCsv('Date,Title\n2026-09-01,"He said ""go"" today"\n');
  assert.equal(escaped[1][1], 'He said "go" today');

  const embeddedNewline = parseCsv('Title,Note\nLaunch,"line one\nline two"\n');
  assert.equal(embeddedNewline[1][1], "line one\nline two");

  // Excel's UTF-8 BOM must not become part of the first header.
  const withBom = parseCsv("﻿Date,Title\n2026-09-01,Launch\n");
  assert.equal(withBom[0][0], "Date");

  assert.deepEqual(parseCsv("A,B\r\n1,2\r\n")[1], ["1", "2"]);

  // Padding rows at the bottom of an export are dropped, not returned as data.
  assert.equal(parseCsv("Date,Title\n2026-09-01,Launch\n,\n,\n").length, 2);

  assert.equal(sniffDelimiter("Date;Title;Time"), ";");
  // A comma inside a quoted header must not win the delimiter vote.
  assert.equal(sniffDelimiter('"Title, long";Date'), ";");
  assert.deepEqual(parseCsv("Date;Title\n2026-09-01;Launch\n")[1], ["2026-09-01", "Launch"]);

  const cols = mapColumns(["Send Date", "Campaign Name", "Channel"], {
    sendDate: ["senddate", "date"],
    title: ["title", "campaignname"],
    missing: ["nothinghere"],
  });
  assert.equal(cols.sendDate, 0);
  assert.equal(cols.title, 1);
  assert.equal(cols.missing, -1);
});

test("date and time cells are read the way a US team writes them", async () => {
  const { parseLooseDate, parseLooseTime } = await import("../src/lib/calendar-import");

  assert.equal(parseLooseDate("2026-09-01"), "2026-09-01");
  assert.equal(parseLooseDate("2026-09-01 00:00:00"), "2026-09-01");
  // Slash dates are month-first. Reading this day-first would move the send.
  assert.equal(parseLooseDate("9/1/2026"), "2026-09-01");
  assert.equal(parseLooseDate("12/31/26"), "2026-12-31");
  assert.equal(parseLooseDate("Sep 1, 2026"), "2026-09-01");
  assert.equal(parseLooseDate("September 1 2026"), "2026-09-01");
  assert.equal(parseLooseDate("Wed, Sep 2, 2026"), "2026-09-02");
  assert.equal(parseLooseDate("1 Sep 2026"), "2026-09-01");

  // Impossible dates are rejected rather than rolled forward into March.
  assert.equal(parseLooseDate("2026-02-30"), "");
  assert.equal(parseLooseDate("13/1/2026"), "");
  assert.equal(parseLooseDate("next Tuesday"), "");
  assert.equal(parseLooseDate(""), "");
  // A bare small number is not a date, even though Excel serials are supported.
  assert.equal(parseLooseDate("12"), "");

  assert.equal(parseLooseTime("10:00"), "10:00");
  assert.equal(parseLooseTime("9am"), "09:00");
  assert.equal(parseLooseTime("2 PM"), "14:00");
  assert.equal(parseLooseTime("12am"), "00:00");
  assert.equal(parseLooseTime("10"), "10:00");
  // A bare afternoon hour in a marketing calendar means PM.
  assert.equal(parseLooseTime("3"), "15:00");
  assert.equal(parseLooseTime("whenever"), "");
});

test("asset type and status are inferred from the words sheets really use", async () => {
  const { inferAssetType, inferStatus } = await import("../src/lib/calendar-import");

  assert.equal(inferAssetType("Email"), "email_campaign");
  assert.equal(inferAssetType("Newsletter"), "email_campaign");
  assert.equal(inferAssetType("Blog"), "blog_post");
  assert.equal(inferAssetType("SMS"), "crm_automation");
  assert.equal(inferAssetType("Instagram Reel"), "social_video_carousel");
  assert.equal(inferAssetType("", "Facebook"), "social_post");
  assert.equal(inferAssetType("Billboard"), "");
  assert.equal(inferAssetType(""), "");

  assert.equal(inferStatus("Planned"), "planned");
  assert.equal(inferStatus("Draft"), "planned");
  assert.equal(inferStatus("SENT"), "sent");
  assert.equal(inferStatus("Published"), "sent");
  assert.equal(inferStatus("Queued"), "scheduled");
  // A client's own vocabulary must not fail the row.
  assert.equal(inferStatus("Ideating"), "planned");
  assert.equal(inferStatus(""), "planned");
});

test("a row missing its date or title is an error that names the row", async () => {
  const { parseCalendarCsv } = await import("../src/lib/calendar-import");

  const res = parseCalendarCsv(
    [
      "Date,Title,Channel",
      "2026-09-01,Good row,Email",
      ",Missing a date,Email",
      "not a date,Bad date,Email",
      "2026-09-04,,Email",
    ].join("\n")
  );

  assert.equal(res.rows.length, 1);
  assert.equal(res.errors.length, 3);
  // Every bad row is reported at once, and each points at its line on screen.
  assert.deepEqual(res.errors.map((e) => e.line).sort(), [3, 4, 5]);
  assert.match(res.errors[0].message, /Missing a date/);
  assert.match(res.errors[1].message, /Could not read/);

  const noDateCol = parseCalendarCsv("Name,Channel\nLaunch,Email");
  assert.equal(noDateCol.rows.length, 0);
  assert.match(noDateCol.errors[0].message, /date column/i);

  const headersOnly = parseCalendarCsv("Date,Title\n");
  assert.match(headersOnly.errors[0].message, /no data/i);

  // A column we cannot place is reported rather than silently dropped.
  const strange = parseCalendarCsv("Date,Title,Budget Code\n2026-09-01,Launch,X1");
  assert.deepEqual(strange.unmapped, ["Budget Code"]);
  // But sheet furniture is not reported as a loss.
  const furniture = parseCalendarCsv("Date,Title,Day,Week,Owner\n2026-09-01,Launch,Tue,36,Randi");
  assert.deepEqual(furniture.unmapped, []);
});

/* ------------------------------------------------------- against the db */

const SHEET = [
  "Date,Title,Time,Channel,Status,Audience,Purpose,Offer,Subject Line,Preview Text,Notes",
  "9/1/2026,September newsletter,10am,Email,Planned,Full list,Stay top of mind,,Open me,Preview here,",
  "9/8/2026,Fall promo,,Email,Draft,Past customers,Drive bookings,$50 off,Deal inside,,pair with ads",
  "9/15/2026,Behind the scenes,,Instagram Reel,Planned,Followers,Build trust,,,,",
].join("\n");

// One database for the file: getDb holds a single connection keyed to the cwd at
// first import, so a per-test chdir would not give a per-test database. Each
// subtest gets its own client id instead, which isolates them just as well.
test("importing an editorial calendar", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-import-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const { getDb, nowIso } = await import("../src/lib/db");
  const {
    applyCalendarImport,
    listImportBatches,
    previewCalendarImport,
    undoCalendarImport,
  } = await import("../src/lib/calendar-import");
  const { createSend } = await import("../src/lib/calendar");

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
  const sendsFor = (id: string) =>
    getDb()
      .prepare(`SELECT id, title, send_date FROM scheduled_sends WHERE client_id = ? ORDER BY send_date`)
      .all(id) as Array<{ id: string; title: string; send_date: string }>;

  await t.test("a preview diffs against the calendar and writes nothing", () => {
    const id = client("cal_prev");
    const preview = previewCalendarImport(id, SHEET);

    assert.equal(preview.errors.length, 0);
    assert.equal(preview.rows.length, 3);
    assert.equal(preview.start, "2026-09-01");
    assert.equal(preview.end, "2026-09-15");
    assert.equal(preview.duplicateCount, 0);
    assert.equal(preview.rows[0].sendTime, "10:00");
    assert.equal(preview.rows[0].assetType, "email_campaign");
    assert.equal(preview.rows[2].assetType, "social_video_carousel");
    assert.equal(preview.rows[1].status, "planned");
    assert.equal(preview.rows[1].offer, "$50 off");
    // The header each field was read from comes back, so a mis-read column is
    // visible before anything is written.
    assert.equal(preview.matched.subject, "Subject Line");

    assert.equal(sendsFor(id).length, 0, "a preview must not write");
  });

  await t.test("bad rows are left out, the rest of the file still imports", () => {
    const id = client("cal_partial");
    const messy = [
      "Date,Title",
      "2026-09-01,Good one",
      "not a date,Bad date",
      "2026-09-08,Another good one",
      "2026-09-15,",
    ].join("\n");

    const result = applyCalendarImport(id, messy, "skip_duplicates");
    // Refusing the whole file over one typo held a year's calendar hostage to it.
    assert.equal(result.ok, true);
    assert.equal(result.created, 2);
    assert.equal(result.failed, 2, "the rows left out are counted, not hidden");
    assert.deepEqual(sendsFor(id).map((r) => r.title), ["Good one", "Another good one"]);
  });

  await t.test("a file with no usable column is refused outright", () => {
    const id = client("cal_nocol");
    const result = applyCalendarImport(id, "Budget,Owner\n100,Randi", "skip_duplicates");
    assert.equal(result.ok, false);
    assert.match(result.error || "", /date column/i);
    assert.equal(sendsFor(id).length, 0);
  });

  await t.test("re-importing a corrected sheet skips what is already there", () => {
    const id = client("cal_dupe");
    assert.equal(applyCalendarImport(id, SHEET, "skip_duplicates").created, 3);

    // The same file again: every row is recognised as already on the calendar.
    assert.equal(previewCalendarImport(id, SHEET).duplicateCount, 3);
    const again = applyCalendarImport(id, SHEET, "skip_duplicates");
    assert.equal(again.created, 0);
    assert.equal(again.skipped, 3);

    // "add" is the escape hatch for genuinely wanting the rows twice.
    assert.equal(applyCalendarImport(id, SHEET, "add").created, 3);
    assert.equal(sendsFor(id).length, 6);
  });

  await t.test("replacing a range spares client productions", () => {
    const id = client("cal_repl");
    // A shoot the client booked and an editorial row typed in by hand, both
    // inside the window the sheet covers.
    const shoot = createSend({
      clientId: id,
      title: "September shoot",
      sendDate: "2026-09-10",
      requestedByClient: true,
    });
    const typedByHand = createSend({
      clientId: id,
      title: "Old draft idea",
      sendDate: "2026-09-05",
    });

    const result = applyCalendarImport(id, SHEET, "replace_range");
    assert.equal(result.created, 3);
    assert.equal(result.deleted, 1, "only the editorial row is cleared");

    const ids = sendsFor(id).map((r) => r.id);
    assert.ok(ids.includes(shoot.id), "a client's production is never wiped by an import");
    assert.ok(!ids.includes(typedByHand.id));
    assert.equal(ids.length, 4);
  });

  await t.test("an import clears the client's sign-off on the old plan", () => {
    const id = client("cal_appr");
    const approvedAt = "2026-08-01T00:00:00.000Z";
    const setApproval = () =>
      getDb()
        .prepare(
          `UPDATE rev_clients SET calendar_approved_at = ?, calendar_approved_by = ? WHERE id = ?`
        )
        .run(approvedAt, "Kelly", id);
    const readApproval = () =>
      (
        getDb()
          .prepare(`SELECT calendar_approved_at FROM rev_clients WHERE id = ?`)
          .get(id) as { calendar_approved_at: string | null }
      ).calendar_approved_at;

    setApproval();
    const result = applyCalendarImport(id, SHEET, "skip_duplicates");
    assert.equal(result.approvalCleared, true);
    assert.equal(
      readApproval(),
      null,
      "an Approved badge must not survive the plan it approved"
    );

    // Undoing is a change to the plan too.
    setApproval();
    undoCalendarImport(id, result.batchId);
    assert.equal(readApproval(), null);
  });

  await t.test("an import can be undone as one batch", () => {
    const id = client("cal_undo");
    const keep = createSend({ clientId: id, title: "Typed by hand", sendDate: "2026-09-02" });
    const result = applyCalendarImport(id, SHEET, "add");

    const batches = listImportBatches(id);
    assert.equal(batches.length, 1);
    assert.equal(batches[0].batchId, result.batchId);
    assert.equal(batches[0].count, 3);

    assert.equal(undoCalendarImport(id, result.batchId).deleted, 3);
    assert.deepEqual(
      sendsFor(id).map((r) => r.id),
      [keep.id],
      "hand-entered work is untouched"
    );

    // The batch leaves the undo list once its rows are gone.
    assert.equal(listImportBatches(id).length, 0);
    assert.equal(undoCalendarImport(id, result.batchId).ok, false);
  });

  await t.test("a batch id from another account cannot delete these rows", () => {
    const mine = client("cal_mine");
    const other = client("cal_other");
    const result = applyCalendarImport(mine, SHEET, "add");

    assert.equal(undoCalendarImport(other, result.batchId).deleted, 0);
    assert.equal(sendsFor(mine).length, 3);
  });
});
