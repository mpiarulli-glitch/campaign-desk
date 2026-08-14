import { NextResponse } from "next/server";
import { isWorkflowAuthenticated } from "@/lib/auth";
import { upsertMetric } from "@/lib/revenue";
import {
  deleteRevenueReport,
  listRevenueReports,
  markRevenueReportAccepted,
} from "@/lib/snapshot";
import { getDb } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

function findReport(id: string) {
  return (
    (getDb()
      .prepare(`SELECT * FROM snapshot_revenue_reports WHERE id = ?`)
      .get(id) as { id: string; client_id: string; month: string; amount: number } | undefined) ||
    null
  );
}

// Accept a client-reported figure into rev_metrics. This is the only path from
// what a client typed to the numbers our ROI reporting runs on, which is the
// point: it takes a person deciding the figure is right.
export async function POST(_request: Request, { params }: Params) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const report = findReport(id);
  if (!report) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  upsertMetric({
    clientId: report.client_id,
    month: report.month,
    revenue: report.amount,
    revenueSource: "client",
  });
  markRevenueReportAccepted(id);
  return NextResponse.json({ reports: listRevenueReports(report.client_id) });
}

// Dismiss a report without taking the number.
export async function DELETE(_request: Request, { params }: Params) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const report = findReport(id);
  if (!report || !deleteRevenueReport(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ reports: listRevenueReports(report.client_id) });
}
