/**
 * Railway cron entrypoint for scheduling-text delivery checks.
 *
 * Calls the live web service. It only re-reads GoHighLevel message status.
 * It does not send texts.
 *
 * Usage:
 *   node scripts/run-sms-delivery.mjs
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

const url = `${appUrl}/api/cron/sms-delivery`;
console.log(`POST ${url}`);

const response = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  },
});
const body = await response.text();

if (!response.ok) {
  console.error(`SMS delivery check failed (${response.status}): ${body.slice(0, 500)}`);
  process.exit(1);
}

console.log(body);
