import { NextResponse } from "next/server";
import { getAppUrl, sessionUserSlug } from "@/lib/auth";
import { completeConnect, readState } from "@/lib/basecamp-oauth";

/**
 * Where Basecamp sends someone back after they authorize.
 *
 * Two checks before the code is redeemed: the state has to verify, and the person
 * named inside it has to match the current session. The state alone would let a
 * code be replayed into a different session; the session alone would let a code
 * obtained elsewhere be redeemed here. Both together bind the authorization to
 * the person who began it.
 */
export async function GET(request: Request) {
  const person = await sessionUserSlug();
  const back = `${getAppUrl()}/account/basecamp`;

  if (!person) {
    return NextResponse.redirect(`${back}?basecamp=signin`);
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") || "";

  if (!code) {
    return NextResponse.redirect(`${back}?basecamp=denied`);
  }

  const parsed = readState(state);
  if (!parsed) {
    return NextResponse.redirect(`${back}?basecamp=state`);
  }
  if (parsed.person !== person) {
    // The flow was started by a different account than the one now signed in.
    return NextResponse.redirect(`${back}?basecamp=mismatch`);
  }

  const result = await completeConnect(
    person,
    code,
    `${getAppUrl()}/api/basecamp/me/callback`
  );
  if (!result.ok) {
    return NextResponse.redirect(
      `${back}?basecamp=error&reason=${encodeURIComponent(result.error)}`
    );
  }
  return NextResponse.redirect(`${back}?basecamp=connected`);
}
