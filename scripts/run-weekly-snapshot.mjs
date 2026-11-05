/**
 * Dry-run entrypoint for the Friday weekly snapshot ask.
 *
 * This cannot send email or Basecamp posts. The cron endpoint refuses a live
 * send. A person sends from Client Services.
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

const url = `${appUrl}/api/cron/weekly-snapshot?dryRun=1`;

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
    `Weekly snapshot run failed (${response.status}): ${body.slice(0, 500)}`
  );
  process.exit(1);
}

console.log(body);
