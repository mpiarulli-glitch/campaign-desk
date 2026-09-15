/**
 * Railway cron entrypoint for production scheduling reminders.
 *
 * This intentionally calls the live web service instead of opening SQLite
 * from a second service/container. The web service remains the single owner of
 * the persistent database volume.
 *
 * Usage:
 *   node scripts/run-production-reminders.mjs
 *   node scripts/run-production-reminders.mjs --catch-up
 *   node scripts/run-production-reminders.mjs --dry-run --catch-up
 *
 * CATCH_UP=1 / DRY_RUN=1 env vars work the same as the flags.
 */
const appUrl = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "")
  .trim()
  .replace(/\/$/, "");
const secret = (process.env.CRON_SECRET || "").trim();

if (!appUrl || !secret) {
  console.error(
    "APP_URL (or NEXT_PUBLIC_APP_URL) and CRON_SECRET are required."
  );
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const catchUp =
  args.has("--catch-up") ||
  args.has("--catchUp") ||
  process.env.CATCH_UP === "1";
const dryRun =
  args.has("--dry-run") ||
  args.has("--dryRun") ||
  process.env.DRY_RUN === "1";

const qs = new URLSearchParams();
if (catchUp) qs.set("catchUp", "1");
if (dryRun) qs.set("dryRun", "1");
const url = `${appUrl}/api/cron/reminders${qs.toString() ? `?${qs}` : ""}`;

console.log(`POST ${url.replace(secret, "***")}`);

const response = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  },
});
const body = await response.text();

if (!response.ok) {
  console.error(`Reminder run failed (${response.status}): ${body.slice(0, 500)}`);
  process.exit(1);
}

console.log(body);
