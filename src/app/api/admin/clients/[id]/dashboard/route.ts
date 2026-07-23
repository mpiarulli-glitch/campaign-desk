import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { getClientDashboardData } from "@/lib/dashboard";
import { listOkrs } from "@/lib/okrs";

type Params = { params: Promise<{ id: string }> };

// Admin-only. Same aggregate as the public dashboard route, plus OKRs.
export async function GET(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const data = getClientDashboardData(id);
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ...data, okrs: listOkrs(id) });
}
