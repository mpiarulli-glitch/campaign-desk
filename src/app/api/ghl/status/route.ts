import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { ghlConnectionStatus } from "@/lib/ghl";

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(ghlConnectionStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}
