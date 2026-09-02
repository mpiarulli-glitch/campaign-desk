import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { getRefreshSettings, setRefreshSettings } from "@/lib/lifecycle";
import { clearSkyleadCache } from "@/lib/skylead";

export async function GET() {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  return NextResponse.json({ settings: getRefreshSettings() });
}

export async function PATCH(request: Request) {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const settings = setRefreshSettings({
    staleDays: body.staleDays,
    minAcceptanceRate: body.minAcceptanceRate,
    minResponseRate: body.minResponseRate,
    minVolume: body.minVolume,
    decayDropPercent: body.decayDropPercent,
  });
  clearSkyleadCache();
  return NextResponse.json({ settings });
}
