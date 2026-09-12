import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { isAdminAuthenticated } from "@/lib/auth";
import { isGhlConfigured } from "@/lib/ghl";
import { pullAttributionRollup } from "@/lib/email-attribution-rollup";
import { DEFAULT_ATTRIBUTION_DAYS } from "@/lib/email-conversion-attribution";
import type { AnalyticsPreset } from "@/lib/ghl-email-analytics";

export const maxDuration = 300;

const PRESETS = new Set<AnalyticsPreset>(["1m", "3m", "6m", "12m"]);

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
      // length mismatch — try next candidate
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
 * One-shot / cron scan: which GHL-linked accounts have last-touch email →
 * booked appointment (and form fill) wins. Secured like other cron routes.
 */
export async function GET(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  try {
    const payload = await pullAttributionRollup({
      range,
      attributionDays: DEFAULT_ATTRIBUTION_DAYS,
      refresh: url.searchParams.get("refresh") === "1",
    });
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Attribution scan failed.",
      },
      { status: 502 }
    );
  }
}
