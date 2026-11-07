import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  canonicalContactRecord,
  contactForUse,
  currentPointOfContact,
  failureCurrentContactNote,
  matchRosterContact,
  type ContactRecord,
  type RosterPerson,
} from "../src/lib/client-contact";

const MASK = "c@\u2022\u2022\u2022\u2022\u2022.example";

function person(id: number, name: string, email = ""): RosterPerson {
  return { id, name, email_address: email };
}

function record(partial: Partial<ContactRecord> & Pick<ContactRecord, "id" | "name">): ContactRecord {
  return {
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    poc: "",
    basecamp_project_id: "",
    basecamp_contact_id: 0,
    fridayAsk: false,
    ...partial,
  };
}

test("Friday ask contact name wins over an older poc string", () => {
  const contact = currentPointOfContact({
    contact_name: "Ana Ruiz",
    contact_email: "ana@dolce.test",
    contact_phone: "+19515550100",
    poc: "Fernando Leal",
  });
  assert.deepEqual(contact, {
    name: "Ana Ruiz",
    email: "ana@dolce.test",
    phone: "+19515550100",
  });
});

test("poc fills the name only when the Friday ask name is empty", () => {
  const contact = currentPointOfContact({
    contact_name: "  ",
    poc: "Tommy Walker",
    contact_email: "",
    contact_phone: "",
  });
  assert.equal(contact.name, "Tommy Walker");
  assert.equal(contact.email, "");
});

test("a masked address and an email handle are not a contact", () => {
  const contact = currentPointOfContact({
    contact_name: "",
    poc: "",
    contact_email: MASK,
    contact_phone: "",
  });
  assert.equal(contact.name, "");
  assert.equal(contact.email, "");
  assert.equal(
    currentPointOfContact({
      contact_name: "",
      contact_email: "george@bear.test",
    }).name,
    ""
  );
});

test("production and Friday ask resolve the same person from the current contact", () => {
  const people = [
    person(9, "Fernando Leal", "fernando@old.test"),
    person(10, "Ana Ruiz", "ana@dolce.test"),
    person(11, "King Kashflow", "king@meg.test"),
  ];
  const contact = currentPointOfContact({
    contact_name: "Ana Ruiz",
    contact_email: "ana@dolce.test",
    poc: "Fernando Leal",
  });
  const friday = matchRosterContact(contact, people, 9);
  const production = matchRosterContact(contact, people, 9);
  assert.equal(friday.status, "matched");
  assert.equal(production.status, "matched");
  if (friday.status === "matched" && production.status === "matched") {
    assert.equal(friday.person.id, 10);
    assert.equal(production.person.id, friday.person.id);
    assert.equal(production.person.name, "Ana Ruiz");
  }
});

test("a saved Basecamp id survives a rename when the email still matches", () => {
  const people = [person(101, "Jamie Cruz-Alvarez", "jamie@krak.co")];
  const match = matchRosterContact(
    { name: "Jamie Cruz", email: "jamie@krak.co", phone: "" },
    people,
    101
  );
  assert.equal(match.status, "matched");
  if (match.status === "matched") {
    assert.equal(match.via, "saved_id");
    assert.equal(match.person.id, 101);
  }
});

test("a saved id is not used when the Friday ask name is a different person", () => {
  const people = [
    person(9, "Fernando Leal", "fernando@old.test"),
    person(10, "Ana Ruiz", "ana@dolce.test"),
  ];
  const match = matchRosterContact(
    { name: "Ana Ruiz", email: "ana@dolce.test", phone: "" },
    people,
    9
  );
  assert.equal(match.status, "matched");
  if (match.status === "matched") assert.equal(match.person.id, 10);
});

test("a different Friday ask name does not keep tagging the old saved person", () => {
  const people = [person(9, "Fernando Leal", "fernando@old.test")];
  const match = matchRosterContact(
    { name: "Ana Ruiz", email: "", phone: "" },
    people,
    9
  );
  assert.equal(match.status, "unmatched");
});

