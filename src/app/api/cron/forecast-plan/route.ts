import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { isAdminAuthenticated } from "@/lib/auth";
import { OWNER_SLUG } from "@/lib/people";
import { runForecastPlan } from "@/lib/forecast-plan-run";

// Monday fill of Michael's forecast from his Basecamp to-dos. Same auth shape
// as the other cron routes: an admin session, or CRON_SECRET as a bearer token
// / ?secret= for the GitHub workflow.

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
  const week = url.searchParams.get("week") || undefined;
  if (week && !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return NextResponse.json({ error: "week must be YYYY-MM-DD" }, { status: 400 });
  }

  const result = await runForecastPlan({
    person: OWNER_SLUG,
    week,
    dryRun,
  });
  console.log(
    `[cron] forecast-plan ${dryRun ? "(dry run) " : ""}week ${result.week}: ` +
      `created ${result.created}, moved ${result.moved}, skipped ${result.skipped}, ` +
      `unplaced ${result.unplaced.length}` +
      (result.assignmentsReason ? ` (${result.assignmentsReason})` : "")
  );
  return NextResponse.json({
    week: result.week,
    created: result.created,
    moved: result.moved,
    skipped: result.skipped,
    unplaced: result.unplaced,
    assignmentsReason: result.assignmentsReason,
    dryRun: result.dryRun,
  });
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
