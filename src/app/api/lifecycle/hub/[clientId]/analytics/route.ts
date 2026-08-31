import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { isGhlConfigured } from "@/lib/ghl";
import {
  pullClientEmailAnalytics,
  resolveAnalyticsRange,
  type AnalyticsPreset,
} from "@/lib/ghl-email-analytics";
import { getRevClient } from "@/lib/revenue";

const PRESETS = new Set<AnalyticsPreset>(["1m", "3m", "6m", "12m", "custom"]);

function resolveLocationId(clientId: string, memberIds: string[]): string | null {
  const ids = [clientId, ...memberIds.filter((id) => id && id !== clientId)];
  for (const id of ids) {
    const loc = (getRevClient(id)?.ghl_location_id || "").trim();
    if (loc) return loc;
  }
  return null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  if (!isGhlConfigured()) {
    return NextResponse.json(
      { error: "GoHighLevel is not connected on this environment." },
      { status: 503 }
    );
  }

  const { clientId } = await params;
  const client = getRevClient(clientId);
  if (!client) return NextResponse.json({ error: "Unknown account" }, { status: 404 });

  const url = new URL(request.url);
  const memberIds = (url.searchParams.get("members") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const locationId = resolveLocationId(clientId, memberIds);
  if (!locationId) {
    return NextResponse.json(
      {
        error:
          "This account has no GoHighLevel location linked. Map it from Lifecycle → Tools.",
      },
      { status: 422 }
    );
  }

  const rawPreset = (url.searchParams.get("range") || "1m").toLowerCase();
  const preset = (PRESETS.has(rawPreset as AnalyticsPreset)
    ? rawPreset
    : "1m") as AnalyticsPreset;

  let start: string;
  let end: string;
  try {
    ({ start, end } = resolveAnalyticsRange(
      preset,
      url.searchParams.get("from"),
      url.searchParams.get("to")
    ));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid date range." },
      { status: 400 }
    );
  }

  try {
    const analytics = await pullClientEmailAnalytics(locationId, start, end);
    return NextResponse.json({
      clientId,
      clientName: client.name,
      range: preset,
      analytics,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Could not pull GoHighLevel analytics.",
      },
      { status: 502 }
    );
  }
}
