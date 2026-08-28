import { NextResponse } from "next/server";
import { getAppUrl, sessionUserSlug } from "@/lib/auth";
import { completeConnect, readState } from "@/lib/google-oauth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const parsed = readState(url.searchParams.get("state") || "");
  const person = await sessionUserSlug();

  const accountBack = `${getAppUrl()}/account/google`;
  const forecastBack = parsed
    ? `${getAppUrl()}/admin/forecast/${parsed.person}`
    : accountBack;
  const backFor = (query: string) => {
    const dest =
      parsed?.returnTo === "forecast" ? forecastBack : accountBack;
    const join = dest.includes("?") ? "&" : "?";
    return `${dest}${join}${query}`;
  };

  if (!parsed) {
    return NextResponse.redirect(`${accountBack}?google=state`);
  }
  if (!person) {
    return NextResponse.redirect(backFor("google=signin"));
  }
  if (parsed.person !== person) {
    return NextResponse.redirect(backFor("google=mismatch"));
  }
  if (!code) {
    return NextResponse.redirect(backFor("google=denied"));
  }

  const redirectUri = `${getAppUrl()}/api/google/callback`;
  const result = await completeConnect(person, code, redirectUri);
  if (!result.ok) {
    return NextResponse.redirect(
      backFor(`google=error&reason=${encodeURIComponent(result.error)}`)
    );
  }
  return NextResponse.redirect(backFor("google=connected"));
}
