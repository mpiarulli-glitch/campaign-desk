#!/usr/bin/env node
/**
 * Set snapshot launch dates (and 6-month contracts, 12 months for HR)
 * from the account roster sheet.
 *
 *   node scripts/set-snapshot-launch-dates.js            # local data/campaign-desk.db
 *   node scripts/set-snapshot-launch-dates.js --hub      # live hub via API
 */

const path = require("path");
const Database = require("better-sqlite3");

const URL = process.env.CAMPAIGN_DESK_URL || "https://hub.marketingempiregroup.com";
const HUB = process.argv.includes("--hub");

const ROWS = [
  { names: ["betterlife coach", "the betterlife coach"], launch: "2026-01-28", months: 6 },
  { names: ["pacific coast generation"], launch: "2026-02-04", months: 6 },
  { names: ["hr innovator"], launch: "2026-06-04", months: 12 },
  { names: ["looda house"], launch: "2026-07-20", months: 6 },
  { names: ["our watch"], launch: "2026-07-16", months: 6 },
  { names: ["hendo", "hendos barrel"], launch: "2026-06-19", months: 6 },
  { names: ["ecoworkz"], launch: "2025-04-22", months: 6 },
  { names: ["cisco"], launch: "2025-08-11", months: 6 },
  { names: ["pipe it right"], launch: "2025-02-11", months: 6 },
  { names: ["cipo"], launch: "2025-07-10", months: 6 },
  { names: ["guardian plumber"], launch: "2024-07-19", months: 6 },
  { names: ["vitatherapy"], launch: "2026-06-25", months: 6 },
  { names: ["12 volt"], launch: "2025-02-21", months: 6 },
  { names: ["kentina", "kentin"], launch: "2026-06-19", months: 6 },
  { names: ["krak boba corporate", "krak boba - corporate"], launch: "2026-07-02", months: 6 },
];

function fold(s) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[''`´]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchRow(name) {
  const f = fold(name);
  return ROWS.find((row) =>
    row.names.some((n) => f === n || f.includes(n) || (n.length >= 8 && n.includes(f)))
  );
}

function addMonths(ymd, months) {
  const [y, m, d] = ymd.split("-").map(Number);
  const last = new Date(y, m - 1 + months + 1, 0).getDate();
  const dt = new Date(y, m - 1 + months, Math.min(d, last));
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

async function applyHub() {
  const password = process.env.CAMPAIGN_DESK_PASSWORD;
  if (!password) {
    console.error("Set CAMPAIGN_DESK_PASSWORD to update the hub.");
    process.exit(1);
  }
  let cookie = "";
  async function api(method, pathname, body) {
    const res = await fetch(URL + pathname, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    if (!res.ok) throw new Error(`${method} ${pathname} -> ${res.status} ${text}`);
    return json;
  }

  await api("POST", "/api/auth", { account: "michael", password });
  const { accounts } = await api("GET", "/api/snapshot/accounts");
  let updated = 0;
  let skipped = 0;
  for (const acct of accounts) {
    const row = matchRow(acct.name);
    if (!row) {
      console.log(`NO DATE  ${acct.name}`);
      skipped += 1;
      continue;
    }
    const end = addMonths(row.launch, row.months);
    try {
      const saved = await api("PATCH", `/api/snapshot/accounts/${acct.id}`, {
        launchDate: row.launch,
        contractMonths: row.months,
      });
      console.log(
        `OK  ${acct.name}  launch ${row.launch}  through ${saved.contractEnd}  (${row.months} mo)`
      );
    } catch (err) {
      await api("PATCH", `/api/revenue/clients/${acct.id}`, {
        contractStart: row.launch,
        contractEnd: end,
      });
      console.log(
        `OK  ${acct.name}  launch ${row.launch}  through ${end}  (${row.months} mo, contract fields)`
      );
    }
    updated += 1;
  }
  console.log(`\nHub: updated ${updated}, skipped ${skipped}`);
}

function applyLocal() {
  const dbPath = path.join(process.cwd(), "data", "campaign-desk.db");
  const db = new Database(dbPath);
  const cols = db.prepare(`PRAGMA table_info(rev_clients)`).all().map((c) => c.name);
  if (!cols.includes("snapshot_launch_date")) {
    db.exec(`ALTER TABLE rev_clients ADD COLUMN snapshot_launch_date TEXT`);
  }
  const clients = db
    .prepare(`SELECT id, name FROM rev_clients WHERE active = 1 ORDER BY name COLLATE NOCASE`)
    .all();
  const now = new Date().toISOString();
  const upd = db.prepare(
    `UPDATE rev_clients
        SET snapshot_launch_date = ?, contract_start = ?, contract_end = ?, updated_at = ?
      WHERE id = ?`
  );
  let updated = 0;
  let skipped = 0;
  for (const acct of clients) {
    const row = matchRow(acct.name);
    if (!row) {
      skipped += 1;
      continue;
    }
    const end = addMonths(row.launch, row.months);
    upd.run(row.launch, row.launch, end, now, acct.id);
    console.log(`OK  ${acct.name}  launch ${row.launch}  through ${end}  (${row.months} mo)`);
    updated += 1;
  }
  console.log(`\nLocal: updated ${updated} snapshot accounts (${skipped} other clients left alone)`);
}

async function main() {
  if (HUB) await applyHub();
  else applyLocal();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
