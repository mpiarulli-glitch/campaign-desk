import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { isAdminAuthenticated } from "@/lib/auth";
import { runWeeklyAsks } from "@/lib/client-services";

// The Friday sweep. It never sends email or Basecamp posts. A person sends one
// client from Client Services. Auth matches the other cron routes: an admin
// session, or the shared CRON_SECRET as a bearer token or ?secret=. The secret
// is checked first so a scheduled caller does not need a browser session.

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
  const url = new URL(request.url);
  const header = request.headers.get("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ")
    ? header.slice(7)
    : null;
  if (secretMatches(bearer || url.searchParams.get("secret"))) return true;
  return isAdminAuthenticated();
}

async function handle(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const only = url.searchParams.get("only") || undefined;
  const today = url.searchParams.get("today") || undefined;
  if (today && !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return NextResponse.json({ error: "today must be YYYY-MM-DD" }, { status: 400 });
  }

  // Always a dry run. dryRun=0, a missing flag, and CLIENT_SERVICES_SENDING=on
  // are all ignored. runWeeklyAsks refuses a live send on its own as well.
  const result = await runWeeklyAsks({ dryRun: true, only, today });
  const emails = result.sent.filter((r) => r.email.ok && !r.email.skipped).length;
  const posted = result.sent.filter((r) => r.basecamp.ok && !r.basecamp.skipped).length;
  console.log(
    `[cron] weekly-snapshot (dry run) week ${result.weekStart}: ` +
      `${result.considered} considered, ${emails} emailed, ${posted} posted, ` +
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
