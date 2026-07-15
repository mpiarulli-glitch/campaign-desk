import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import {
  deleteMetric,
  getRevClient,
  listMetrics,
  upsertMetric,
} from "@/lib/revenue";

type Params = { params: Promise<{ id: string }> };

const MONTH_RE = /^\d{4}-\d{2}$/;
const num = (v: unknown) => (typeof v === "number" ? v : undefined);

export async function GET(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getRevClient(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ metrics: listMetrics(id) });
}

export async function POST(request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getRevClient(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const month = typeof body.month === "string" ? body.month : "";
  if (!MONTH_RE.test(month)) {
    return NextResponse.json(
      { error: "month must be YYYY-MM" },
      { status: 400 }
    );
  }
  const metric = upsertMetric({
    clientId: id,
    month,
    revenue: num(body.revenue),
    orders: num(body.orders),
    appointments: num(body.appointments),
    leads: num(body.leads),
    recipients: num(body.recipients),
    campaignsSent: num(body.campaignsSent),
    opens: num(body.opens),
    clicks: num(body.clicks),
    revenueSource: body.revenueSource,
    activitySource: body.activitySource,
    note: typeof body.note === "string" ? body.note : undefined,
  });
  return NextResponse.json({ metric });
}

export async function DELETE(request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const month = new URL(request.url).searchParams.get("month") || "";
  if (!MONTH_RE.test(month)) {
    return NextResponse.json({ error: "month required" }, { status: 400 });
  }
  const ok = deleteMetric(id, month);
  return NextResponse.json({ ok });
}
