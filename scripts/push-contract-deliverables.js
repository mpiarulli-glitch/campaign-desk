#!/usr/bin/env node
/**
 * Populate Campaign Desk snapshot deliverables for all clients from their
 * marketing-contract scope of work.
 *
 * Reads the extracted deliverable JSON files from a directory (one file per
 * client: { client, deliverables: [{category, name, cadence}] }), resolves or
 * creates each account on the live app, clears existing deliverables, then
 * adds the contract deliverables.
 *
 * Usage:
 *   node scripts/push-contract-deliverables.js --dir <path>            # dry run
 *   node scripts/push-contract-deliverables.js --dir <path> --commit   # apply
 */

const fs = require("fs");
const path = require("path");

const BASE =
  process.env.CAMPAIGN_DESK_URL ||
  "https://campaign-desk-production.up.railway.app";
const PASSWORD = process.env.CAMPAIGN_DESK_PASSWORD || "Marketingeg1!";
const COMMIT = process.argv.includes("--commit");
const dirArg = process.argv.indexOf("--dir");
const DIR = dirArg !== -1 ? process.argv[dirArg + 1] : null;
if (!DIR) {
  console.error("Provide --dir <path to deliverable json files>");
  process.exit(1);
}

// JSON "client" name -> existing remote account name (only where they differ).
const NAME_OVERRIDE = {
  "CISCo Restaurant + Bar": "Cisco Restaurant + Bar",
  "Krak Boba Temecula": "Krak Boba",
  "Pacific Coast Generation, Inc.": "Pacific Coast Generation",
  "Pipe It Right": "Pipe It Right Plumbing",
};

let COOKIE = "";
async function api(method, p, body) {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(COOKIE ? { Cookie: COOKIE } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get("set-cookie");
  if (sc) COOKIE = sc.split(";")[0];
  const t = await res.text();
  let j;
  try { j = JSON.parse(t); } catch { j = t; }
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${t}`);
  return j;
}

function cadenceUnitFor(cadence) {
  const c = (cadence || "").toLowerCase();
  if (c.includes("week")) return "weekly";
  if (c.includes("quarter")) return "quarterly";
  if (c.includes("month")) return "monthly";
  return undefined;
}
function kindFor(cadence) {
  return (cadence || "").toLowerCase().includes("one-time")
    ? "one_time"
    : "recurring";
}

async function main() {
  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const clients = files.map((f) => {
    const data = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
    return { file: f, ...data };
  });

  await api("POST", "/api/auth", { password: PASSWORD });
  const { accounts } = await api("GET", "/api/snapshot/accounts");
  const byName = new Map(
    accounts.map((a) => [a.name.trim().toLowerCase(), a])
  );

  console.log(
    `${COMMIT ? "COMMIT" : "DRY RUN"} — ${clients.length} client file(s) against ${BASE}\n`
  );

  let created = 0, populated = 0, replaced = 0, totalDeliv = 0;

  for (const c of clients) {
    const remoteName = NAME_OVERRIDE[c.client] || c.client;
    let account = byName.get(remoteName.trim().toLowerCase());
    const existingCount = account ? account.deliverable_count : 0;

    let action;
    if (!account) action = "CREATE";
    else if (existingCount > 0) action = "REPLACE";
    else action = "POPULATE";

    console.log(
      `${action.padEnd(9)} ${c.client}` +
        (remoteName !== c.client ? `  -> "${remoteName}"` : "") +
        `  (contract=${c.deliverables.length}, existing=${existingCount})`
    );

    if (!COMMIT) {
      totalDeliv += c.deliverables.length;
      continue;
    }

    // resolve or create account
    if (!account) {
      const res = await api("POST", "/api/revenue/clients", {
        name: remoteName,
      });
      account = res.client;
      byName.set(remoteName.trim().toLowerCase(), account);
      created++;
    }

    // clear existing deliverables (idempotent; honors "replace from contract")
    const detail = await api("GET", `/api/snapshot/accounts/${account.id}`);
    const existing = detail.deliverables || [];
    for (const d of existing) {
      await api("DELETE", `/api/snapshot/deliverables/${d.id}`);
    }
    if (existing.length > 0) replaced += existing.length;

    // add contract deliverables
    for (const d of c.deliverables) {
      await api("POST", `/api/snapshot/accounts/${account.id}/deliverables`, {
        category: d.category || "",
        name: d.name,
        cadence: d.cadence || "",
        kind: kindFor(d.cadence),
        cadenceUnit: cadenceUnitFor(d.cadence),
      });
      totalDeliv++;
    }
    if (action !== "CREATE") populated++;
  }

  console.log(
    `\n${COMMIT ? "Done" : "Dry run"}. ${clients.length} clients, ${totalDeliv} deliverables` +
      (COMMIT
        ? `. Accounts created: ${created}. Existing deliverables cleared: ${replaced}.`
        : ` would be written.`)
  );
}

main().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
