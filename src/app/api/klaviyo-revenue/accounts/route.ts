import { NextResponse } from "next/server";
import { KlaviyoError } from "@/lib/klaviyo";
import { connectRevenueAccount, listRevenueAccounts } from "@/lib/klaviyo-revenue/accounts";
import { clearRevenueCache } from "@/lib/klaviyo-revenue/dashboard";
import { detectMetrics } from "@/lib/klaviyo-revenue/detect";
import { metricCatalog } from "@/lib/klaviyo-revenue/accounts";
import { klaviyoOwner, klaviyoViewer } from "../guard";

export async function GET() {
  const denied = await klaviyoViewer();
  if (denied) return denied;
  const accounts = listRevenueAccounts().map((account) => ({
    ...account,
    suggestions: detectMetrics(metricCatalog(account.id).metrics),
  }));
  return NextResponse.json({ accounts });
}

export async function POST(request: Request) {
  const denied = await klaviyoOwner();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; apiKey?: unknown };
  const apiKey = typeof body.apiKey === "string" ? body.apiKey : "";
  const name = typeof body.name === "string" ? body.name : undefined;
  try {
    const account = await connectRevenueAccount({ name, apiKey });
    clearRevenueCache();
    return NextResponse.json({ account });
  } catch (err) {
    const message = err instanceof KlaviyoError ? err.message : "Could not connect that Klaviyo account.";
    const status = err instanceof KlaviyoError && err.status ? err.status : 400;
    return NextResponse.json({ error: message }, { status: status === 401 ? 400 : status });
  }
}
