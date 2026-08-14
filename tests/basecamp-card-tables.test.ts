import assert from "node:assert/strict";
import test from "node:test";
import { matchExistingContact } from "../src/lib/contact-sync";
import { basecampNameForManager } from "../src/lib/people";
import { findDeliverablesTables,
  findClientContact,
  approvalDueFields,
  resolveApprovalAssignees,
  findDeliverablesColumn,
} from "../src/lib/basecamp";

// Client approvals must always land on the Deliverables card table. Projects
// carry several boards, and the Deliverables board is rarely first in the dock,
// which used to make the approval send read the video board and report a
// missing Needs Approval column.
const topNotchDock = [
  { id: 6820650130, name: "kanban_board", title: "Video Card Table", enabled: true },
  { id: 8443351619, name: "kanban_board", title: "Deliverables", enabled: true },
  { id: 8443352029, name: "kanban_board", title: "Deliverable Templates", enabled: true },
  { id: 1111, name: "message_board", title: "Message Board", enabled: true },
];

// The Growth OS snapshot layout, where the board is named "Approvals /
// Deliverables" and sits among six other boards.
const growthOsDock = [
  { id: 10007065363, name: "kanban_board", title: "VIDEOS", enabled: true },
  { id: 10007065491, name: "kanban_board", title: "Approvals / Deliverables", enabled: true },
  { id: 10007065526, name: "kanban_board", title: "Deliverable Templates", enabled: true },
  { id: 10007065666, name: "kanban_board", title: "Empire Blueprint", enabled: true },
  { id: 10007065787, name: "kanban_board", title: "Proof", enabled: true },
  { id: 10007065809, name: "kanban_board", title: "Inbound", enabled: true },
  { id: 10007065824, name: "kanban_board", title: "Revenue", enabled: true },
  { id: 10007065861, name: "kanban_board", title: "Expansion", enabled: true },
];

test("picks Deliverables even when another board is first in the dock", () => {
  const found = findDeliverablesTables(topNotchDock);
  assert.deepEqual(
    found.map((table) => table.id),
    [8443351619]
  );
});

test("matches the Approvals / Deliverables title used by Growth OS projects", () => {
  const found = findDeliverablesTables(growthOsDock);
  assert.deepEqual(
    found.map((table) => table.id),
    [10007065491]
  );
});

test("matches an all caps title with a trailing space", () => {
  const found = findDeliverablesTables([
    { id: 6128826896, name: "kanban_board", title: "VIDEOS", enabled: true },
    { id: 9671327153, name: "kanban_board", title: "DELIVERABLES ", enabled: true },
  ]);
  assert.deepEqual(
    found.map((table) => table.id),
    [9671327153]
  );
});

test("Deliverable Templates is never a target", () => {
  for (const dock of [topNotchDock, growthOsDock]) {
    const found = findDeliverablesTables(dock);
    assert.equal(
      found.some((table) => /template/i.test(table.title)),
      false
    );
  }
});

test("unrelated boards are never a fallback", () => {
  const found = findDeliverablesTables([
    { id: 1, name: "kanban_board", title: "VIDEOS", enabled: true },
    { id: 2, name: "kanban_board", title: "Proof", enabled: true },
    { id: 3, name: "kanban_board", title: "SEO Approvals", enabled: true },
  ]);
  assert.deepEqual(found, []);
});

test("non card table dock entries are ignored", () => {
  const found = findDeliverablesTables(topNotchDock);
  assert.equal(
    found.some((table) => table.id === 1111),
    false
  );
});

test("disabled boards are skipped", () => {
  const found = findDeliverablesTables([
    { id: 5, name: "kanban_board", title: "Deliverables", enabled: false },
    { id: 6, name: "kanban_board", title: "Approvals / Deliverables", enabled: true },
  ]);
  assert.deepEqual(
    found.map((table) => table.id),
    [6]
  );
});

