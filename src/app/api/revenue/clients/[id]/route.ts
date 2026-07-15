import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import {
  aggregate,
  deleteRevClient,
  getRevClient,
  kpisForModel,
  listMetrics,
  updateRevClient,
} from "@/lib/revenue";
import type { BusinessModel } from "@/lib/db";

const MODELS: BusinessModel[] = ["ecomm", "b2b", "home_service"];

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const client = getRevClient(id);
  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const metrics = listMetrics(id);
  const agg = aggregate(metrics);
  const kpis = kpisForModel(client.business_model).map((k) => ({
    key: k.key,
    label: k.label,
    fmt: k.fmt,
    hint: k.hint ?? null,
    value: k.value(agg, client),
  }));
  return NextResponse.json({ client, metrics, kpis });
}

export async function PATCH(request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getRevClient(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const client = updateRevClient(id, {
    name: typeof body.name === "string" ? body.name : undefined,
    businessModel: MODELS.includes(body.businessModel)
      ? (body.businessModel as BusinessModel)
      : undefined,
    ghlLocationId:
      typeof body.ghlLocationId === "string" ? body.ghlLocationId : undefined,
    klaviyoAccount:
      typeof body.klaviyoAccount === "string" ? body.klaviyoAccount : undefined,
    retainer: typeof body.retainer === "number" ? body.retainer : undefined,
    monthlyCost:
      typeof body.monthlyCost === "number" ? body.monthlyCost : undefined,
    ltv:
      body.ltv === null || typeof body.ltv === "number" ? body.ltv : undefined,
    active: typeof body.active === "boolean" ? body.active : undefined,
  });
  return NextResponse.json({ client });
}

export async function DELETE(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const ok = deleteRevClient(id);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
