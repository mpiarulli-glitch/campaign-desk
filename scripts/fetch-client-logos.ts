/**
 * Pull a stored logo for every client that has a website and does not yet
 * have one. Safe to run again: clients that already have a file are skipped.
 *
 *   npx tsx scripts/fetch-client-logos.ts
 *   npx tsx scripts/fetch-client-logos.ts --dry-run
 *   npx tsx scripts/fetch-client-logos.ts --force
 *
 * `--dry-run` only prints who would be fetched. `--force` replaces a logo
 * that is already stored. Against the machine that holds the database:
 *
 *   railway run npx tsx scripts/fetch-client-logos.ts
 *
 * Files are written to data/client-logos/ (the Railway volume is /app/data).
 */
import { pullMissingClientLogos } from "../src/lib/client-logo-fetch";

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

const report = await pullMissingClientLogos({ dryRun, force });

if (dryRun) {
  console.log(`Would fetch ${report.planned.length} client(s):`);
  for (const row of report.planned) console.log(`  ${row.name} — ${row.website}`);
} else {
  console.log(`Succeeded: ${report.fetched.length}`);
  for (const row of report.fetched) console.log(`  ${row.name} — ${row.source}`);
  console.log(`Failed: ${report.failed.length}`);
  for (const row of report.failed) console.log(`  ${row.name} — ${row.error}`);
}

console.log(`Skipped: ${report.skipped.length}`);
const reasons = new Map<string, number>();
for (const row of report.skipped) {
  reasons.set(row.reason, (reasons.get(row.reason) || 0) + 1);
}
for (const [reason, count] of reasons) console.log(`  ${count} — ${reason}`);
