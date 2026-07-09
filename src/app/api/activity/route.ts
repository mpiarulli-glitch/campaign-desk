import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { listActivity } from "@/lib/campaigns";

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ activity: listActivity(150) });
}
