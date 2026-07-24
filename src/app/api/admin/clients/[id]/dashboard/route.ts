import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { getClientDashboardData } from "@/lib/dashboard";
import { listOkrs } from "@/lib/okrs";
import { getRevClient } from "@/lib/revenue";

type Params = { params: Promise<{ id: string }> };

// Admin-only. Same aggregate as the public dashboard route, plus OKRs and tier
// (tier is an internal classification, never surfaced on the public route).
export async function GET(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const data = getClientDashboardData(id);
  const client = getRevClient(id);
  if (!data || !client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    ...data,
    client: { ...data.client, tier: client.tier },
    okrs: listOkrs(id),
  });
}
