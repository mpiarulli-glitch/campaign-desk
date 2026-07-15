import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { portfolioSummary } from "@/lib/revenue";

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(portfolioSummary());
}
