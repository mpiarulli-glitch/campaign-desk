import { NextResponse } from "next/server";
import { getAppUrl, sessionUserSlug } from "@/lib/auth";
import { forecastGoogleEnabled } from "@/lib/forecast-google";
import {
  disconnectGoogle,
  getGoogleConnection,
  googleConfigured,
  hasGoogleConnection,
} from "@/lib/google-identity";

export async function GET() {
  if (!forecastGoogleEnabled()) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  const person = await sessionUserSlug();
  if (!person) {
    return NextResponse.json({ error: "Sign in as yourself." }, { status: 401 });
  }
  const configured = googleConfigured();
  const conn = getGoogleConnection(person);
  const connected = hasGoogleConnection(person);
  return NextResponse.json({
    configured,
    connected,
    name: connected ? conn?.google_name || null : null,
    email: connected ? conn?.google_email || null : null,
    connectedAt: conn?.connected_at || null,
    error: !configured
      ? "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set."
      : conn?.last_error || null,
    connectUrl: `${getAppUrl()}/api/google/me/connect`,
  });
}

export async function DELETE() {
  if (!forecastGoogleEnabled()) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  const person = await sessionUserSlug();
  if (!person) {
    return NextResponse.json({ error: "Sign in as yourself." }, { status: 401 });
  }
  disconnectGoogle(person);
  return NextResponse.json({ ok: true });
}
