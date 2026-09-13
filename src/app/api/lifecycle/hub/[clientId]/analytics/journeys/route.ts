import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { isGhlConfigured } from "@/lib/ghl";
import {
  pullClientEmailJourneys,
  resolveAnalyticsRange,
  type AnalyticsPreset,
  type EmailJourneyKind,
} from "@/lib/ghl-email-analytics";
import { getRevClient } from "@/lib/revenue";

const PRESETS = new Set<AnalyticsPreset>(["1m", "3m", "6m", "12m", "custom"]);
const KINDS = new Set<EmailJourneyKind>(["form_fill", "appointment"]);

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
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }

  const { clientId } = await params;
  const client = getRevClient(clientId);
  if (!client) return NextResponse.json({ error: "Unknown account" }, { status: 404 });

  const url = new URL(request.url);
  const memberIds = (url.searchParams.get("members") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const rawKind = (url.searchParams.get("kind") || "appointment").toLowerCase();
  const kind = (
    KINDS.has(rawKind as EmailJourneyKind) ? rawKind : "appointment"
  ) as EmailJourneyKind;

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

  const locationId = resolveLocationId(clientId, memberIds);
  if (!locationId) {
    return NextResponse.json(
      { error: "This account has no GoHighLevel location linked." },
      { status: 422 }
    );
  }
  if (!isGhlConfigured()) {
    return NextResponse.json(
      { error: "GoHighLevel is not connected on this environment." },
      { status: 503 }
    );
  }

  try {
    const payload = await pullClientEmailJourneys(
      locationId,
      start,
      end,
      kind
    );
    return NextResponse.json({
      clientId,
      clientName: client.name,
      range: preset,
      ...payload,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Could not load email journeys.",
      },
      { status: 502 }
    );
  }
}
