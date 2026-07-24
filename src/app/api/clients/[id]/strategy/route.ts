import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { getRevClient } from "@/lib/revenue";
import { getStrategy, upsertStrategy } from "@/lib/strategy";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getRevClient(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ strategy: getStrategy(id) });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getRevClient(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const strategy = upsertStrategy(id, {
    positioning: typeof body.positioning === "string" ? body.positioning : undefined,
    audience: typeof body.audience === "string" ? body.audience : undefined,
    goals: typeof body.goals === "string" ? body.goals : undefined,
    channels: Array.isArray(body.channels) ? body.channels : undefined,
    cadenceNotes: typeof body.cadenceNotes === "string" ? body.cadenceNotes : undefined,
    plan: body.plan && typeof body.plan === "object" && !Array.isArray(body.plan) ? body.plan : undefined,
  });
  return NextResponse.json({ strategy });
}
