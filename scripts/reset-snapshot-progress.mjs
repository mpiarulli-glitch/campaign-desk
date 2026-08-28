#!/usr/bin/env node
/**
 * Wipe weekly snapshot fill progress while keeping deliverable definitions.
 *
 * By default only allowlisted snapshot accounts are reset.
 *
 * Usage:
 *   npx tsx scripts/reset-snapshot-progress.mjs --dry-run
 *   npx tsx scripts/reset-snapshot-progress.mjs
 *   npx tsx scripts/reset-snapshot-progress.mjs --all
 *   npx tsx scripts/reset-snapshot-progress.mjs --client "Pacific Coast Generation"
 *   npx tsx scripts/reset-snapshot-progress.mjs --client-id cl_abc123
 *
 * Writes to data/campaign-desk.db (local) unless DATABASE_PATH is set.
 */

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const allAccounts = args.includes("--all");
const clientName = argValue("--client");
const clientIdArg = argValue("--client-id");

function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
}

async function main() {
  const snapshot = await import("../src/lib/snapshot.ts");
  const { getDb } = await import("../src/lib/db.ts");

  let clientIds;
  if (clientIdArg) {
    clientIds = [clientIdArg];
  } else if (clientName) {
    const row = getDb()
      .prepare(`SELECT id, name FROM rev_clients WHERE lower(name) = lower(?) AND active = 1`)
      .get(clientName);
    if (!row) {
      console.error(`No active client named "${clientName}".`);
      process.exit(1);
    }
    clientIds = [row.id];
    console.log(`Client: ${row.name} (${row.id})`);
  }

  const result = snapshot.resetSnapshotProgress({
    clientIds,
    allowlistedOnly: !allAccounts && !clientIds,
    dryRun,
  });

  const label = dryRun ? "[dry run] Would clear" : "Cleared";
  const scope =
    clientIds?.length === 1
      ? `client ${clientIds[0]}`
      : allAccounts
        ? "all accounts with deliverables"
        : "allowlisted accounts";
  console.log(`${label} snapshot fill progress for ${scope} (${result.clients.length} clients):`);
  for (const c of result.clients) console.log(`  - ${c.name}`);
  console.log(`  entries:         ${result.deleted.entries}`);
  console.log(`  wins:            ${result.deleted.wins}`);
  console.log(`  leads:           ${result.deleted.leads}`);
  console.log(`  metrics:         ${result.deleted.metrics}`);
  console.log(`  revenue reports: ${result.deleted.revenueReports}`);
  console.log(`  outreach:        ${result.deleted.outreach}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
