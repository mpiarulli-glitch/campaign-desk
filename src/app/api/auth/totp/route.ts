import { NextResponse } from "next/server";
import { completeTotpLogin, pendingTotpSlug } from "@/lib/auth";
import { OWNER_SLUG } from "@/lib/people";
import { setupStateFor } from "@/lib/setup";
import { clientKey, loginAllowed, loginFailed, loginSucceeded } from "@/lib/rate-limit";

// Step two of signing in. Unauthenticated in the session sense, but not open:
// it only works for whoever the signed pending cookie names, which is only set
// after a correct password.

// Whether the browser is mid-login, so the page can send someone back to the
// password step after a reload instead of showing an empty code box.
export async function GET() {
  return NextResponse.json({ pending: Boolean(await pendingTotpSlug()) });
}

export async function POST(request: Request) {
  // Same limiter as the password step, so six digit codes cannot be guessed by
  // volume. A code is one in a million and the window is short, but eight
  // tries per quarter hour closes that off entirely.
  const key = clientKey(request);
  const gate = loginAllowed(key);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a few minutes and try again." },
      { status: 429, headers: { "Retry-After": String(gate.retryAfter) } }
    );
  }

  const body = await request.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code : "";

  const result = await completeTotpLogin(code);
  if (!result.ok) {
    loginFailed(key);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  if (result.needsTotp) {
    // Not reachable: completeTotpLogin never asks for a second factor twice.
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  loginSucceeded(key);
  return NextResponse.json({
    ok: true,
    role: result.role,
    person: result.person,
    mustSetPassword: result.mustSetPassword,
    setupComplete: setupStateFor(result.person || OWNER_SLUG)?.complete ?? true,
  });
}
