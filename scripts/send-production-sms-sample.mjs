/**
 * Send one sample scheduling text, or list the agency's GoHighLevel numbers.
 *
 * This calls the live web service. It never looks up a client. Client texts
 * stay off unless PRODUCTION_SMS_ENABLED=1 on that service.
 *
 * Usage:
 *   PHONE="+14155550134" node scripts/send-production-sms-sample.mjs
 *   node scripts/send-production-sms-sample.mjs --phone +14155550134 --name Michael
 *   node scripts/send-production-sms-sample.mjs --locations
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

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] || "" : "";
}
const locationsOnly = args.includes("--locations");
const phone = (flag("--phone") || process.env.PHONE || "").trim();
const contactName = (flag("--name") || process.env.CONTACT_NAME || "").trim();

if (!locationsOnly && !phone) {
  console.error("Pass --phone, or set PHONE. Use --locations to only look up numbers.");
  process.exit(1);
}

const url = `${appUrl}/api/production/sms-sample`;
console.log(`${locationsOnly ? "GET" : "POST"} ${url}`);

const response = await fetch(url, {
  method: locationsOnly ? "GET" : "POST",
  headers: {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  },
  body: locationsOnly
    ? undefined
    : JSON.stringify({ phone, contactName }),
});
const body = await response.text();

if (!response.ok) {
  console.error(`Sample text failed (${response.status}): ${body.slice(0, 800)}`);
  process.exit(1);
}

console.log(body);
