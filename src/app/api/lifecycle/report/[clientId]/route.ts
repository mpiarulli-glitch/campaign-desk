import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { buildAccountReport } from "@/lib/lifecycle-dashboard";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const { clientId } = await params;
  const raw = Number(new URL(request.url).searchParams.get("months"));
  const months = Number.isFinite(raw) && raw >= 1 && raw <= 36 ? Math.round(raw) : 6;

  const report = await buildAccountReport(clientId, months);
  if (!report) return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  return NextResponse.json({ report });
}
