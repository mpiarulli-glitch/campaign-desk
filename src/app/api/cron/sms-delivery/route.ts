import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { isAdminAuthenticated } from "@/lib/auth";
import { alertSmsFailures, refreshSmsDeliveries } from "@/lib/production-sms";

function secretMatches(provided: string | null): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || !provided) return false;
  const a = createHmac("sha256", expected).update(provided).digest();
  const b = createHmac("sha256", expected).update(expected).digest();
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function authorized(request: Request): Promise<boolean> {
  if (await isAdminAuthenticated()) return true;
  const url = new URL(request.url);
  const header = request.headers.get("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ")
    ? header.slice(7)
    : null;
  return secretMatches(bearer || url.searchParams.get("secret"));
}

/**
 * Re-check texts that GHL has not finished with. Does not send any texts.
 * Failures from this pass are one alert, not one per client.
 */
async function handle(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const caught = await refreshSmsDeliveries();
  const alert = await alertSmsFailures(caught);
  console.log(
    `[cron] sms-delivery checked, ${caught.length} newly failed` +
      (alert ? ` alert="${alert.subject}"` : "")
  );
  return NextResponse.json({
    failed: caught.map((item) => ({ client: item.client, reason: item.reason })),
    alert: alert?.subject || null,
  });
}

export async function GET(request: Request) {
  return handle(request);
}
export async function POST(request: Request) {
  return handle(request);
}
