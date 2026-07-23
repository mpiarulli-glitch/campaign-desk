import { NextResponse } from "next/server";
import { isWorkflowAuthenticated } from "@/lib/auth";
import { behindReportAllClients } from "@/lib/snapshot";

// Every active client with at least one overdue deliverable, across the
// whole book — for the cross-account "what are we behind on" report.
export async function GET() {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ clients: behindReportAllClients() });
}
