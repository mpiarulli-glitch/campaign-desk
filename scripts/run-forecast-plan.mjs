/**
 * Railway / GitHub cron entrypoint for Michael's Monday forecast fill.
 *
 * Pass --dry-run to see what would be booked without writing anything.
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

const dryRun = process.argv.includes("--dry-run");
const url = `${appUrl}/api/cron/forecast-plan${dryRun ? "?dryRun=1" : ""}`;

const response = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  },
});
const body = await response.text();

if (!response.ok) {
  console.error(
    `Forecast plan run failed (${response.status}): ${body.slice(0, 500)}`
  );
  process.exit(1);
}

console.log(body);
