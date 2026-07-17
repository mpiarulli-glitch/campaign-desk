#!/usr/bin/env node
/**
 * Seed a client account snapshot into the local Campaign Desk database.
 *
 * Usage:
 *   node scripts/seed-snapshot-account.js --list
 *   node scripts/seed-snapshot-account.js "Client Name"
 *   node scripts/seed-snapshot-account.js "Client Name" --no-deliverables
 *   node scripts/seed-snapshot-account.js "Client Name" --token
 *
 * Writes to data/campaign-desk.db (the same DB the dev server uses).
 * Re-running for the same name is a no-op on the account (it won't duplicate).
 */

const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function id(len = 12) {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
const nowIso = () => new Date().toISOString();

// Starter deliverables applied to a new account unless --no-deliverables.
const STARTER_DELIVERABLES = [
  { category: "Email", name: "Monthly broadcast emails", cadence: "2x / month" },
  { category: "Email", name: "Automation / flow buildout", cadence: "As needed" },
  { category: "Reporting", name: "Performance review", cadence: "Monthly" },
  { category: "Strategy", name: "Campaign calendar planning", cadence: "Monthly" },
];

function main() {
  const args = process.argv.slice(2);
  const dbPath = path.join(process.cwd(), "data", "campaign-desk.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  if (args.includes("--list")) {
    const rows = db
      .prepare(
        `SELECT c.name, c.snapshot_token,
           (SELECT COUNT(*) FROM snapshot_deliverables d
             WHERE d.client_id = c.id AND d.active = 1) AS deliverables
         FROM rev_clients c WHERE c.active = 1
         ORDER BY c.name COLLATE NOCASE`
      )
      .all();
    if (rows.length === 0) {
      console.log("No accounts yet.");
    } else {
      console.log(`${rows.length} account(s):`);
      for (const r of rows) {
        console.log(
          `  - ${r.name}  (${r.deliverables} deliverables${
            r.snapshot_token ? ", share link set" : ""
          })`
        );
      }
    }
    db.close();
    return;
  }

  const name = args.find((a) => !a.startsWith("--"));
  if (!name) {
    console.error(
      'Provide a client name, e.g.  node scripts/seed-snapshot-account.js "Pipe It Right"'
    );
    process.exit(1);
  }

  const withDeliverables = !args.includes("--no-deliverables");
  const withToken = args.includes("--token");

  const existing = db
    .prepare(`SELECT * FROM rev_clients WHERE name = ? COLLATE NOCASE`)
    .get(name.trim());

  let account = existing;
  if (existing) {
    console.log(`Account "${existing.name}" already exists — reusing it.`);
  } else {
    const ts = nowIso();
    const clientId = id(12);
    db.prepare(
      `INSERT INTO rev_clients
        (id, name, business_model, retainer, monthly_cost, active, created_at, updated_at)
       VALUES (?, ?, 'home_service', 0, 0, 1, ?, ?)`
    ).run(clientId, name.trim(), ts, ts);
    account = db.prepare(`SELECT * FROM rev_clients WHERE id = ?`).get(clientId);
    console.log(`Created account "${account.name}" (${account.id}).`);
  }

  if (withDeliverables) {
    const already = db
      .prepare(
        `SELECT COUNT(*) AS n FROM snapshot_deliverables WHERE client_id = ? AND active = 1`
      )
      .get(account.id).n;
    if (already > 0) {
      console.log(
        `  Skipping starter deliverables (account already has ${already}).`
      );
    } else {
      const insert = db.prepare(
        `INSERT INTO snapshot_deliverables
          (id, client_id, category, name, cadence, sort_order, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
      );
      STARTER_DELIVERABLES.forEach((d, i) => {
        const ts = nowIso();
        insert.run(id(12), account.id, d.category, d.name, d.cadence, i, ts, ts);
      });
      console.log(
        `  Added ${STARTER_DELIVERABLES.length} starter deliverables.`
      );
    }
  }

  if (withToken && !account.snapshot_token) {
    const token = id(24);
    db.prepare(`UPDATE rev_clients SET snapshot_token = ? WHERE id = ?`).run(
      token,
      account.id
    );
    console.log(`  Share link: /snapshot/${token}`);
  }

  db.close();
  console.log("Done. Open /admin/snapshot in the app to see it.");
}

main();
