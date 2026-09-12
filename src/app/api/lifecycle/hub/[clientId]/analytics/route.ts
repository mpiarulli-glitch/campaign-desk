import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { isGhlConfigured } from "@/lib/ghl";
import {
  emptyClientEmailAnalytics,
  pullClientEmailAnalytics,
  resolveAnalyticsRange,
  type AnalyticsPreset,
  type ClientEmailAnalytics,
} from "@/lib/ghl-email-analytics";
import {
  clientHasCrmTracking,
  pullCrmConversionAnalytics,
} from "@/lib/crm-conversion-analytics";
import {
  commerceRollupForRange,
  getRevClient,
} from "@/lib/revenue";

const PRESETS = new Set<AnalyticsPreset>(["1m", "3m", "6m", "12m", "custom"]);

function resolveLocationId(clientId: string, memberIds: string[]): string | null {
  const ids = [clientId, ...memberIds.filter((id) => id && id !== clientId)];
  for (const id of ids) {
    const loc = (getRevClient(id)?.ghl_location_id || "").trim();
    if (loc) return loc;
  }
  return null;
}

function attachCommerce(
  analytics: ClientEmailAnalytics,
  clientId: string,
  moneyMode: ClientEmailAnalytics["moneyMode"]
): ClientEmailAnalytics {
  if (moneyMode !== "commerce") {
    return { ...analytics, moneyMode, commerce: null };
  }
  const rollup = commerceRollupForRange(clientId, analytics.start, analytics.end);
  return {
    ...analytics,
    moneyMode,
    commerce: {
      revenue: rollup.revenue,
      orders: rollup.orders,
      aov: rollup.aov,
      months: rollup.months,
      revenueSource: rollup.revenueSource,
    },
  };
}

async function crmFallback(
  clientId: string,
  memberIds: string[],
  start: string,
  end: string,
  moneyMode: ClientEmailAnalytics["moneyMode"],
  warning?: string
) {
  const { analytics, sources } = await pullCrmConversionAnalytics(
    clientId,
    memberIds,
    start,
    end
  );
  return NextResponse.json({
    clientId,
    clientName: getRevClient(clientId)?.name || "",
    analytics: attachCommerce(analytics, clientId, moneyMode),
    crmSources: sources,
    ...(warning ? { warning } : {}),
  });
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

  const moneyMode =
    client.business_model === "ecomm" ? ("commerce" as const) : ("service" as const);

  const url = new URL(request.url);
  const memberIds = (url.searchParams.get("members") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const locationId = resolveLocationId(clientId, memberIds);
  const hasCrm = clientHasCrmTracking(clientId, memberIds);

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

  // Prefer GHL when linked. Otherwise Housecall Pro / HubSpot, or DTC commerce.
  if (!locationId) {
    if (hasCrm && moneyMode === "service") {
      try {
        return await crmFallback(clientId, memberIds, start, end, moneyMode);
      } catch (err) {
        return NextResponse.json(
          {
            error:
              err instanceof Error
                ? err.message
                : "Could not pull CRM conversion analytics.",
          },
          { status: 502 }
        );
      }
    }

    if (moneyMode === "commerce") {
      const analytics = attachCommerce(
        emptyClientEmailAnalytics(start, end, "commerce"),
        clientId,
        "commerce"
      );
      return NextResponse.json({
        clientId,
        clientName: client.name,
        range: preset,
        analytics,
      });
    }

    return NextResponse.json(
      {
        error:
          "This account has no tracking CRM linked. Map GoHighLevel from Lifecycle → Tools, or connect Housecall Pro / HubSpot below.",
      },
      { status: 422 }
    );
  }

  if (!isGhlConfigured()) {
    if (hasCrm && moneyMode === "service") {
      try {
        return await crmFallback(
          clientId,
          memberIds,
          start,
          end,
          moneyMode,
          "GoHighLevel is not connected on this environment — showing CRM totals."
        );
      } catch {
        // Fall through.
      }
    }

    if (moneyMode === "commerce") {
      const analytics = attachCommerce(
        emptyClientEmailAnalytics(start, end, "commerce"),
        clientId,
        "commerce"
      );
      return NextResponse.json({
        clientId,
        clientName: client.name,
        range: preset,
        analytics,
      });
    }
    return NextResponse.json(
      { error: "GoHighLevel is not connected on this environment." },
      { status: 503 }
    );
  }

  try {
    const analytics = attachCommerce(
      await pullClientEmailAnalytics(locationId, start, end),
      clientId,
      moneyMode
    );
    return NextResponse.json({
      clientId,
      clientName: client.name,
      range: preset,
      analytics,
    });
  } catch (err) {
    if (hasCrm && moneyMode === "service") {
      try {
        return await crmFallback(
          clientId,
          memberIds,
          start,
          end,
          moneyMode,
          err instanceof Error
            ? `GHL pull failed (${err.message}). Showing CRM totals.`
            : "GHL pull failed. Showing CRM totals."
        );
      } catch {
        // Fall through.
      }
    }

    if (moneyMode === "commerce") {
      // Still surface store sales if the GHL pull fails.
      const analytics = attachCommerce(
        emptyClientEmailAnalytics(start, end, "commerce"),
        clientId,
        "commerce"
      );
      return NextResponse.json({
        clientId,
        clientName: client.name,
        range: preset,
        analytics,
        warning:
          err instanceof Error ? err.message : "Could not pull GoHighLevel analytics.",
      });
    }
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Could not pull GoHighLevel analytics.",
      },
      { status: 502 }
    );
  }
}
