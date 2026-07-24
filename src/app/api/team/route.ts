import { NextResponse } from "next/server";
import { isWorkflowAuthenticated } from "@/lib/auth";
import { TEAM } from "@/lib/team";

export async function GET() {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ team: TEAM });
}
