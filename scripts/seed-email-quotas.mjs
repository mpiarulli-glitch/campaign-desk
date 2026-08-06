/**
 * Seed each client's contracted monthly email volume.
 *
 * The numbers come from the workspace's client folders — `docs/scheduling-notes.md`
 * and `docs/client-strategy.md` — which are the contract of record. This script
 * only fills them into the app so the Deliverables board can count against them.
 *
 * Idempotent and match-by-name. Clients not listed here, or already carrying a
 * non-zero quota, are left alone: once someone edits a quota in the UI, that
 * edit is the newer fact and this script must not stomp it. Pass --force to
 * overwrite existing values anyway.
 *
 *   node scripts/seed-email-quotas.mjs [--dry-run] [--force]
 *
 * Against production:  railway run node scripts/seed-email-quotas.mjs
 */

import Database from "better-sqlite3";
import path from "node:path";

// Contracted broadcast emails per month. Automations and event-triggered flows
// are deliberately excluded — they are not a fixed monthly count.
const QUOTAS = {
  "12 Volt Power": 8,
  "A Tac Exterminators": 0,
  "BLuu Construction": 3,
  "CIPO Cloud Software": 2,
  "CISCo Restaurant + Bar": 1,
  "Chaparral Junk Removal & Handyman Services": 2,
  Ecoworkz: 2,
  "GenX Cleaning Services": 1,
  "Guardian Plumbers": 1,
  "Hendos Barrel House": 3,
  "HR Innovator Group": 2,
  "Humble Somm": 2,
  "Inland Valley Chiropractic": 0,
  "Krak Boba Temecula": 1,
  "Law Offices of Giselle Rodriguez PC": 0,
  "Looda House Pawn": 2,
  "Luna Modern Mexican Kitchen": 4,
  "Pacific Coast Generation": 2,
  "Pipe It Right": 2,
  "Sierra Sprinkler": 0,
  "Superior Patios": 1,
  "The BetterLife Coach": 2,
  "Titan Tent & Event Rentals": 3,
  "Top Notch Auto": 4,
  "Trailhead Family Chiropractic": 3,
};

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

const dbPath =
  process.env.DB_PATH ||
  (process.env.NODE_ENV === "production"
    ? "/app/data/campaign-desk.db"
    : path.join(process.cwd(), "data", "campaign-desk.db"));

const db = new Database(dbPath);

const cols = db.prepare(`PRAGMA table_info(rev_clients)`).all();
if (!cols.some((c) => c.name === "monthly_email_quota")) {
  console.error(
    "rev_clients has no monthly_email_quota column yet. Start the app once so the migration runs, then re-run this."
  );
  process.exit(1);
}

const clients = db
  .prepare(`SELECT id, name, monthly_email_quota FROM rev_clients`)
  .all();

const update = db.prepare(
  `UPDATE rev_clients SET monthly_email_quota = ?, updated_at = ? WHERE id = ?`
);

const now = new Date().toISOString();
const applied = [];
const skipped = [];
const unmatched = new Set(Object.keys(QUOTAS));

for (const client of clients) {
  const quota = QUOTAS[client.name];
  if (quota === undefined) {
    skipped.push(`${client.name} — no contracted volume on file`);
    continue;
  }
  unmatched.delete(client.name);

  if (client.monthly_email_quota > 0 && !force) {
    skipped.push(
      `${client.name} — already set to ${client.monthly_email_quota}, left alone (use --force to overwrite)`
    );
    continue;
  }
  if (client.monthly_email_quota === quota) {
    skipped.push(`${client.name} — already ${quota}`);
    continue;
  }

  if (!dryRun) update.run(quota, now, client.id);
  applied.push(`${client.name}: ${client.monthly_email_quota} -> ${quota}`);
}

console.log(`Database: ${dbPath}`);
console.log(`${dryRun ? "Would update" : "Updated"} ${applied.length} client(s):`);
for (const line of applied) console.log(`  ${line}`);

if (skipped.length) {
  console.log(`\nSkipped ${skipped.length}:`);
  for (const line of skipped) console.log(`  ${line}`);
}

if (unmatched.size) {
  console.log(
    `\n${unmatched.size} client(s) have a contracted volume but no record in this database:`
  );
  for (const name of unmatched) console.log(`  ${name} (${QUOTAS[name]}/mo)`);
}

db.close();
