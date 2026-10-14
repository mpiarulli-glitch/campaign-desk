import { NextResponse } from "next/server";
import { forecastSyncAuthorized, listForecastSyncPeople } from "@/lib/forecast-sync";

export async function GET(request: Request) {
  if (!forecastSyncAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ people: listForecastSyncPeople() });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 500 });
  }
}
