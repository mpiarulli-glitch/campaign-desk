import { NextResponse } from "next/server";
import { getAccountByToken, listWins, metricsSeries, weekData } from "@/lib/snapshot";

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

type Params = { params: Promise<{ token: string }> };

// Public, read-only. No admin auth — the token IS the access grant.
export async function GET(request: Request, { params }: Params) {
  const { token } = await params;
  const account = getAccountByToken(token);
  if (!account) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const week = new URL(request.url).searchParams.get("week") || "";
  if (!WEEK_RE.test(week)) {
    return NextResponse.json({ error: "week (YYYY-MM-DD) required" }, { status: 400 });
  }
  return NextResponse.json({
    account: { name: account.name },
    week,
    rows: weekData(account.id, week),
    wins: listWins(account.id),
    metrics: metricsSeries(account.id),
  });
}
