import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Leads the client service team logs so the client can tell us which ones
// turned into business. The parts worth pinning down are the week bucketing
// (leads default to the week they came in) and the account scoping on the
// answer, since that write comes in over a public link.

test("snapshot leads", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-leads-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const snapshot = await import("../src/lib/snapshot");
  const { getDb, nowIso } = await import("../src/lib/db");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const now = nowIso();
  const insertClient = getDb().prepare(
    `INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`
  );
  insertClient.run("cl_1", "Guardian Plumbers", now, now);
  insertClient.run("cl_2", "Sierra Sprinkler", now, now);

  // 2026-08-05 is a Wednesday, so its week is Monday 2026-08-03.
  const jane = snapshot.addLead({
    clientId: "cl_1",
    firstName: "Jane",
    lastName: "Doe",
    email: "jane@example.com",
    phone: "555-111-2222",
    source: "form",
    receivedOn: "2026-08-05",
  });
  // 2026-07-30 is the previous week (Monday 2026-07-27).
  const rob = snapshot.addLead({
    clientId: "cl_1",
    firstName: "Rob",
    source: "call",
    receivedOn: "2026-07-30",
  });
  const other = snapshot.addLead({
    clientId: "cl_2",
    firstName: "Amy",
    receivedOn: "2026-08-05",
  });

  await t.test("a lead lands in the week it came in", () => {
    assert.equal(jane.week_start, "2026-08-03");
    assert.equal(rob.week_start, "2026-07-27");
  });

  await t.test("listing by week returns only that week's leads", () => {
    const wk = snapshot.listLeads("cl_1", { week: "2026-08-03" });
    assert.deepEqual(wk.map((l) => l.first_name), ["Jane"]);
  });

  await t.test("listing without a week returns all of them, newest first", () => {
    const all = snapshot.listLeads("cl_1");
    assert.deepEqual(all.map((l) => l.first_name), ["Jane", "Rob"]);
  });

  await t.test("leads never leak across accounts", () => {
    assert.deepEqual(snapshot.listLeads("cl_2").map((l) => l.first_name), ["Amy"]);
    assert.deepEqual(snapshot.weeksWithLeads("cl_2"), ["2026-08-03"]);
  });

  await t.test("weeks with leads are newest first", () => {
    assert.deepEqual(snapshot.weeksWithLeads("cl_1"), ["2026-08-03", "2026-07-27"]);
  });

  await t.test("a new lead starts unanswered", () => {
    assert.equal(jane.converted, "unknown");
    assert.equal(jane.answered_at, "");
  });

  await t.test("the client's answer is recorded with a timestamp", () => {
    const answered = snapshot.answerLead("cl_1", jane.id, "yes", "Booked a job Friday");
    assert.equal(answered?.converted, "yes");
    assert.equal(answered?.client_note, "Booked a job Friday");
    assert.ok(answered?.answered_at);
  });

  await t.test("clearing an answer clears the timestamp with it", () => {
    const cleared = snapshot.answerLead("cl_1", jane.id, "unknown");
    assert.equal(cleared?.converted, "unknown");
    assert.equal(cleared?.answered_at, "");
    // Put it back for the tally check below.
    snapshot.answerLead("cl_1", jane.id, "yes");
  });

  await t.test("a lead cannot be answered through another account's link", () => {
    assert.equal(snapshot.answerLead("cl_2", jane.id, "no"), null);
    // And the real answer is untouched.
    assert.equal(snapshot.getLead(jane.id)?.converted, "yes");
  });

  await t.test("an unknown conversion value falls back to unanswered", () => {
    const bogus = snapshot.answerLead("cl_1", rob.id, "maybe" as never);
    assert.equal(bogus?.converted, "unknown");
    snapshot.answerLead("cl_1", rob.id, "no");
  });

  await t.test("moving the date moves the lead to that date's week", () => {
    const moved = snapshot.updateLead(rob.id, { receivedOn: "2026-08-06" });
    assert.equal(moved?.received_on, "2026-08-06");
    assert.equal(moved?.week_start, "2026-08-03");
    assert.equal(snapshot.listLeads("cl_1", { week: "2026-07-27" }).length, 0);
  });

  await t.test("editing a lead leaves the client's answer alone", () => {
    assert.equal(snapshot.getLead(rob.id)?.converted, "no");
  });

  await t.test("the tally counts each answer state", () => {
    const tally = snapshot.leadTally(snapshot.listLeads("cl_1"));
    assert.deepEqual(tally, { total: 2, converted: 1, notConverted: 1, unanswered: 0 });
  });

  await t.test("a removed lead is gone", () => {
    assert.equal(snapshot.deleteLead(other.id), true);
    assert.equal(snapshot.listLeads("cl_2").length, 0);
    assert.equal(snapshot.deleteLead(other.id), false);
  });
});