test("a plain Deliverables board outranks a combined title", () => {
  const found = findDeliverablesTables([
    { id: 8, name: "kanban_board", title: "Approvals / Deliverables", enabled: true },
    { id: 9, name: "kanban_board", title: "Deliverables", enabled: true },
  ]);
  assert.deepEqual(
    found.map((table) => table.id),
    [9, 8]
  );
});

/* ------------------------------------------------ resolving the client contact */

const ROSTER = [
  { id: 1, name: "Piarulli Michael", email_address: "mpiarulli@marketingempiregroup.com", client: false, employee: true },
  { id: 2, name: "Michael Marx", email_address: "michael@humblesomm.com", client: false, employee: false },
  { id: 3, name: "Luis Romero", email_address: "luis@marketingempiregroup.com", client: false, employee: true },
  { id: 4, name: "King Kashflow", email_address: "bot@marketingempiregroup.com", client: false, employee: true },
];

test("the client contact is found by email, not by a name that collides", () => {
  const hit = findClientContact(ROSTER, "michael@humblesomm.com", "Michael");
  assert.equal(hit?.id, 2, "must be the client, not Piarulli Michael");
});

test("a first name shared with our own staff resolves to nobody", () => {
  // Substring matching used to pick whoever sat first in the roster, which on a
  // live project is as likely to be one of ours as the client.
  assert.equal(findClientContact(ROSTER, "", "Michael"), null);
});

test("an exact full name is enough when there is no email on file", () => {
  assert.equal(findClientContact(ROSTER, "", "Michael Marx")?.id, 2);
});

test("an unknown contact resolves to nobody rather than the nearest guess", () => {
  assert.equal(findClientContact(ROSTER, "nobody@example.com", "Nobody Here"), null);
});

test("the account manager is never returned as the client contact", () => {
  assert.equal(findClientContact(ROSTER, "", "Luis"), null);
  assert.equal(findClientContact(ROSTER, "", "Kyle"), null);
});

/* ------------------------------------------- matching a contact to a candidate */

test("the existing first name picks the right person out of several", () => {
  assert.equal(matchExistingContact("Scott", ["Chris Evans", "Scott Quinn", "Bret Lund"]), "Scott Quinn");
  assert.equal(matchExistingContact("Demetric", ["Demetric Felton", "Chris Evans"]), "Demetric Felton");
  assert.equal(matchExistingContact("Naryssa", ["Alex Oseguera", "Jason Lucaci", "Naryssa Colgan"]), "Naryssa Colgan");
});

test("a title on the record does not stop the match", () => {
  assert.equal(matchExistingContact("Dr. Isaac", ["Isaac Song", "Lana Verrecchio"]), "Isaac Song");
});

test("one letter out still matches, which is the Kristin case", () => {
  assert.equal(
    matchExistingContact("Kristin", ["Jason Lucaci", "Kristen Black", "SEO Department"]),
    "Kristen Black"
  );
});

test("a real name is never replaced by an unrelated person", () => {
  // Bear Windows: "George" on file, and the only candidate is staff sitting
  // below the internal threshold. Overwriting would be a guess.
  assert.equal(matchExistingContact("George", ["Chris Evans"]), null);
});

test("two candidates sharing a first name resolve to nobody", () => {
  assert.equal(matchExistingContact("Kristen", ["Kristen Black", "Kristen Jensen"]), null);
});

test("no name on the record matches nobody by name", () => {
  assert.equal(matchExistingContact("", ["Ben Pham", "Van Do"]), null);
});

/* ------------------------------------------- account manager to Basecamp name */

test("Kyle is Morris Kyle, not Kyle Onstott", () => {
  // Both are real people on the roster. Matching "Kyle" on a prefix picked
  // Onstott, so production notifications pinged the wrong colleague.
  assert.equal(basecampNameForManager("Kyle"), "Morris Kyle");
  assert.notEqual(basecampNameForManager("Kyle"), "Kyle Onstott");
});

