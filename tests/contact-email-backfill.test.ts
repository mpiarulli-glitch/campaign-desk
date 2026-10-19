import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  backfillKnownContactEmails,
  contactEmailBackfillLine,
  planContactEmailBackfill,
} from "../src/lib/contact-email-backfill";
import {
  isUsableEmail,
  nextContactEmail,
  usableEmail,
} from "../src/lib/email-address";

const MASKED = "c@••••••••••••.•••";

function memoryDb() {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE rev_clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      basecamp_project_id TEXT NOT NULL DEFAULT '',
      contact_email TEXT NOT NULL DEFAULT '',
      contact_name TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
  `);
  return database;
}

function insert(
  database: Database.Database,
  row: {
    id: string;
    name: string;
    email?: string;
    projectId?: string;
    contactName?: string;
  }
) {
  database
    .prepare(
      `INSERT INTO rev_clients
         (id, name, basecamp_project_id, contact_email, contact_name, updated_at)
       VALUES (?, ?, ?, ?, ?, '')`
    )
    .run(
      row.id,
      row.name,
      row.projectId || "",
      row.email || "",
      row.contactName || ""
    );
}

test("a masked, non-ASCII, or malformed address is no email", () => {
  assert.equal(isUsableEmail(MASKED), false);
  assert.equal(isUsableEmail("c@exämple.com"), false);
  assert.equal(isUsableEmail("not an email"), false);
  assert.equal(isUsableEmail("a@b"), false);
  assert.equal(isUsableEmail(""), false);
  assert.equal(usableEmail(MASKED), "");
  assert.equal(isUsableEmail("c@drchrisboman.com"), true);
  assert.equal(
    nextContactEmail(MASKED, "mark@blacksblinds.com"),
    "mark@blacksblinds.com"
  );
  assert.equal(nextContactEmail(MASKED, ""), "");
  assert.equal(nextContactEmail("", "mark@blacksblinds.com"), "");
  assert.equal(
    nextContactEmail(undefined, "mark@blacksblinds.com"),
    "mark@blacksblinds.com"
  );
});

test("backfill writes blank and masked emails and leaves a valid one", () => {
  const database = memoryDb();
  insert(database, { id: "trail", name: "Trailhead Family Chiropractic", email: "" });
  insert(database, {
    id: "blacks",
    name: "Black's Shutters Shades & Blinds",
    email: MASKED,
  });
  insert(database, {
    id: "chap",
    name: "Chaparral Junk Removal & Handyman Services",
    email: "",
  });
  insert(database, {
    id: "superior",
    name: "Superior Patios Growth OS - Powered by the Empire Method",
    email: "already@superiorpatios.example",
  });
  insert(database, {
    id: "bear",
    name: "Bear Windows",
    email: "",
    contactName: "Someone Else",
  });
  insert(database, {
    id: "kentina-a",
    name: "Kentina Hospitality",
    email: "",
  });
  insert(database, {
    id: "kentina-b",
    name: "Kentina Passport",
    email: "",
  });
  insert(database, {
    id: "other",
    name: "West Co",
    email: "owner@westco.example",
  });

  const lines: string[] = [];
  const rows = backfillKnownContactEmails(database, (line) => lines.push(line));

  const emailOf = (id: string) =>
    (
      database.prepare(`SELECT contact_email, contact_name FROM rev_clients WHERE id = ?`).get(id) as {
        contact_email: string;
        contact_name: string;
      }
    );

  assert.equal(emailOf("trail").contact_email, "c@drchrisboman.com");
  assert.equal(emailOf("blacks").contact_email, "mark@blacksblinds.com");
  assert.equal(emailOf("chap").contact_email, "nicopanzera@gmail.com");
  assert.equal(emailOf("superior").contact_email, "already@superiorpatios.example");
  assert.equal(emailOf("bear").contact_email, "george@bearwindows.com");
  assert.equal(emailOf("bear").contact_name, "Someone Else");
  assert.equal(emailOf("kentina-a").contact_email, "");
  assert.equal(emailOf("kentina-b").contact_email, "");
  assert.equal(emailOf("other").contact_email, "owner@westco.example");

  const outcome = (name: string) => rows.find((row) => row.client === name)?.outcome;
  assert.equal(outcome("Trailhead Family Chiropractic"), "updated");
  assert.equal(outcome("Black's Shutters Shades & Blinds"), "updated");
  assert.equal(outcome("Chaparral Junk Removal"), "updated");
  assert.equal(outcome("Superior Patios"), "skipped");
  assert.equal(outcome("Bear Windows"), "updated");
  assert.equal(outcome("Kentina"), "not found");

  assert.ok(lines.includes(contactEmailBackfillLine({ client: "Trailhead Family Chiropractic", outcome: "updated" })));
  assert.ok(
    lines.includes(
      contactEmailBackfillLine({
        client: "Superior Patios",
        outcome: "skipped",
        matchedName: "Superior Patios Growth OS - Powered by the Empire Method",
      })
    )
  );
  assert.ok(lines.includes("[contact-email] Kentina: not found"));

  const again: string[] = [];
  backfillKnownContactEmails(database, (line) => again.push(line));
  assert.equal(emailOf("trail").contact_email, "c@drchrisboman.com");
  assert.ok(
    again.every((line) =>
      /: (skipped \(already valid\)|not found)( \(.+\))?$/.test(line)
    )
  );
  assert.ok(again.includes("[contact-email] Trailhead Family Chiropractic: skipped (already valid)"));
});

test("a Basecamp project id match wins over a different name", () => {
  const plan = planContactEmailBackfill(
    [
      {
        id: "by-name",
        name: "Bear Windows",
        basecamp_project_id: "",
        contact_email: "",
      },
      {
        id: "by-id",
        name: "Windows Co",
        basecamp_project_id: "proj-bear",
        contact_email: "",
      },
    ],
    [{ name: "Bear Windows", email: "george@bearwindows.com", projectId: "proj-bear" }]
  );
  assert.equal(plan[0].outcome, "updated");
  assert.equal(plan[0].clientId, "by-id");
});

test("ALL-IN-1 matches All In One by name, and the project id when the name differs", () => {
  const database = memoryDb();
  insert(database, {
    id: "aio",
    name: "All In One Construction",
    email: "",
    projectId: "48158835",
  });
  insert(database, {
    id: "maya",
    name: "Maya's Construction",
    email: "",
    projectId: "48997930",
  });
  insert(database, {
    id: "done",
    name: "Done Right Construction",
    email: "",
  });

  const lines: string[] = [];
  const rows = backfillKnownContactEmails(database, (line) => lines.push(line));
  const allInOne = rows.find((row) => row.client === "ALL-IN-1 Construction");
  assert.equal(allInOne?.outcome, "updated");
  assert.equal(allInOne?.clientId, "aio");
  assert.equal(allInOne?.matchedName, "All In One Construction");
  assert.equal(
    (
      database.prepare(`SELECT contact_email FROM rev_clients WHERE id = 'aio'`).get() as {
        contact_email: string;
      }
    ).contact_email,
    "wayne@allinone-const.com"
  );
  assert.equal(
    (
      database.prepare(`SELECT contact_email FROM rev_clients WHERE id = 'maya'`).get() as {
        contact_email: string;
      }
    ).contact_email,
    ""
  );
  assert.equal(
    (
      database.prepare(`SELECT contact_email FROM rev_clients WHERE id = 'done'`).get() as {
        contact_email: string;
      }
    ).contact_email,
    ""
  );
  assert.ok(
    lines.includes(
      "[contact-email] ALL-IN-1 Construction: updated (All In One Construction)"
    )
  );

  const names = [
    "All-In-One Construction",
    "ALL IN 1",
    "All In 1 Construction",
    "ALL-IN-1 Construction",
  ];
  for (const name of names) {
    const plan = planContactEmailBackfill(
      [
        {
          id: "one",
          name,
          basecamp_project_id: "",
          contact_email: "",
        },
      ],
      [{ name: "ALL-IN-1 Construction", email: "wayne@allinone-const.com" }]
    );
    assert.equal(plan[0].outcome, "updated", name);
    assert.equal(plan[0].matchedName, name);
  }

  const kept = planContactEmailBackfill(
    [
      {
        id: "aio",
        name: "All-In-One Construction",
        basecamp_project_id: "48158835",
        contact_email: "wayne@allinone-const.com",
      },
    ]
  );
  const row = kept.find((item) => item.client === "ALL-IN-1 Construction");
  assert.equal(row?.outcome, "skipped");
  assert.equal(row?.matchedName, "All-In-One Construction");

  const byId = planContactEmailBackfill(
    [
      {
        id: "weird",
        name: "Wayne Meeks",
        basecamp_project_id: "48158835",
        contact_email: "",
      },
    ]
  );
  const idRow = byId.find((item) => item.client === "ALL-IN-1 Construction");
  assert.equal(idRow?.outcome, "updated");
  assert.equal(idRow?.clientId, "weird");
  assert.equal(idRow?.matchedName, "Wayne Meeks");
});

test("an empty client table logs nothing", () => {
  const database = memoryDb();
  const lines: string[] = [];
  const rows = backfillKnownContactEmails(database, (line) => lines.push(line));
  assert.deepEqual(rows, []);
  assert.deepEqual(lines, []);
});
