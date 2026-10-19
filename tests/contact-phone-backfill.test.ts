import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  CONTACT_PHONE_BACKFILL,
  backfillKnownContactPhones,
  planContactPhoneBackfill,
  type ContactPhoneBackfillEntry,
} from "../src/lib/contact-phone-backfill";
import { normalizePhoneE164 } from "../src/lib/phone";

function memoryDb() {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE rev_clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      basecamp_project_id TEXT NOT NULL DEFAULT '',
      contact_phone TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
  `);
  return database;
}

function insert(
  database: Database.Database,
  row: { id: string; name: string; phone?: string; projectId?: string | number }
) {
  database
    .prepare(
      `INSERT INTO rev_clients (id, name, basecamp_project_id, contact_phone, updated_at)
       VALUES (?, ?, ?, ?, '')`
    )
    .run(row.id, row.name, row.projectId ?? "", row.phone ?? "");
}

function phoneOf(database: Database.Database, id: string): string {
  const row = database
    .prepare(`SELECT contact_phone FROM rev_clients WHERE id = ?`)
    .get(id) as { contact_phone: string };
  return row.contact_phone;
}

const WAYNE: ContactPhoneBackfillEntry = {
  name: "ALL-IN-1 Construction",
  projectId: "48158835",
  pocName: "Wayne Meeks",
  phone: "+19099514915",
};

test("every POC phone is already E.164", () => {
  assert.equal(CONTACT_PHONE_BACKFILL.length, 59);
  for (const entry of CONTACT_PHONE_BACKFILL) {
    assert.equal(normalizePhoneE164(entry.phone), entry.phone, entry.name);
  }
  const wayne = CONTACT_PHONE_BACKFILL.find((entry) => entry.projectId === "48158835");
  assert.equal(wayne?.pocName, "Wayne Meeks");
  assert.equal(wayne?.phone, "+19099514915");
  const danza = CONTACT_PHONE_BACKFILL.filter((entry) => entry.projectId === "40435223");
  assert.deepEqual(
    danza.map((entry) => entry.phone),
    ["+19515282729", "+19515282729"]
  );
});

test("blank and invalid phones are saved, a valid one is left alone", () => {
  const database = memoryDb();
  insert(database, { id: "trail", name: "Trailhead Family Chiropractic", phone: "" });
  insert(database, { id: "bad", name: "FloorCo Design", phone: "555", projectId: "49198430" });
  insert(database, { id: "kept", name: "West Co", phone: "+15555550100" });
  insert(database, { id: "ten", name: "Swing Inn Cafe", phone: "9516916964" });
  const lines: string[] = [];
  const entries: ContactPhoneBackfillEntry[] = [
    {
      name: "Trailhead Family Chiropractic",
      projectId: "45845785",
      pocName: "Chris Boman",
      phone: "(951)733-3102",
    },
    {
      name: "FloorCo Design",
      projectId: "49198430",
      pocName: "Andy Mohajeri",
      phone: "951-399-1470",
    },
    {
      name: "West Co",
      projectId: "1",
      pocName: "Owner",
      phone: "+19995550111",
    },
    {
      name: "Swing Inn Cafe",
      projectId: "49112019",
      pocName: "Bridget Norris",
      phone: "+19516916964",
    },
  ];
  backfillKnownContactPhones(database, (line) => lines.push(line), entries);
  assert.equal(phoneOf(database, "trail"), "+19517333102");
  assert.equal(phoneOf(database, "bad"), "+19513991470");
  assert.equal(phoneOf(database, "kept"), "+15555550100");
  assert.equal(phoneOf(database, "ten"), "9516916964");
  assert.ok(lines.includes("[contact-phone] Trailhead Family Chiropractic: updated (Trailhead Family Chiropractic id=trail)"));
  assert.ok(lines.includes("[contact-phone] West Co: skipped (already valid) (West Co id=kept)"));
  assert.ok(lines.includes("[contact-phone] Swing Inn Cafe: skipped (already valid) (Swing Inn Cafe id=ten)"));
});

test("every All In 1 row gets Wayne's number and a different builder does not", () => {
  const database = memoryDb();
  insert(database, { id: "one", name: "All In 1 Construction", phone: "" });
  insert(database, { id: "all", name: "ALL-IN-1 Construction", phone: "not-a-phone" });
  insert(database, { id: "meeks", name: "Meeks Builds", phone: "", projectId: 48158835 });
  insert(database, { id: "maya", name: "Maya's Construction", phone: "" });
  insert(database, { id: "west", name: "West Co", phone: "+15555550199" });
  const lines: string[] = [];
  backfillKnownContactPhones(database, (line) => lines.push(line), [WAYNE]);
  assert.equal(phoneOf(database, "one"), "+19099514915");
  assert.equal(phoneOf(database, "all"), "+19099514915");
  assert.equal(phoneOf(database, "meeks"), "+19099514915");
  assert.equal(phoneOf(database, "maya"), "");
  assert.equal(phoneOf(database, "west"), "+15555550199");
  const line = lines[0];
  assert.match(line, /^\[contact-phone\] ALL-IN-1 Construction: updated /);
  assert.match(line, /All In 1 Construction id=one/);
  assert.match(line, /ALL-IN-1 Construction id=all/);
  assert.match(line, /Meeks Builds id=meeks/);
  assert.equal(lines.length, 1);
});

test("a later POC number does not replace the first valid phone", () => {
  const database = memoryDb();
  insert(database, { id: "cd", name: "Cuidando De Ti Advantage", phone: "" });
  const lines: string[] = [];
  const entries: ContactPhoneBackfillEntry[] = [
    {
      name: "Cuidando De Ti Advantage",
      projectId: "48416102",
      pocName: "Miriam Morales",
      phone: "+17607550550",
    },
    {
      name: "Cuidando De Ti Advantage",
      projectId: "48416102",
      pocName: "Leticia Hernandez",
      phone: "+19493518534",
    },
  ];
  backfillKnownContactPhones(database, (line) => lines.push(line), entries);
  assert.equal(phoneOf(database, "cd"), "+17607550550");
  assert.equal(lines[0], "[contact-phone] Cuidando De Ti Advantage: updated (Cuidando De Ti Advantage id=cd)");
  assert.equal(lines[1], "[contact-phone] Cuidando De Ti Advantage: skipped (already valid) (Cuidando De Ti Advantage id=cd)");
});

test("a valid phone on one duplicate stays, the blank duplicate is filled", () => {
  const database = memoryDb();
  insert(database, { id: "kept", name: "All-In-One Construction", phone: "+19995550123" });
  insert(database, { id: "blank", name: "ALL IN 1 Construction", phone: "" });
  backfillKnownContactPhones(database, () => {}, [WAYNE]);
  assert.equal(phoneOf(database, "kept"), "+19995550123");
  assert.equal(phoneOf(database, "blank"), "+19099514915");
});

test("one longer stored name matches, two prefix siblings do not", () => {
  const database = memoryDb();
  insert(database, {
    id: "chap",
    name: "Chaparral Junk Removal & Handyman Services",
    phone: "",
  });
  insert(database, { id: "hosp", name: "Kentina Hospitality", phone: "" });
  insert(database, { id: "pass", name: "Kentina Passport", phone: "" });
  const lines: string[] = [];
  const entries: ContactPhoneBackfillEntry[] = [
    {
      name: "Chaparral Junk Removal",
      projectId: "47166180",
      pocName: "Nick Panzera",
      phone: "+19516942982",
    },
    {
      name: "Kentina",
      projectId: "47256487",
      pocName: "Blaine Smith",
      phone: "+19512652143",
    },
  ];
  backfillKnownContactPhones(database, (line) => lines.push(line), entries);
  assert.equal(phoneOf(database, "chap"), "+19516942982");
  assert.equal(phoneOf(database, "hosp"), "");
  assert.equal(phoneOf(database, "pass"), "");
  assert.match(lines[0], /Chaparral Junk Removal & Handyman Services id=chap/);
  assert.match(lines[1], /^\[contact-phone\] Kentina: not found; closest: /);
  assert.match(lines[1], /Kentina Hospitality id=hosp/);
  assert.match(lines[1], /Kentina Passport id=pass/);
});

test("a miss lists close client names and a second run does not write again", () => {
  const database = memoryDb();
  insert(database, { id: "maya", name: "Maya's Construction", phone: "" });
  insert(database, { id: "dh", name: "DH Construction", phone: "+19168074787" });
  insert(database, { id: "fb", name: "Fallbrook Plumbing", phone: "" });
  const lines: string[] = [];
  const entries: ContactPhoneBackfillEntry[] = [
    {
      name: "Stephanie's Construction",
      projectId: "48661885",
      pocName: "Oscar Hernandez",
      phone: "+19514251969",
    },
  ];
  backfillKnownContactPhones(database, (line) => lines.push(line), entries);
  assert.equal(
    lines[0],
    "[contact-phone] Stephanie's Construction: not found; closest: DH Construction id=dh, Maya's Construction id=maya"
  );
  assert.equal(lines[0].includes("Fallbrook"), false);
  assert.equal(phoneOf(database, "maya"), "");
  assert.equal(phoneOf(database, "fb"), "");
  const again: string[] = [];
  backfillKnownContactPhones(database, (line) => again.push(line), entries);
  assert.equal(again.length, 1);
  assert.match(again[0], /: not found; closest: /);
});

test("an empty client table logs nothing", () => {
  const database = memoryDb();
  const lines: string[] = [];
  const rows = backfillKnownContactPhones(database, (line) => lines.push(line));
  assert.deepEqual(rows, []);
  assert.deepEqual(lines, []);
});

test("the full list fills both All In 1 spellings and leaves an unrelated phone", () => {
  const database = memoryDb();
  insert(database, { id: "one", name: "All In 1 Construction", phone: "" });
  insert(database, { id: "all", name: "ALL-IN-1 Construction", phone: "" });
  insert(database, { id: "maya", name: "Maya's Construction", phone: "+17604056020" });
  const lines: string[] = [];
  backfillKnownContactPhones(database, (line) => lines.push(line));
  assert.equal(phoneOf(database, "one"), "+19099514915");
  assert.equal(phoneOf(database, "all"), "+19099514915");
  assert.equal(phoneOf(database, "maya"), "+17604056020");
  const allIn = lines.find((line) => line.startsWith("[contact-phone] ALL-IN-1 Construction:"));
  assert.match(allIn || "", /: updated /);
  assert.match(allIn || "", /id=one/);
  assert.match(allIn || "", /id=all/);
  const maya = lines.find((line) => line.startsWith("[contact-phone] Maya's Construction:"));
  assert.match(maya || "", /skipped \(already valid\)/);
  const planned = planContactPhoneBackfill(
    [
      { id: "one", name: "All In 1 Construction", basecamp_project_id: "", contact_phone: "+19099514915" },
      { id: "all", name: "ALL-IN-1 Construction", basecamp_project_id: "", contact_phone: "+19099514915" },
    ],
    [WAYNE]
  );
  assert.equal(planned[0].outcome, "skipped");
  assert.equal(planned[0].writeIds, undefined);
});
