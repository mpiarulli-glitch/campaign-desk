import { NextResponse } from "next/server";
import { getClientByDashboardToken, getClientDashboardData } from "@/lib/dashboard";

type Params = { params: Promise<{ token: string }> };

// Public, read-only. The token is the access grant. The response includes
// `goals` — a deliberately narrow view of the account's OKRs (objective +
// target date + status only, via clientVisibleGoals in src/lib/dashboard.ts).
// It never includes key results (their numeric targets/current progress),
// which stay reachable only through the admin route's full listOkrs() call.
export async function GET(_request: Request, { params }: Params) {
  const { token } = await params;
  const client = getClientByDashboardToken(token);
  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const data = getClientDashboardData(client.id);
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(data);
}
