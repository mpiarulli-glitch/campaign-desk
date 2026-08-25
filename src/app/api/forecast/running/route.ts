import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { runningTimersForSession } from "@/lib/forecast-running";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = runningTimersForSession(await getSession());
  return NextResponse.json(result.body, { status: result.status });
}