test("an empty contact does not invent a person, and a lone saved id still stands", () => {
  const people = [person(4, "George Harris", "george@bear.test"), person(5, "George Hill")];
  assert.equal(
    matchRosterContact({ name: "", email: "", phone: "" }, people, 0).status,
    "empty"
  );
  const kept = matchRosterContact({ name: "", email: MASK, phone: "" }, people, 4);
  assert.equal(kept.status, "matched");
  if (kept.status === "matched") assert.equal(kept.person.id, 4);
});

test("prefix names and duplicate people are not chosen", () => {
  const people = [
    person(1, "George Harris", "gh@bear.test"),
    person(2, "George Hill", "hill@bear.test"),
    person(3, "Chris Evans", "chris@meg.test"),
  ];
  assert.equal(
    matchRosterContact({ name: "George", email: "", phone: "" }, people, 0).status,
    "unmatched"
  );
  const both = matchRosterContact(
    { name: "George Harris", email: "hill@bear.test", phone: "" },
    people,
    0
  );
  assert.equal(both.status, "ambiguous");
  const twins = matchRosterContact(
    { name: "", email: "", phone: "" },
    [person(1, "George Harris"), person(2, "George Harris")],
    0
  );
  assert.equal(twins.status, "empty");
  const sameName = matchRosterContact(
    { name: "George Harris", email: "", phone: "" },
    [person(1, "George Harris"), person(2, "George Harris")],
    0
  );
  assert.equal(sameName.status, "ambiguous");
});

test("a production row uses the one Friday ask client on the same project", () => {
  const friday = record({
    id: "fri",
    name: "Dolce Vita Wellness Spa",
    contact_name: "Ana Ruiz",
    contact_email: "ana@dolce.test",
    contact_phone: "+19515550100",
    basecamp_project_id: "49264101",
    fridayAsk: true,
  });
  const production = record({
    id: "prod",
    name: "Dolce Vita Wellness Spa",
    contact_name: "Fernando Leal",
    contact_email: "",
    basecamp_project_id: "49264101",
    basecamp_contact_id: 9,
  });
  const otherName = record({
    id: "other",
    name: "Dolce Vita Wellness Spa",
    contact_name: "Not This One",
    contact_email: "nope@example.com",
    basecamp_project_id: "999",
    fridayAsk: true,
  });
  const used = contactForUse(production, [friday, production, otherName]);
  assert.equal(used.borrowed, true);
  assert.equal(used.sourceClientId, "fri");
  assert.equal(used.contact.name, "Ana Ruiz");
  assert.equal(used.contact.email, "ana@dolce.test");
  assert.equal(used.basecampContactId, 0);
  assert.equal(
    matchRosterContact(used.contact, [
      person(9, "Fernando Leal"),
      person(10, "Ana Ruiz", "ana@dolce.test"),
    ], used.basecampContactId).status,
    "matched"
  );
});

test("duplicate clients are not chosen by name, and two Friday ask rows are not guessed", () => {
  const fridayA = record({
    id: "a",
    name: "Bear Windows",
    contact_name: "George Harris",
    basecamp_project_id: "50",
    fridayAsk: true,
  });
  const fridayB = record({
    id: "b",
    name: "Bear Windows",
    contact_name: "Pat Lee",
    basecamp_project_id: "50",
    fridayAsk: true,
  });
  const production = record({
    id: "p",
    name: "Bear Windows",
    contact_name: "George",
    basecamp_project_id: "50",
  });
  const used = contactForUse(production, [fridayA, fridayB, production]);
  assert.equal(used.ambiguous, true);
  assert.equal(used.borrowed, false);
  assert.equal(used.contact.name, "George");
  assert.equal(used.sourceClientId, "p");

  const byNameOnly = record({
    id: "solo",
    name: "Bear Windows",
    contact_name: "George",
    basecamp_project_id: "77",
  });
  const named = contactForUse(byNameOnly, [fridayA, byNameOnly]);
  assert.equal(named.borrowed, false);
  assert.equal(named.contact.name, "George");
});

