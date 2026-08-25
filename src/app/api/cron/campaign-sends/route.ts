import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { isAdminAuthenticated } from "@/lib/auth";
import { runScheduledCampaignSends } from "@/lib/campaign-schedule";

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
  const asOf = url.searchParams.get("asOf") || "";
  if (asOf && !/^\d{4}-\d{2}-\d{2}T/.test(asOf)) {
    return NextResponse.json(
      { error: "asOf must be an ISO timestamp" },
      { status: 400 }
    );
  }

  const result = runScheduledCampaignSends({
    dryRun,
    asOf: asOf || undefined,
  });
  console.log(
    `[cron] campaign-sends ${dryRun ? "(dry run) " : ""}` +
      `${result.due} due, ${result.flipped.length} flipped` +
      (result.flipped.length
        ? ` [${result.flipped.map((row) => row.title).join(", ")}]`
        : "")
  );

  return NextResponse.json(result);
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
