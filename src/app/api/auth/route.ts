import { NextResponse } from "next/server";
import { clearSession, getSession, login } from "@/lib/auth";
import { OWNER_SLUG } from "@/lib/people";
import { hasOwnPassword } from "@/lib/users";
import { clientKey, loginAllowed, loginFailed, loginSucceeded } from "@/lib/rate-limit";

export async function GET() {
  const session = await getSession();
  const owner = session?.role === "admin" && session.person === null;
  const slug = owner ? OWNER_SLUG : session?.person || null;
  return NextResponse.json({
    authenticated: Boolean(session),
    role: session?.role || null,
    person: session?.person || null,
    owner,
    impersonating: Boolean(session?.impersonating),
    // Drives the "set your own password" nudge in the shell. Impersonated
    // sessions never prompt, since the password isn't theirs to change.
    mustSetPassword:
      Boolean(session) && !session?.impersonating && slug
        ? !hasOwnPassword(slug)
        : false,
  });
}

export async function POST(request: Request) {
  // Throttle brute-force: after too many failed attempts from one IP, lock out.
  const key = clientKey(request);
  const gate = loginAllowed(key);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a few minutes and try again." },
      { status: 429, headers: { "Retry-After": String(gate.retryAfter) } }
    );
  }

  const body = await request.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  // `account` is the new field: one user slug, no separate admin/forecast mode.
  // `adminPerson` / `person` are still read so a login tab that was already
  // open before a deploy keeps working.
  const account =
    typeof body.account === "string" && body.account
      ? body.account
      : typeof body.adminPerson === "string" && body.adminPerson
        ? body.adminPerson
        : typeof body.person === "string" && body.person
          ? body.person
          : OWNER_SLUG;

  const result = await login(account, password);

  if (!result.ok) {
    loginFailed(key);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  loginSucceeded(key);
  return NextResponse.json({
    ok: true,
    role: result.role,
    person: result.person,
    mustSetPassword: result.mustSetPassword,
  });
}

export async function DELETE() {
  await clearSession();
  return NextResponse.json({ ok: true });
}
