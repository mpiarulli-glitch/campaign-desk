import { NextResponse } from "next/server";
import { isWorkflowAuthenticated } from "@/lib/auth";
import { activeFlagSummary } from "@/lib/client-flags";

// Agency-wide roll-up: active flag summary keyed by client id.
export async function GET() {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ summary: activeFlagSummary() });
}
