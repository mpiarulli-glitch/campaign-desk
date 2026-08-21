import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { isAdminAuthenticated } from "@/lib/auth";
import { runWeeklyAsks } from "@/lib/client-services";

// The Friday sweep that asks every active client about their leads and revenue.
// Same auth shape as the other cron routes: an admin session, or the shared
// CRON_SECRET as a bearer token or ?secret= for the GitHub workflow.

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

async function handle(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const only = url.searchParams.get("only") || undefined;
  const today = url.searchParams.get("today") || undefined;
  if (today && !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return NextResponse.json({ error: "today must be YYYY-MM-DD" }, { status: 400 });
  }

  const result = await runWeeklyAsks({ dryRun, only, today });
  const emails = result.sent.filter((r) => r.email.ok && !r.email.skipped).length;
  const cards = result.sent.filter((r) => r.basecamp.ok && !r.basecamp.skipped).length;
  console.log(
    `[cron] weekly-snapshot ${dryRun ? "(dry run) " : ""}week ${result.weekStart}: ` +
      `${result.considered} considered, ${emails} emailed, ${cards} carded, ` +
      `skipped ${result.skipped.paused} paused / ` +
      `${result.skipped.alreadySent} already sent / ` +
      `${result.skipped.nothingToAsk} nothing to ask`
  );
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
