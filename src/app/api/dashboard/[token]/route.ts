import { NextResponse } from "next/server";
import { getClientByDashboardToken, getClientDashboardData } from "@/lib/dashboard";
import { CLIENT_HIDDEN_KPI_KEYS } from "@/lib/revenue";

type Params = { params: Promise<{ token: string }> };

// Public, read-only. The token is the access grant. The response includes
// `goals` — a deliberately narrow view of the account's OKRs (objective +
// target date + status only, via clientVisibleGoals in src/lib/dashboard.ts).
// It never includes key results (their numeric targets/current progress),
// which stay reachable only through the admin route's full listOkrs() call.
// Internal agency economics (agency margin / margin %) are stripped from the
// KPI list here — those are admin-only and must never reach a client.
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
  const safe = {
    ...data,
    accountData: {
      kpis: data.accountData.kpis.filter((k) => !CLIENT_HIDDEN_KPI_KEYS.has(k.key)),
    },
  };
  return NextResponse.json(safe);
}
