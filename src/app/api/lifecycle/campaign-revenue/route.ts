import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { isGhlConfigured } from "@/lib/ghl";
import {
  currentYearMonth,
  estimatedCampaignRevenue,
  isYearMonth,
  pullCampaignRevenueBoard,
  ticketForClient,
} from "@/lib/campaign-revenue";
import { getRevClient, listMetrics, updateRevClient } from "@/lib/revenue";

export const maxDuration = 300;

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
  const rawMonth = (url.searchParams.get("month") || "").trim();
  const month = isYearMonth(rawMonth) ? rawMonth : currentYearMonth();
  const refresh = url.searchParams.get("refresh") === "1";

  try {
    const payload = await pullCampaignRevenueBoard({ month, refresh });
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Could not load campaign revenue.",
      },
      { status: 502 }
    );
  }
}

export async function PATCH(request: Request) {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  const client = getRevClient(clientId);
  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let ticket: number | null;
  if (body.ticket === null || body.ticket === "") {
    ticket = null;
  } else if (typeof body.ticket === "number" && Number.isFinite(body.ticket)) {
    ticket = body.ticket > 0 ? body.ticket : null;
  } else {
    return NextResponse.json({ error: "ticket must be a number." }, { status: 400 });
  }

  const saved = updateRevClient(clientId, { ltv: ticket });
  if (!saved) {
    return NextResponse.json({ error: "Could not save ticket." }, { status: 500 });
  }

  const resolved = ticketForClient(saved, listMetrics(saved.id));
  const bookings =
    typeof body.attributedAppointments === "number"
      ? body.attributedAppointments
      : 0;
  return NextResponse.json({
    clientId,
    ticket: resolved.amount,
    ticketSource: resolved.source,
    estimatedRevenue: estimatedCampaignRevenue(bookings, resolved.amount),
  });
}
