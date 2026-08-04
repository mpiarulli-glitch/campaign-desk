import assert from "node:assert/strict";
import test from "node:test";
import { matchExistingContact } from "../src/lib/contact-sync";
import { findDeliverablesTables,
  findClientContact,
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
