import { NextResponse } from "next/server";
import { isAdminAuthenticated, getAppUrl } from "@/lib/auth";
import { exchangeCode } from "@/lib/basecamp";

// Basecamp redirects here with ?code=... after the admin authorizes. Exchange
// it for tokens, then bounce back to the production dashboard.
export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const back = `${getAppUrl()}/admin/production`;
  if (!code) {
    return NextResponse.redirect(`${back}?basecamp=error`);
  }
  const redirectUri = `${getAppUrl()}/api/basecamp/callback`;
  const ok = await exchangeCode(code, redirectUri);
  return NextResponse.redirect(`${back}?basecamp=${ok ? "connected" : "error"}`);
}
