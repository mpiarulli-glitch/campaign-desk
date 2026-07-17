#!/usr/bin/env node
/**
 * Seed production-cadence data (color week, cadence, last production date,
 * contact) into rev_clients from the production scheduling tracker sheet.
 *
 * Matches existing rev_clients rows by name (with a small alias map for
 * known naming mismatches between the sheet and the DB), and creates a new
 * row for any client not already tracked. Newly-created clients default to
 * business_model "home_service" — adjust in the Revenue dashboard if needed.
 *
 * Usage:
 *   node scripts/seed-production-cadence.js
 *
 * Writes to data/campaign-desk.db (same DB the dev server uses). Safe to
 * re-run — it upserts by name.
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

// Sheet name -> existing DB name, where they differ.
const ALIASES = {
  "Guardian Plumbing": "Guardian Plumbers",
  "HR Innovators Group": "HR Innovator Group",
};

const CLIENTS = [
  { name: "Pipe It Right Plumbing", contact: "", email: "cynthia@pir-repipe.com", active: true, color: "purple", cadence: "monthly", lastProduction: "2026-06-20" },
  { name: "Luna Modern Mexican Kitchen", contact: "Cisco", email: "lunammk@gmail.com", active: true, color: "purple", cadence: "quarterly", lastProduction: "2026-05-28" },
  { name: "Cisco Restaurant + Bar", contact: "Cisco", email: "ciscorestaurantbar@gmail.com", active: true, color: "purple", cadence: "quarterly", lastProduction: "2026-04-23" },
  { name: "Titan Tent & Event Rentals", contact: "Angel", email: "angel@titantents.com", active: true, color: "purple", cadence: "quarterly", lastProduction: "2026-04-10" },
  { name: "No Limits Produce Inc", contact: "Cesar", email: "jr@nolimitsproduceinc.com", active: true, color: "purple", cadence: "monthly", lastProduction: "2026-06-17" },
  { name: "Top Notch Auto", contact: "Naryssa", email: "Naryssa@tna.la", active: true, color: "red", cadence: "monthly", lastProduction: "2026-05-27" },
  { name: "Inland Valley Chiropractic", contact: "Dr. Isaac", email: "drisaacsong@inlandvalleychiropractic.com", active: true, color: "red", cadence: "bi_monthly", lastProduction: "2026-05-13" },
  { name: "Humble Somm", contact: "Michael", email: "michael@humblesomm.com", active: true, color: "blue", cadence: "bi_monthly", lastProduction: "2026-06-29" },
  { name: "Ecoworkz", contact: "Bret", email: "bret@ecoworkz.net", active: true, color: "blue", cadence: "bi_monthly", lastProduction: "2026-06-22" },
  { name: "Krak Boba", contact: "Debbie", email: "temecula@krakboba.com", active: true, color: "blue", cadence: "bi_monthly", lastProduction: "2026-06-15" },
  { name: "Pacific Coast Generation", contact: "Josh", email: "jvasquez@pacificcoastgeneration.com", active: true, color: "green", cadence: "bi_monthly", lastProduction: "2026-06-22" },
  { name: "Guardian Plumbing", contact: "Kristin", email: "kristen@guardianplumbers.com", active: true, color: "green", cadence: "monthly", lastProduction: "2026-06-22" },
  { name: "Bear Windows", contact: "George", email: "george@bearwindows.com", active: true, color: "green", cadence: "quarterly", lastProduction: "2026-06-22" },
  { name: "News & Views Podcast", contact: "", email: "", active: false, color: "green", cadence: "monthly", lastProduction: "2026-05-07" },
  { name: "Beyond The Walls Church", contact: "Demetric", email: "demetricfelton@gmail.com", active: true, color: "green", cadence: "monthly", lastProduction: "2026-06-22" },
  { name: "Trailhead Family Chiropractic", contact: "Dr. Chris", email: "c@drchrisboman.com", active: true, color: "green", cadence: "quarterly", lastProduction: "2026-06-22" },
  { name: "12 Volt Power", contact: "Scott", email: "scott@12voltpower.com", active: true, color: "red", cadence: "monthly", lastProduction: "2026-06-19" },
  { name: "House Cleaning by Christina", contact: "Christina", email: "christinathornbrough34@gmail.com", active: true, color: "red", cadence: "quarterly", lastProduction: "2026-05-01" },
  { name: "HR Innovators Group", contact: "Stephanie", email: "stephanie@hrinnovatorsgroup.com", active: true, color: "blue", cadence: "quarterly", lastProduction: "2026-06-04" },
  { name: "Krak Corporate", contact: "", email: "", active: false, color: "", cadence: "", lastProduction: null },
];

function main() {
  const dbPath = path.join(__dirname, "..", "data", "campaign-desk.db");
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");

  const findByName = db.prepare(
    `SELECT id FROM rev_clients WHERE name = ? COLLATE NOCASE`
  );
  const insert = db.prepare(
    `INSERT INTO rev_clients
      (id, name, business_model, ghl_location_id, klaviyo_account, retainer,
       monthly_cost, ltv, active, color_week, production_cadence,
       last_production_date, blackout_dates, contact_name, contact_email,
       created_at, updated_at)
     VALUES (?, ?, 'home_service', '', '', 0, 0, NULL, ?, ?, ?, ?, '[]', ?, ?, ?, ?)`
  );
  const update = db.prepare(
    `UPDATE rev_clients SET
       active = ?, color_week = ?, production_cadence = ?,
       last_production_date = ?, contact_name = ?, contact_email = ?,
       updated_at = ?
     WHERE id = ?`
  );

  let created = 0;
  let updated = 0;

  for (const c of CLIENTS) {
    const dbName = ALIASES[c.name] || c.name;
    const existing = findByName.get(dbName);
    const ts = nowIso();

    if (existing) {
      update.run(
        c.active ? 1 : 0,
        c.color,
        c.cadence,
        c.lastProduction,
        c.contact,
        c.email,
        ts,
        existing.id
      );
      updated++;
    } else {
      insert.run(
        id(12),
        dbName,
        c.active ? 1 : 0,
        c.color,
        c.cadence,
        c.lastProduction,
        c.contact,
        c.email,
        ts,
        ts
      );
      created++;
    }
  }

  console.log(`Production cadence seed complete: ${created} created, ${updated} updated.`);
}

main();
