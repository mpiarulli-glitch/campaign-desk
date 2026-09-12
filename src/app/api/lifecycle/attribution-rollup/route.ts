import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { isGhlConfigured } from "@/lib/ghl";
import {
  pullAttributionRollup,
  type AttributionRollup,
} from "@/lib/email-attribution-rollup";
import {
  DEFAULT_ATTRIBUTION_DAYS,
} from "@/lib/email-conversion-attribution";
import type { AnalyticsPreset } from "@/lib/ghl-email-analytics";

export const maxDuration = 300;

const PRESETS = new Set<AnalyticsPreset>(["1m", "3m", "6m", "12m", "custom"]);

export async function GET(request: Request) {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }

  if (!isGhlConfigured()) {
    return NextResponse.json(
      { error: "GoHighLevel is not connected." },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const rawPreset = (url.searchParams.get("range") || "3m").toLowerCase();
  const range = (PRESETS.has(rawPreset as AnalyticsPreset)
    ? rawPreset
    : "3m") as AnalyticsPreset;
  const refresh = url.searchParams.get("refresh") === "1";
  const daysRaw = Number(url.searchParams.get("days") || DEFAULT_ATTRIBUTION_DAYS);
  const attributionDays =
    Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 30
      ? Math.floor(daysRaw)
      : DEFAULT_ATTRIBUTION_DAYS;

  let payload: AttributionRollup;
  try {
    payload = await pullAttributionRollup({
      range,
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
      attributionDays,
      refresh,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Could not scan email attribution.",
      },
      { status: 502 }
    );
  }

  return NextResponse.json(payload);
}