test("the other two managers map to their full names", () => {
  assert.equal(basecampNameForManager("Cassidy"), "Cassidy Merideth");
  assert.equal(basecampNameForManager("Luis"), "Luis Romero");
});

test("casing and stray spaces do not break the map", () => {
  assert.equal(basecampNameForManager("  luis "), "Luis Romero");
  assert.equal(basecampNameForManager("CASSIDY"), "Cassidy Merideth");
});

test("an unmapped manager resolves to nobody rather than a guess", () => {
  assert.equal(basecampNameForManager("Randi"), "");
  assert.equal(basecampNameForManager(""), "");
});

/* ---------------------------------------------- send form: who and when */

// The send form lets the sender pick the recipient and extra assignees. Bryan
// Luu was on BLuu Construction's project the whole time the send was refused,
// so the picker is the fix, and these guard what it puts on the card.
const projectPeople = [50582617, 44903667, 42850672];

test("the recipient is always assigned, and first", () => {
  assert.deepEqual(
    resolveApprovalAssignees(50582617, [], projectPeople),
    [50582617]
  );
  assert.deepEqual(
    resolveApprovalAssignees(50582617, [42850672], projectPeople),
    [50582617, 42850672]
  );
});

test("an extra assignee who left the project is dropped, not sent", () => {
  // Basecamp rejects the whole update for an id that is not on the project, so
  // a page left open across a roster change would fail the send outright.
  assert.deepEqual(
    resolveApprovalAssignees(50582617, [99999999, 42850672], projectPeople),
    [50582617, 42850672]
  );
});

test("the recipient is not assigned twice when also ticked as an extra", () => {
  assert.deepEqual(
    resolveApprovalAssignees(50582617, [50582617, 50582617], projectPeople),
    [50582617]
  );
});

test("a due date is only written when the form said something about it", () => {
  // Undefined has to send no key at all: a resend that never touched the field
  // must leave the date already on the card alone.
  assert.deepEqual(approvalDueFields(undefined), {});
  assert.deepEqual(approvalDueFields("2026-08-20"), { due_on: "2026-08-20" });
});

test("clearing the due date sends null rather than an empty string", () => {
  assert.deepEqual(approvalDueFields(""), { due_on: null });
  assert.deepEqual(approvalDueFields(null), { due_on: null });
});

/* --------------------------------------- deliverables column matching */

const deliverablesColumns = [
  { id: 1, title: "To Do" },
  { id: 2, title: "Needs Approval" },
  { id: 3, title: "Approved" },
  { id: 4, title: "Scheduled/Published" },
];

test("Needs Approval is found without matching the Approved column", () => {
  assert.equal(
    findDeliverablesColumn(deliverablesColumns, "needs_approval")?.id,
    2
  );
});

test("Approved is the Approved column, not Needs Approval", () => {
  assert.equal(
    findDeliverablesColumn(deliverablesColumns, "approved")?.id,
    3
  );
});

test("Scheduled/Published is the scheduled column", () => {
  assert.equal(
    findDeliverablesColumn(deliverablesColumns, "scheduled")?.id,
    4
  );
});

test("Scheduled / Published with spaces still matches", () => {
  assert.equal(
    findDeliverablesColumn(
      [
        { id: 1, title: "Needs Approval" },
        { id: 2, title: "Approved" },
        { id: 3, title: "Scheduled / Published" },
      ],
      "scheduled"
    )?.id,
    3
  );
});

test("a combined Scheduled/Published title beats a lone Published column", () => {
  assert.equal(
    findDeliverablesColumn(
      [
        { id: 1, title: "Published" },
        { id: 2, title: "Scheduled/Published" },
      ],
      "scheduled"
    )?.id,
    2
  );
});

test("Needs Approval is never treated as Approved", () => {
  assert.equal(
    findDeliverablesColumn(
      [{ id: 1, title: "Needs Approval" }],
      "approved"
    ),
    undefined
  );
});
