import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { isAdminAuthenticated } from "@/lib/auth";
import { runReminders, runShootReminders } from "@/lib/reminders";

// Constant-time compare so the secret can't be probed by timing.
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
  // Either a valid admin session (for manual runs from a browser) or the
  // shared cron secret via Authorization: Bearer / ?secret=.
  if (await isAdminAuthenticated()) return true;
  const url = new URL(request.url);
  const header = request.headers.get("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ")
    ? header.slice(7)
    : null;
  return secretMatches(bearer || url.searchParams.get("secret"));
}

async function handle(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  // ?only=<client id or name> targets one account, for testing the outreach
  // without mailing everybody else. The shoot reminders are left out of a
  // targeted run: they are a different job and nothing about them is per-client.
  const only = url.searchParams.get("only") || undefined;
  // &newCard=1 forces a fresh Basecamp card. Ignored without ?only=, so it can
  // never create a card for every client at once.
  const newCard = url.searchParams.get("newCard") === "1";
  const result = await runReminders({ dryRun, only, newCard });
  if (only) {
    return NextResponse.json({ ...result, targeted: only });
  }
  const shootReminders = await runShootReminders({ dryRun });
  return NextResponse.json({ ...result, shootReminders });
}

// Support GET so simple cron pingers work, and POST for stricter setups.
export async function GET(request: Request) {
  return handle(request);
}
export async function POST(request: Request) {
  return handle(request);
}
