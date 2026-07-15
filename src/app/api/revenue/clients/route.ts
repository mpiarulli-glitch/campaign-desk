import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { createRevClient, listRevClients } from "@/lib/revenue";
import type { BusinessModel } from "@/lib/db";

const MODELS: BusinessModel[] = ["ecomm", "b2b", "home_service"];

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const includeInactive =
    new URL(request.url).searchParams.get("all") === "1";
  return NextResponse.json({ clients: listRevClients(includeInactive) });
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const businessModel = MODELS.includes(body.businessModel)
    ? (body.businessModel as BusinessModel)
    : "home_service";
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  const client = createRevClient({
    name,
    businessModel,
    ghlLocationId: typeof body.ghlLocationId === "string" ? body.ghlLocationId : "",
    klaviyoAccount:
      typeof body.klaviyoAccount === "string" ? body.klaviyoAccount : "",
    retainer: typeof body.retainer === "number" ? body.retainer : 0,
    monthlyCost: typeof body.monthlyCost === "number" ? body.monthlyCost : 0,
    ltv: typeof body.ltv === "number" ? body.ltv : null,
  });
  return NextResponse.json({ client }, { status: 201 });
}
