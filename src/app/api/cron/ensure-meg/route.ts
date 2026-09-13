import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { isAdminAuthenticated } from "@/lib/auth";
import { ensureMegLifecycleClient } from "@/lib/ensure-meg-client";
import { pullClientAttributionSummary } from "@/lib/ghl-email-analytics";
import { resolveAnalyticsRange } from "@/lib/ghl-email-analytics";
import { DEFAULT_ATTRIBUTION_DAYS } from "@/lib/email-conversion-attribution";
import type { AnalyticsPreset } from "@/lib/ghl-email-analytics";

export const maxDuration = 300;

function secretMatches(provided: string | null): boolean {
  if (!provided) return false;
  const candidates = [
    process.env.CRON_SECRET,
    process.env.ATTRIBUTION_SCAN_SECRET,
  ].filter((v): v is string => Boolean(v));
  for (const expected of candidates) {
    const a = createHmac("sha256", expected).update(provided).digest();
    const b = createHmac("sha256", expected).update(expected).digest();
    try {
      if (timingSafeEqual(a, b)) return true;
    } catch {
      // try next
    }
  }
  return false;
}

async function authorized(request: Request): Promise<boolean> {
  if (await isAdminAuthenticated()) return true;
  const url = new URL(request.url);
  const header = request.headers.get("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ")
    ? header.slice(7)
    : null;
  return secretMatches(bearer || url.searchParams.get("secret"));
}

/**
 * Create/link Marketing Empire Group on the Lifecycle hub with its GHL
 * location, then optionally return 12m email→booking attribution for MEG.
 * Pass ?meetings=discovery (or discoveryOnly=1) to count discovery meetings only.
 */
export async function POST(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const ensured = await ensureMegLifecycleClient();
    const url = new URL(request.url);
    const rawRange = (url.searchParams.get("range") || "12m").toLowerCase();
    const range = (
      ["1m", "3m", "6m", "12m"].includes(rawRange) ? rawRange : "12m"
    ) as AnalyticsPreset;
    const discoveryOnly =
      url.searchParams.get("discoveryOnly") === "1" ||
      url.searchParams.get("meetings") === "discovery";
    // Default: require contact-level outbound marketing email before credit.
    // Pass requireEmailTouch=0 to see the old (inflated) date-only numbers.
    const requireEmailTouch = url.searchParams.get("requireEmailTouch") !== "0";
    const { start, end } = resolveAnalyticsRange(range);
    const attribution = await pullClientAttributionSummary(
      ensured.locationId,
      start,
      end,
      DEFAULT_ATTRIBUTION_DAYS,
      { discoveryOnly, requireEmailTouch }
    );

    return NextResponse.json({
      ensured,
      range,
      start,
      end,
      discoveryOnly,
      requireEmailTouch: attribution.requireEmailTouch,
      attribution: {
        attributedAppointments: attribution.attributedAppointments,
        attributedFormFills: attribution.attributedFormFills,
        totalAppointments: attribution.totalAppointments,
        totalFormFills: attribution.totalFormFills,
        campaignSends: attribution.campaignSends,
        flowSends: attribution.flowSends,
        emailTouch: attribution.emailTouch,
        error: attribution.error,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Could not add Marketing Empire Group.",
      },
      { status: 502 }
    );
  }
}

export async function GET(request: Request) {
  return POST(request);
}
