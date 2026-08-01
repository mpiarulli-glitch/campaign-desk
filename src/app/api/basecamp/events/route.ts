import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { isAdminAuthenticated } from "@/lib/auth";
import { lastEventSyncAt, syncBasecampEvents } from "@/lib/basecamp-events";

// Constant-time compare so the secret can't be probed by timing. Same shape as
// the reminders cron route.
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

// An admin session (manual "Sync now") or the cron secret (scheduled run).
async function authorized(request: Request): Promise<boolean> {
  if (await isAdminAuthenticated()) return true;
  const url = new URL(request.url);
  const header = request.headers.get("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ") ? header.slice(7) : null;
  return secretMatches(bearer || url.searchParams.get("secret"));
}

// When the cache was last refreshed, for the calendar to show.
export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ lastSyncAt: lastEventSyncAt() });
}

// Re-sweep Basecamp. Takes ~95 requests, so expect this to run for a while.
export async function POST(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await syncBasecampEvents();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
