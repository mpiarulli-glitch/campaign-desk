import { NextResponse } from "next/server";
import { forecastSyncAuthorized, listForecastSyncClients } from "@/lib/forecast-sync";

export async function GET(request: Request) {
  if (!forecastSyncAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ clients: listForecastSyncClients() });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 500 });
  }
}
