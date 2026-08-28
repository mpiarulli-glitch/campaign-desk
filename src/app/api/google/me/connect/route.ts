import { NextResponse } from "next/server";
import { getAppUrl, sessionUserSlug } from "@/lib/auth";
import { forecastGoogleEnabled } from "@/lib/forecast-google";
import { authorizeUrlFor, googleConfigured } from "@/lib/google-oauth";

export async function GET(request: Request) {
  const person = await sessionUserSlug();
  if (!forecastGoogleEnabled()) {
    const dest = person ? `/admin/forecast/${person}` : "/admin";
    return NextResponse.redirect(`${getAppUrl()}${dest}`);
  }
  if (!person) {
    return NextResponse.json(
      { error: "Sign in as yourself to connect Google Calendar." },
      { status: 401 }
    );
  }
  const url = new URL(request.url);
  const next = url.searchParams.get("next") === "forecast" ? "forecast" : "account";
  if (!googleConfigured()) {
    const dest =
      next === "forecast"
        ? `/admin/forecast/${person}?google=unconfigured`
        : "/account/google?google=unconfigured";
    return NextResponse.redirect(`${getAppUrl()}${dest}`);
  }
  const redirectUri = `${getAppUrl()}/api/google/callback`;
  return NextResponse.redirect(authorizeUrlFor(person, redirectUri, next));
}
