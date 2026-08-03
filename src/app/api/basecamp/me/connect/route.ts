import { NextResponse } from "next/server";
import { getAppUrl, sessionUserSlug } from "@/lib/auth";
import { basecampConfigured } from "@/lib/basecamp";
import { authorizeUrlFor } from "@/lib/basecamp-oauth";

// Redirect the signed-in person to Basecamp's consent screen, carrying a signed
// state that names them. Only they can start their own flow: the person comes
// from the session, never from a query parameter.
export async function GET() {
  const person = await sessionUserSlug();
  if (!person) {
    return NextResponse.json(
      { error: "Sign in as yourself to connect Basecamp." },
      { status: 401 }
    );
  }
  if (!basecampConfigured()) {
    return NextResponse.json(
      { error: "BASECAMP_CLIENT_ID and BASECAMP_CLIENT_SECRET are not set." },
      { status: 400 }
    );
  }
  // The shared /api/basecamp/callback, not a personal one: 37signals approves a
  // single redirect URI per integration, and anything else comes back as
  // "Provided redirect_uri is not approved". The signed state is what tells the
  // callback this is a personal connection and whose.
  const redirectUri = `${getAppUrl()}/api/basecamp/callback`;
  return NextResponse.redirect(authorizeUrlFor(person, redirectUri));
}
