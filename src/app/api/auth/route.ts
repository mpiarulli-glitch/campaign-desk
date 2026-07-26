import { NextResponse } from "next/server";
import {
  createAdminAccountSession,
  createSession,
  createForecastSession,
  clearSession,
  getSession,
  verifyAdminAccount,
  verifyPassword,
  verifyForecastPassword,
} from "@/lib/auth";
import { clientKey, loginAllowed, loginFailed, loginSucceeded } from "@/lib/rate-limit";

export async function GET() {
  const session = await getSession();
  return NextResponse.json({
    authenticated: Boolean(session),
    role: session?.role || null,
    person: session?.person || null,
    owner:
      session?.role === "admin" &&
      session.person === null,
    impersonating: Boolean(session?.impersonating),
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
  const person = typeof body.person === "string" ? body.person : "";
  const adminPerson =
    typeof body.adminPerson === "string" ? body.adminPerson : "";

  if (!verifyPassword(password)) {
    if (adminPerson && verifyAdminAccount(adminPerson, password)) {
      loginSucceeded(key);
      await createAdminAccountSession(adminPerson);
      return NextResponse.json({
        ok: true,
        role: "admin",
        person: adminPerson,
      });
    }
    if (!person || !verifyForecastPassword(person, password)) {
      loginFailed(key);
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    loginSucceeded(key);
    await createForecastSession(person);
    return NextResponse.json({ ok: true, role: "forecast", person });
  }

  loginSucceeded(key);
  await createSession();
  return NextResponse.json({ ok: true, role: "admin" });
}

export async function DELETE() {
  await clearSession();
  return NextResponse.json({ ok: true });
}
