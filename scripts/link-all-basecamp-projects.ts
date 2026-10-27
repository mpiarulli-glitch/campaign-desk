/**
 * Link every active Basecamp project to a Campaign Desk client.
 *
 * Dry-run is the default and does not write. Pass --write to apply.
 * Run from the repo root so this uses the app's SQLite file. It never
 * creates or edits Forecast tasks.
 *
 *   npx tsx scripts/link-all-basecamp-projects.ts
 *   npx tsx scripts/link-all-basecamp-projects.ts --write
 */
import { linkAllBasecampProjects } from "../src/lib/basecamp-link-all";

const write = process.argv.includes("--write");
const report = await linkAllBasecampProjects({ dryRun: !write, fresh: true });
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
