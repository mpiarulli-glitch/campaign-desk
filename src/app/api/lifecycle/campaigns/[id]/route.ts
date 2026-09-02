import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { campaignHistory, upsertCampaignMeta } from "@/lib/lifecycle";
import { clearSkyleadCache } from "@/lib/skylead";

// Our local overlay on a Skylead campaign: which client owns it, a custom
// refresh interval, muting, and "I just refreshed this".
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return NextResponse.json({ error: "Bad campaign id" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));

  let refreshIntervalDays: number | null | undefined;
  if (body.refreshIntervalDays === null) {
    refreshIntervalDays = null;
  } else if (typeof body.refreshIntervalDays === "number") {
    const n = Math.round(body.refreshIntervalDays);
    if (!Number.isFinite(n) || n < 1 || n > 3650) {
      return NextResponse.json(
        { error: "Refresh interval must be between 1 and 3650 days." },
        { status: 400 }
      );
    }
    refreshIntervalDays = n;
  }

  const meta = upsertCampaignMeta(campaignId, {
    clientId: body.clientId === null || typeof body.clientId === "string" ? body.clientId : undefined,
    refreshIntervalDays,
    muted: typeof body.muted === "boolean" ? body.muted : undefined,
    note: typeof body.note === "string" ? body.note : undefined,
    markRefreshed: body.markRefreshed === true,
  });

  // The dashboard reads a cached sweep; drop it so the change shows at once.
  clearSkyleadCache();

  return NextResponse.json({ meta });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return NextResponse.json({ error: "Bad campaign id" }, { status: 400 });
  }
  return NextResponse.json({ history: campaignHistory(campaignId) });
}