test("an enrolled Friday ask client keeps its own contact", () => {
  const friday = record({
    id: "fri",
    name: "A Tac Exterminators",
    contact_name: "Tommy Walker",
    contact_email: "tommy@atac.test",
    basecamp_project_id: "45845038",
    fridayAsk: true,
  });
  const other = record({
    id: "other",
    name: "A Tac Exterminators",
    contact_name: "Someone Else",
    basecamp_project_id: "45845038",
    fridayAsk: true,
  });
  const used = contactForUse(friday, [friday, other]);
  assert.equal(used.borrowed, false);
  assert.equal(used.contact.name, "Tommy Walker");
  assert.equal(canonicalContactRecord(friday, [friday, other]).record.id, "fri");
});

test("failure notes show the current contact and leave other errors alone", () => {
  const friday = record({
    id: "fri",
    name: "Dolce Vita Wellness Spa",
    contact_name: "Ana Ruiz",
    contact_email: "ana@dolce.test",
    contact_phone: "+19515550100",
    basecamp_project_id: "49264101",
    fridayAsk: true,
  });
  const production = record({
    id: "prod",
    name: "Dolce Vita Wellness Spa",
    contact_name: "Fernando Leal",
    basecamp_project_id: "49264101",
  });
  const note = failureCurrentContactNote(
    {
      kind: "contact_unresolved",
      subject: "Dolce Vita Wellness Spa",
    },
    [friday, production]
  );
  assert.match(note, /Current point of contact: Ana Ruiz · ana@dolce\.test · \+19515550100/);
  assert.match(note, /unchanged/);
  assert.doesNotMatch(note, /Fernando/);

  const dup = failureCurrentContactNote(
    { kind: "contact_unresolved", subject: "Bear Windows" },
    [
      record({ id: "1", name: "Bear Windows", contact_name: "George Harris", fridayAsk: true }),
      record({ id: "2", name: "Bear Windows", contact_name: "Pat Lee", fridayAsk: true }),
    ]
  );
  assert.match(dup, /Several clients are named/);
  assert.doesNotMatch(dup, /George Harris/);
  assert.doesNotMatch(dup, /Pat Lee/);

  assert.equal(
    failureCurrentContactNote(
      {
        kind: "basecamp_comment",
        subject: "Pipe It Right Plumbing",
      },
      [record({ id: "pipe", name: "Pipe It Right Plumbing", contact_name: "Paulina Barrera", fridayAsk: true })]
    ),
    ""
  );
  assert.equal(
    failureCurrentContactNote(
      { kind: "production_sms", subject: "Scheduling texts" },
      [friday]
    ),
    ""
  );
});

test("an old email failure can name the current contact without picking duplicates", () => {
  const client = record({
    id: "old",
    name: "Premier Choice Management",
    contact_name: "Jared Bregen",
    contact_email: MASK,
    fridayAsk: true,
  });
  const corrected = record({
    ...client,
    contact_email: "jared@premier.test",
  });
  const note = failureCurrentContactNote(
    { kind: "email", subject: MASK },
    [client]
  );
  assert.match(note, /Current point of contact: Jared Bregen/);
  assert.match(note, /unchanged/);
  assert.doesNotMatch(note, /Handled/);

  const several = failureCurrentContactNote(
    { kind: "email", subject: "shared@example.com" },
    [
      record({
        id: "1",
        name: "One",
        contact_email: "shared@example.com",
        contact_name: "Ada",
        fridayAsk: true,
      }),
      record({
        id: "2",
        name: "Two",
        contact_email: "shared@example.com",
        contact_name: "Bea",
        fridayAsk: true,
      }),
    ]
  );
  assert.match(several, /Several clients use this address/);
  assert.doesNotMatch(several, /Ada/);
  assert.equal(
    failureCurrentContactNote({ kind: "email", subject: "not-an-email" }, [corrected]),
    ""
  );
});

