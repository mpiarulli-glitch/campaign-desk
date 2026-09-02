import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { setHubClientQuota } from "@/lib/lifecycle-hub";
import { getRevClient } from "@/lib/revenue";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const { clientId } = await params;
  if (!getRevClient(clientId)) {
    return NextResponse.json({ error: "Unknown client." }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  if (typeof body.quota !== "number" || !Number.isFinite(body.quota)) {
    return NextResponse.json({ error: "Set a deliverable count." }, { status: 400 });
  }
  const ok = setHubClientQuota(clientId, body.quota);
  if (!ok) return NextResponse.json({ error: "Could not save that quota." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
