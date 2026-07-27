/**
 * Railway cron entrypoint for production scheduling reminders.
 *
 * This intentionally calls the live web service instead of opening SQLite
 * from a second service/container. The web service remains the single owner of
 * the persistent database volume.
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

const response = await fetch(`${appUrl}/api/cron/reminders`, {
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
