import { NextResponse } from "next/server";
import { login } from "@/lib/auth";
import { setupStateFor } from "@/lib/setup";
import { acceptInvite, getUserByInvite } from "@/lib/users";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { clientKey, loginAllowed, loginFailed, loginSucceeded } from "@/lib/rate-limit";

type Params = { params: Promise<{ token: string }> };

// Unauthenticated on purpose: the token IS the credential. It is 32 random
// bytes, single-use, and expires in 72 hours.

export async function GET(_request: Request, { params }: Params) {
  const { token } = await params;
  const user = getUserByInvite(token);
  if (!user) {
    return NextResponse.json(
      { valid: false, error: "This link has expired or already been used." },
      { status: 404 }
    );
  }
  return NextResponse.json({
    valid: true,
    label: user.label,
    slug: user.slug,
    minLength: MIN_PASSWORD_LENGTH,
  });
}

export async function POST(request: Request, { params }: Params) {
  // Rate limit by IP so the token space cannot be brute-forced.
  const key = clientKey(request);
  const gate = loginAllowed(key);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a few minutes and try again." },
      { status: 429, headers: { "Retry-After": String(gate.retryAfter) } }
    );
  }

  const { token } = await params;
  const body = await request.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  const confirm = typeof body.confirm === "string" ? body.confirm : "";

  if (password !== confirm) {
    return NextResponse.json(
      { error: "Those passwords do not match." },
      { status: 400 }
    );
  }

  const result = acceptInvite(token, password);
  if (!result.ok) {
    loginFailed(key);
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  loginSucceeded(key);

  // Sign them straight in on the password they just chose. The rest of account
  // setup, the authenticator app and their Basecamp connection, both need a
  // session to happen at all: Basecamp's consent flow has to know who is
  // connecting. They came in on a single-use token they received by name, and
  // the password check they just passed is the same one the login page runs.
  const signedIn = await login(result.user.slug, password);
  const authenticated = signedIn.ok && !signedIn.needsTotp;

  return NextResponse.json({
    ok: true,
    slug: result.user.slug,
    authenticated,
    // Where to send them next. False means the sign-in did not take for some
    // reason and the page falls back to /login.
    setupComplete: authenticated
      ? (setupStateFor(result.user.slug)?.complete ?? true)
      : false,
  });
}
