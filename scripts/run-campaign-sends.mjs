/**
 * Railway / GitHub cron entrypoint: flip scheduled campaigns to Sent after
 * their send datetime.
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

const response = await fetch(`${appUrl}/api/cron/campaign-sends`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  },
});
const body = await response.text();

if (!response.ok) {
  console.error(
    `Campaign-sends run failed (${response.status}): ${body.slice(0, 500)}`
  );
  process.exit(1);
}

console.log(body);
