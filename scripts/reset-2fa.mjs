/**
 * Break-glass: remove two-factor from an account, straight against SQLite.
 *
 * The owner can reset anybody else's 2FA from /admin/users. This script exists
 * for the one case that cannot be fixed from inside the app: the owner losing
 * their own phone and their own backup codes. Run it from a shell on the box
 * that holds the database volume.
 *
 *   node scripts/reset-2fa.mjs michael
 *
 * The account keeps its password. The next sign-in walks them through
 * enrolling a new authenticator app, because setup_completed_at is cleared too.
 */
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

const slug = (process.argv[2] || "").trim().toLowerCase();
if (!slug) {
  console.error("Usage: node scripts/reset-2fa.mjs <account-slug>");
  process.exit(1);
}

// Same resolution as src/lib/db.ts: data/campaign-desk.db under the cwd, so
// this has to be run from the app directory.
const file = path.join(process.cwd(), "data", "campaign-desk.db");

if (!fs.existsSync(file)) {
  console.error(`No database at ${file}. Run this from the app directory.`);
  process.exit(1);
}

const db = new Database(file);
const user = db.prepare("SELECT slug, label FROM users WHERE slug = ?").get(slug);
if (!user) {
  console.error(`No account called "${slug}".`);
  process.exit(1);
}

const result = db
  .prepare(
    `UPDATE users
     SET totp_secret = NULL, totp_pending_secret = NULL, totp_confirmed_at = NULL,
         totp_last_counter = 0, totp_backup_codes = '[]',
         setup_completed_at = NULL, updated_at = ?
     WHERE slug = ?`
  )
  .run(new Date().toISOString(), slug);

console.log(
  result.changes
    ? `Two-factor removed from ${user.label} (${slug}). They will set it up again at their next sign in.`
    : `Nothing changed for ${slug}.`
);
