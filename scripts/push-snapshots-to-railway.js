#!/usr/bin/env node
/**
 * Push local account snapshots into the live Campaign Desk app on Railway.
 *
 * Reads data/campaign-desk.db and recreates each account + its deliverables,
 * weekly entries, metrics, and wins on the live app via the authenticated
 * admin API. Skips any account whose name already exists on the remote.
 *
 * Usage:
 *   node scripts/push-snapshots-to-railway.js            # dry run (default)
 *   node scripts/push-snapshots-to-railway.js --commit   # actually push
 */

const path = require("path");
const Database = require("better-sqlite3");

const URL = process.env.CAMPAIGN_DESK_URL ||
  "https://campaign-desk-production.up.railway.app";
const PASSWORD = process.env.CAMPAIGN_DESK_PASSWORD || "Marketingeg1!";
const COMMIT = process.argv.includes("--commit");

let COOKIE = "";

async function api(method, pathname, body) {
  const res = await fetch(URL + pathname, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(COOKIE ? { Cookie: COOKIE } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) COOKIE = setCookie.split(";")[0];
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) {
    throw new Error(`${method} ${pathname} -> ${res.status} ${text}`);
  }
  return json;
}

async function main() {
  const dbPath = path.join(process.cwd(), "data", "campaign-desk.db");
  const db = new Database(dbPath, { readonly: true });
  db.pragma("journal_mode = WAL");

  await api("POST", "/api/auth", { password: PASSWORD });
  const { accounts: remoteAccounts } = await api("GET", "/api/snapshot/accounts");
  const remoteNames = new Set(
    remoteAccounts.map((a) => a.name.trim().toLowerCase())
  );
  console.log(
    `Connected to ${URL}\nRemote already has ${remoteAccounts.length} account(s): ${remoteAccounts
      .map((a) => a.name)
      .join(", ") || "(none)"}\n`
  );

  const localAccounts = db
    .prepare(`SELECT * FROM rev_clients WHERE active = 1 ORDER BY name COLLATE NOCASE`)
    .all();

  console.log(`${COMMIT ? "PUSHING" : "DRY RUN — would push"} ${localAccounts.length} local account(s):\n`);

  for (const acct of localAccounts) {
    const deliverables = db
      .prepare(
        `SELECT * FROM snapshot_deliverables WHERE client_id = ? AND active = 1
         ORDER BY sort_order ASC, created_at ASC`
      )
      .all(acct.id);
    const entries = db
      .prepare(`SELECT * FROM snapshot_entries WHERE client_id = ?`)
      .all(acct.id);
    const metrics = db
      .prepare(`SELECT * FROM snapshot_metrics WHERE client_id = ? ORDER BY sort_order ASC`)
      .all(acct.id);
    const wins = db
      .prepare(`SELECT * FROM snapshot_wins WHERE client_id = ? ORDER BY sort_order ASC, created_at ASC`)
      .all(acct.id);

    const summary = `deliverables=${deliverables.length} entries=${entries.length} metrics=${metrics.length} wins=${wins.length}`;

    if (remoteNames.has(acct.name.trim().toLowerCase())) {
      console.log(`SKIP  ${acct.name} — already exists on remote (${summary})`);
      continue;
    }

    if (!COMMIT) {
      console.log(`PUSH  ${acct.name} — ${summary}`);
      continue;
    }

    // 1) account
    const { account } = await api("POST", "/api/snapshot/accounts", { name: acct.name });
    const remoteId = account.id;

    // 2) deliverables (map local id -> remote id)
    const delivMap = new Map();
    for (const d of deliverables) {
      const { deliverable } = await api(
        "POST",
        `/api/snapshot/accounts/${remoteId}/deliverables`,
        { category: d.category, name: d.name, cadence: d.cadence }
      );
      delivMap.set(d.id, deliverable.id);
    }

    // 3) weekly entries (tied to a deliverable)
    let entriesPushed = 0;
    for (const e of entries) {
      const remoteDeliv = delivMap.get(e.deliverable_id);
      if (!remoteDeliv) continue;
      await api("POST", "/api/snapshot/entry", {
        deliverableId: remoteDeliv,
        weekStart: e.week_start,
        status: e.status,
        workDone: e.work_done,
        nextSteps: e.next_steps,
        notes: e.notes,
      });
      entriesPushed++;
    }

    // 4) metrics
    for (const m of metrics) {
      await api("POST", "/api/snapshot/metric", {
        clientId: remoteId,
        metric: m.metric,
        period: m.period,
        value: m.value,
        unit: m.unit || "",
        sortOrder: m.sort_order,
      });
    }

    // 5) wins
    for (const w of wins) {
      await api("POST", "/api/snapshot/win", {
        clientId: remoteId,
        body: w.body,
        happenedOn: w.happened_on || "",
      });
    }

    // fetch the share token so we can print the live link
    const detail = await api("GET", `/api/snapshot/accounts/${remoteId}`);
    console.log(
      `DONE  ${acct.name} — ${deliverables.length} deliverables, ${entriesPushed} entries, ${metrics.length} metrics, ${wins.length} wins`
    );
    console.log(`      share link: ${URL}/snapshot/${detail.token}`);
  }

  db.close();
  console.log(`\n${COMMIT ? "Push complete." : "Dry run complete. Re-run with --commit to push."}`);
}

main().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
