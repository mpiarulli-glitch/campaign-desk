import { NextResponse } from "next/server";
import { isAdminAuthenticated, getAppUrl, sessionUserSlug } from "@/lib/auth";
import { exchangeCode } from "@/lib/basecamp";
import { completeConnect, readState } from "@/lib/basecamp-oauth";
import { setupStateFor } from "@/lib/setup";

/**
 * The one place Basecamp sends people back to, for both kinds of connection.
 *
 * There is a single approved redirect URI on the 37signals integration, so both
 * flows have to share it. They are told apart by `state`: the personal flow
 * carries a signed state naming the person, the shared service flow carries
 * none. Using a second URI would mean registering it at 37signals, and an
 * unregistered one fails with "Provided redirect_uri is not approved" — which is
 * exactly what happened when the personal flow had its own callback.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") || "";
  const redirectUri = `${getAppUrl()}/api/basecamp/callback`;

  const parsed = readState(state);

  // ---- Personal connection -------------------------------------------------
  if (parsed) {
    const person = await sessionUserSlug();
    // Where they came from: mid-onboarding people go back to the wizard, which
    // then shows the next step or says they are done.
    const midSetup = person ? setupStateFor(person)?.complete === false : false;
    const back = `${getAppUrl()}${midSetup ? "/account/setup" : "/account/basecamp"}`;

    if (!person) {
      return NextResponse.redirect(`${back}?basecamp=signin`);
    }
    // The state alone would let a code be replayed into a different session;
    // the session alone would let a code obtained elsewhere be redeemed here.
    // Both together bind the authorization to the person who began it.
    if (parsed.person !== person) {
      return NextResponse.redirect(`${back}?basecamp=mismatch`);
    }
    if (!code) {
      return NextResponse.redirect(`${back}?basecamp=denied`);
    }

    const result = await completeConnect(person, code, redirectUri);
    if (!result.ok) {
      return NextResponse.redirect(
        `${back}?basecamp=error&reason=${encodeURIComponent(result.error)}`
      );
    }
    return NextResponse.redirect(`${back}?basecamp=connected`);
  }

  // ---- Shared service connection (the mascot account) ----------------------
  // Admin-only, and deliberately checked after the personal branch: someone
  // connecting their own account is not necessarily an admin.
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const back = `${getAppUrl()}/admin/production`;
  if (!code) {
    return NextResponse.redirect(`${back}?basecamp=error`);
  }
  const ok = await exchangeCode(code, redirectUri);
  return NextResponse.redirect(`${back}?basecamp=${ok ? "connected" : "error"}`);
}
