import { NextResponse } from "next/server";
import { getClientByDashboardToken, getClientDashboardData } from "@/lib/dashboard";

type Params = { params: Promise<{ token: string }> };

// Public, read-only. The token is the access grant. Deliberately does not
// import src/lib/okrs.ts anywhere in this file — OKRs are internal-only and
// must never be reachable through this route.
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
