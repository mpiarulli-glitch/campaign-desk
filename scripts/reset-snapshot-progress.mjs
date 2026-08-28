#!/usr/bin/env node
/**
 * Wipe weekly snapshot fill progress while keeping deliverable definitions.
 *
 * Usage:
 *   npx tsx scripts/reset-snapshot-progress.mjs
 *   npx tsx scripts/reset-snapshot-progress.mjs --commit
 *   npx tsx scripts/reset-snapshot-progress.mjs --all
 *   npx tsx scripts/reset-snapshot-progress.mjs --client "Pacific Coast Generation"
 *   npx tsx scripts/reset-snapshot-progress.mjs --client-id cl_abc123
 *
 * Default is a dry run over snapshot-allowlisted accounts only.
 * Writes to data/campaign-desk.db (local) unless run on the Railway volume.
 */

const args = process.argv.slice(2);
const dryRun = !args.includes("--commit");
const all = args.includes("--all");
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

  const result = clientIds
    ? snapshot.resetSnapshotProgress({ clientIds, allowlistedOnly: false, dryRun })
    : snapshot.resetSnapshotProgress({ allowlistedOnly: !all, dryRun });

  console.log(
    dryRun
      ? "[dry run] Would clear snapshot fill progress"
      : "Cleared snapshot fill progress"
  );
  console.log(
    clientIds
      ? `Scope: ${result.clients.map((c) => c.name).join(", ") || clientIds.join(", ")}`
      : all
        ? "Scope: all active accounts with deliverables"
        : "Scope: snapshot allowlist"
  );
  console.log(`Accounts: ${result.clients.length}`);
  for (const client of result.clients) {
    console.log(`  - ${client.name}`);
  }
  console.log(`  entries:          ${result.deleted.entries}`);
  console.log(`  wins:             ${result.deleted.wins}`);
  console.log(`  leads:            ${result.deleted.leads}`);
  console.log(`  metrics:          ${result.deleted.metrics}`);
  console.log(`  revenue reports:  ${result.deleted.revenueReports}`);
  console.log(`  outreach logs:    ${result.deleted.outreach}`);

  if (dryRun) {
    console.log("\nNo changes made. Re-run with --commit to wipe.");
  } else {
    console.log("\nDone. Deliverable definitions were not touched.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
