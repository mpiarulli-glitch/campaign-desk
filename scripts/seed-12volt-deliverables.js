#!/usr/bin/env node
/**
 * Seed 12 Volt Power's deliverables into the local Campaign Desk database,
 * taken from the client's services roadmap sheet.
 *
 * Usage:
 *   node scripts/seed-12volt-deliverables.js          # insert (skips if already present)
 *   node scripts/seed-12volt-deliverables.js --reset   # remove existing, then re-insert
 *
 * Writes to data/campaign-desk.db (same DB the dev server uses).
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

// Guess a short cadence from the deliverable name.
function cadenceFor(name) {
  const n = name.toLowerCase();
  if (n.includes("quarterly")) return "Quarterly";
  if (n.includes("weekly") || n.includes("posts/wk")) return "Weekly";
  if (n.includes("monthly") || n.includes("per month") || n.includes("/month") || n.includes("x/month")) return "Monthly";
  return "";
}

// category -> ordered list of deliverable names, straight from the roadmap.
const ROADMAP = [
  ["Revenue Strategy & Market Domination", [
    "Go-To-Market Strategy (quarterly)",
    "Market Research",
    "Monthly Strategy Meeting",
    "Systems Access (Google, Social, Website)",
    "CRM, Email & SMS Setup",
    "Brand Positioning & Messaging Framework",
    "Editorial Calendar",
    "Competitive Benchmarking Reports",
    "ICP (Ideal Customer Profile) Development",
    "Quarterly Growth Plan & Scaling Recommendations",
  ]],
  ["Search Domination (Google Maps & SEO)", [
    "Google Business Profile Management (monthly)",
    "Directory Listings (60+ directories)",
    "SEO Management - 180 hours total (avg. 30 hrs/mo)",
    "Blogging / Content / Website Pages - 24 pieces total (avg. 4x/month)",
  ]],
  ["Estimate & Booking Conversion System", [
    "Cookie & Tracking Configuration - up to 250/day",
    "AI Chatbot / Booking Bot",
    "Video Production (Monthly)",
    "Funnel & Lead Magnet Creation (2 funnels)",
    "Website Optimizations (Monthly)",
    "Landing Page CRO Audits (Monthly)",
    "ADA Compliance Support",
  ]],
  ["Nurturing & Automation", [
    "Email Marketing Newsletters (48 total emails, avg. 8 per month)",
    "Email Automation Setup (4 automations)",
    "Automations (Quote Follow-Up, Missed Calls, etc.)",
    "Instant Booking Confirmations",
    "Automatic Follow-Ups on Form Submissions",
    "Facebook & Instagram Auto-Replies",
    "Attribution Tracking & Call Tracking",
  ]],
  ["Creative Content", [
    "Social Media Management - 168 total posts (avg. 7/wk: 3 videos, 4 graphics)",
    "Graphic Design (print materials and flyers, up to 4 per month)",
    "Short-Form Video Creation (Reels, Shorts, TikTok)",
    "Brand Guidelines Creation",
  ]],
  ["Paid Media", [
    "Google Ads",
    "Meta Ads",
  ]],
  ["Add-Ons", [
    "A la carte Requests",
  ]],
];

function main() {
  const reset = process.argv.includes("--reset");
  const dbPath = path.join(process.cwd(), "data", "campaign-desk.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const acct = db
    .prepare(`SELECT * FROM rev_clients WHERE name = ? COLLATE NOCASE`)
    .get("12 Volt Power");
  if (!acct) {
    console.error('No "12 Volt Power" account found. Create it first.');
    process.exit(1);
  }

  const existing = db
    .prepare(
      `SELECT COUNT(*) AS n FROM snapshot_deliverables WHERE client_id = ? AND active = 1`
    )
    .get(acct.id).n;

  if (existing > 0 && !reset) {
    console.log(
      `Account already has ${existing} active deliverables. Re-run with --reset to replace them.`
    );
    db.close();
    return;
  }

  const insert = db.prepare(
    `INSERT INTO snapshot_deliverables
      (id, client_id, category, name, cadence, sort_order, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
  );

  const run = db.transaction(() => {
    if (reset && existing > 0) {
      db.prepare(
        `UPDATE snapshot_deliverables SET active = 0 WHERE client_id = ?`
      ).run(acct.id);
      console.log(`Soft-deleted ${existing} existing deliverable(s).`);
    }
    let order = 0;
    let count = 0;
    for (const [category, names] of ROADMAP) {
      for (const name of names) {
        const ts = nowIso();
        insert.run(id(12), acct.id, category, name, cadenceFor(name), order++, ts, ts);
        count++;
      }
    }
    return count;
  });

  const count = run();
  console.log(`Added ${count} deliverables across ${ROADMAP.length} categories to "${acct.name}".`);
  db.close();
}

main();
