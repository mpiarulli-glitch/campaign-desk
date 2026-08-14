import { NextResponse } from "next/server";
import { normalizeMetricPeriod } from "@/lib/metric-period";
import { getAccountByToken, revenueAsk, upsertRevenueReport } from "@/lib/snapshot";

type Params = { params: Promise<{ token: string }> };

// The client telling us what they did in revenue last month, from their own
// snapshot link. Public — the token is the grant — and it can only ever write
// a report for the month we are currently asking that account about, so the
// route can't be used to backfill or overwrite arbitrary months.
export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  const account = getAccountByToken(token);
  if (!account) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const month = normalizeMetricPeriod(typeof body.month === "string" ? body.month : "");
  const ask = revenueAsk(account.id);
  if (!month || !ask || month !== ask.month) {
    return NextResponse.json(
      { error: "That is not the month we're asking about" },
      { status: 400 }
    );
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json({ error: "A revenue amount is required" }, { status: 400 });
  }
  const report = upsertRevenueReport({
    clientId: account.id,
    month,
    amount,
    note: typeof body.note === "string" ? body.note : "",
  });
  return NextResponse.json({ report, ask: revenueAsk(account.id) });
}
