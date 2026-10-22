import { NextResponse } from "next/server";
import { isAdminAuthenticated, sessionUserSlug } from "@/lib/auth";
import { ghlAuthorizeUrl, ghlOauthConfigured } from "@/lib/ghl-oauth";

// Starts the agency install. GoHighLevel sends the admin back to /api/ghl/callback.
export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const person = await sessionUserSlug();
  if (!person) {
    return NextResponse.json({ error: "Sign in as an admin to connect GoHighLevel." }, { status: 401 });
  }
  if (!ghlOauthConfigured()) {
    return NextResponse.json(
      { error: "Set GHL_CLIENT_ID and GHL_CLIENT_SECRET first." },
      { status: 400 }
    );
  }
  return NextResponse.redirect(ghlAuthorizeUrl(person));
}
