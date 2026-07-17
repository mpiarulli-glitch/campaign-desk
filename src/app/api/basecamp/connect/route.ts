import { NextResponse } from "next/server";
import { isAdminAuthenticated, getAppUrl } from "@/lib/auth";
import { authorizeUrl, basecampConfigured } from "@/lib/basecamp";

// Kicks off the Basecamp OAuth flow: redirect the admin to Basecamp's consent
// screen. Basecamp sends them back to /api/basecamp/callback.
export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!basecampConfigured()) {
    return NextResponse.json(
      { error: "Set BASECAMP_CLIENT_ID and BASECAMP_CLIENT_SECRET first." },
      { status: 400 }
    );
  }
  const redirectUri = `${getAppUrl()}/api/basecamp/callback`;
  return NextResponse.redirect(authorizeUrl(redirectUri));
}
