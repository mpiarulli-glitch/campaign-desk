import { NextResponse } from "next/server";
import { KlaviyoError } from "@/lib/klaviyo";
import { metricCatalog, refreshMetricCatalog } from "@/lib/klaviyo-revenue/accounts";
import { detectMetrics } from "@/lib/klaviyo-revenue/detect";
import { klaviyoOwner, klaviyoViewer } from "../../../guard";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const denied = await klaviyoViewer();
  if (denied) return denied;
  const { id } = await params;
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  try {
    if (refresh) {
      const owner = await klaviyoOwner();
      if (owner) return owner;
      const metrics = await refreshMetricCatalog(id);
      return NextResponse.json({ metrics, fetchedAt: new Date().toISOString(), suggestions: detectMetrics(metrics) });
    }
    const cached = metricCatalog(id);
    return NextResponse.json({
      metrics: cached.metrics,
      fetchedAt: cached.fetchedAt,
      suggestions: detectMetrics(cached.metrics),
    });
  } catch (err) {
    const message = err instanceof KlaviyoError ? err.message : "Could not load metrics.";
    const status = err instanceof KlaviyoError && err.status ? err.status : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
