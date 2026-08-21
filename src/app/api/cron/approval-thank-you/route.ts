import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { isAdminAuthenticated } from "@/lib/auth";
import { runApprovalThankYou } from "@/lib/approval-thank-you";

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

  const result = await runApprovalThankYou({ dryRun, asOf: asOf || undefined });
  const posted = result.sent.filter((row) => row.ok && !row.skipped && !row.error);
  const failed = result.sent.filter((row) => row.error);
  console.log(
    `[cron] approval-thank-you ${dryRun ? "(dry run) " : ""}` +
      `${result.due} due, ${posted.length} posted` +
      (posted.length
        ? ` [${posted.map((row) => row.clientName).join(", ")}]`
        : "") +
      (failed.length ? `, ${failed.length} failed` : "")
  );

  return NextResponse.json(result);
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
