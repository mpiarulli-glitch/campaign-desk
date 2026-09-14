import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { isGhlConfigured } from "@/lib/ghl";
import {
  pullConversionLog,
  type ConversionLog,
} from "@/lib/conversion-log";
import {
  DEFAULT_ATTRIBUTION_DAYS,
} from "@/lib/email-conversion-attribution";
import type {
  AnalyticsPreset,
  EmailJourneyKind,
} from "@/lib/ghl-email-analytics";

export const maxDuration = 300;

const PRESETS = new Set<AnalyticsPreset>(["1m", "3m", "6m", "12m", "custom"]);
const KINDS = new Set<"all" | EmailJourneyKind>([
  "all",
  "form_fill",
  "appointment",
]);

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
  const rawKind = (url.searchParams.get("kind") || "all").toLowerCase();
  const kind = (KINDS.has(rawKind as "all" | EmailJourneyKind)
    ? rawKind
    : "all") as "all" | EmailJourneyKind;
  const refresh = url.searchParams.get("refresh") === "1";
  const daysRaw = Number(
    url.searchParams.get("days") || DEFAULT_ATTRIBUTION_DAYS
  );
  const attributionDays =
    Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 30
      ? Math.floor(daysRaw)
      : DEFAULT_ATTRIBUTION_DAYS;

  let payload: ConversionLog;
  try {
    payload = await pullConversionLog({
      range,
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
      attributionDays,
      kind,
      refresh,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Could not load conversion log.",
      },
      { status: 502 }
    );
  }

  return NextResponse.json(payload);
}