test("saving a contact name keeps poc aligned and does not rewrite another client", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-client-contact-"));
  const original = process.cwd();
  process.chdir(tmp);
  const { closeDbForTests } = await import("../src/lib/db");
  closeDbForTests();
  t.after(() => {
    closeDbForTests();
    process.chdir(original);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const { createRevClient, getRevClient, updateRevClient } = await import("../src/lib/revenue");
  const { enrollSnapshotClient } = await import("../src/lib/snapshot-enrollment");
  const { outreachContact, failureContactNote } = await import(
    "../src/lib/client-contact-source"
  );
  const { recordFailure, listOpenFailures } = await import("../src/lib/failures");

  const friday = createRevClient({
    name: "Dolce Vita Wellness Spa",
    businessModel: "home_service",
  });
  updateRevClient(friday.id, {
    contactName: "Fernando Leal",
    poc: "Fernando Leal",
    basecampProjectId: "49264101",
    basecampContactId: 9,
  });
  enrollSnapshotClient(friday.id, "test");
  updateRevClient(friday.id, {
    contactName: "Ana Ruiz",
    contactEmail: "ana@dolce.test",
    contactPhone: "9515550100",
  });

  const savedFriday = getRevClient(friday.id)!;
  assert.equal(savedFriday.contact_name, "Ana Ruiz");
  assert.equal(savedFriday.poc, "Ana Ruiz");
  assert.equal(savedFriday.contact_email, "ana@dolce.test");
  assert.equal(savedFriday.basecamp_contact_id, 9);

  const production = createRevClient({
    name: "Dolce Vita Staging",
    businessModel: "home_service",
  });
  updateRevClient(production.id, {
    contactName: "Fernando Leal",
    contactEmail: "",
    basecampProjectId: "49264101",
    basecampContactId: 9,
    productionEnrolled: true,
  });

  const before = getRevClient(production.id)!;
  const view = outreachContact(before);
  assert.equal(view.borrowed, true);
  assert.equal(view.contact.name, "Ana Ruiz");
  assert.equal(view.contact.email, "ana@dolce.test");
  assert.equal(view.client.contact_name, "Ana Ruiz");
  const after = getRevClient(production.id)!;
  assert.equal(after.contact_name, "Fernando Leal");
  assert.equal(after.contact_email, "");
  assert.equal(after.basecamp_contact_id, 9);

  const people = [
    person(9, "Fernando Leal", "fernando@old.test"),
    person(10, "Ana Ruiz", "ana@dolce.test"),
  ];
  const fridayMatch = matchRosterContact(
    currentPointOfContact(savedFriday),
    people,
    savedFriday.basecamp_contact_id
  );
  const productionMatch = matchRosterContact(
    view.contact,
    people,
    view.basecampContactId
  );
  assert.equal(fridayMatch.status, "matched");
  assert.equal(productionMatch.status, "matched");
  if (fridayMatch.status === "matched" && productionMatch.status === "matched") {
    assert.equal(fridayMatch.person.id, productionMatch.person.id);
    assert.equal(fridayMatch.person.name, "Ana Ruiz");
  }

  recordFailure({
    kind: "contact_unresolved",
    subject: "Dolce Vita Wellness Spa",
    detail: 'No Basecamp person matches "Fernando Leal", so no weekly snapshot message was posted.',
    hint: "Check the contact name matches their name in Basecamp exactly.",
  });
  recordFailure({
    kind: "basecamp_comment",
    subject: "Pipe It Right Plumbing",
    detail: "Could not comment the follow-up on the card. comment 502",
    hint: "The card may have been deleted. Post a fresh card for this client.",
  });
  recordFailure({
    kind: "production_sms",
    subject: "Scheduling texts",
    detail: "Pipe It Right Plumbing: The text didn't arrive.",
    hint: "Check that MEG's GHL account has a texting number and that US texting registration is approved.",
  });

  const open = listOpenFailures();
  assert.equal(open.length, 3);
  const dolce = open.find((row) => row.subject === "Dolce Vita Wellness Spa")!;
  const note = failureContactNote(dolce);
  assert.match(note, /Ana Ruiz/);
  assert.match(dolce.detail, /Fernando Leal/);
  assert.equal(dolce.dismissed_at, null);
  assert.equal(
    failureContactNote(open.find((row) => row.kind === "basecamp_comment")!),
    ""
  );
  assert.equal(
    failureContactNote(open.find((row) => row.kind === "production_sms")!),
    ""
  );
  const still = listOpenFailures();
  assert.equal(still.length, 3);
  assert.match(
    still.find((row) => row.subject === "Dolce Vita Wellness Spa")!.detail,
    /Fernando Leal/
  );
});
