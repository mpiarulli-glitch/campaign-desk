import { NextResponse } from "next/server";
import { isOwner } from "@/lib/auth";
import { loadKlaviyoDashboard } from "@/lib/klaviyo-revenue/dashboard";
import { WindowError } from "@/lib/klaviyo-revenue/window";
import type { Preset } from "@/lib/klaviyo-revenue/types";
import { klaviyoViewer } from "./guard";

function presetOf(value: string | null): Preset | null {
  if (value === "7" || value === "30" || value === "90" || value === "custom") return value;
  if (!value) return "30";
  return null;
}

export async function GET(request: Request) {
  const denied = await klaviyoViewer();
  if (denied) return denied;
  const url = new URL(request.url);
  const preset = presetOf(url.searchParams.get("preset"));
  if (!preset) {
    return NextResponse.json({ error: "Use 7, 30, 90, or custom." }, { status: 400 });
  }
  try {
    const dashboard = await loadKlaviyoDashboard({
      preset,
      start: url.searchParams.get("start") ?? undefined,
      end: url.searchParams.get("end") ?? undefined,
      refresh: url.searchParams.get("refresh") === "1",
      canManage: await isOwner(),
    });
    return NextResponse.json(dashboard);
  } catch (err) {
    const message = err instanceof WindowError ? err.message : err instanceof Error ? err.message : "Could not load Klaviyo.";
    const status = err instanceof WindowError ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
