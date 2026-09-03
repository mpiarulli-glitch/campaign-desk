import { NextResponse } from "next/server";
import {
  accessSubject,
  clearSession,
  getSession,
  login,
  sessionForecastSubjects,
} from "@/lib/auth";
import { FORECAST_ALL, resolveAll, visiblePages } from "@/lib/access";
import { forecastGoogleEnabled } from "@/lib/forecast-google";
import { OWNER_SLUG, personLabel } from "@/lib/people";
import { hasOwnPassword } from "@/lib/users";
import { setupStateFor } from "@/lib/setup";
import { clientKey, loginAllowed, loginFailed, loginSucceeded } from "@/lib/rate-limit";

export async function GET() {
  const session = await getSession();
  const owner = session?.role === "admin" && session.person === null;
  const slug = owner ? OWNER_SLUG : session?.person || null;
  // Impersonated sessions are never nudged: neither the password nor the
  // second factor nor the Basecamp connection is theirs to set up.
  const own = Boolean(session) && !session?.impersonating && slug ? slug : null;
  const setup = own ? setupStateFor(own) : null;
  // The sidebar and every in-app "can they do this" check read these two, so
  // the answer the shell renders is the same one the routes enforce rather than
  // a second copy of the rules living in the client bundle.
  const who = await accessSubject();
  const pages = who ? visiblePages(who) : [];
  const capabilities: Record<string, boolean> = {};
  if (who) {
    for (const cap of resolveAll(who)) capabilities[cap.key] = cap.allowed;
  }
  // Whose weeks this session may open. "*" means the whole roster; otherwise a
  // short list. The forecast UI uses this so a user granted a teammate (Roy →
  // Saqib) is not bounced straight to their own week forever.
  const forecastVisible = await sessionForecastSubjects();
  const forecastSubjects =
    forecastVisible === FORECAST_ALL
      ? FORECAST_ALL
      : forecastVisible.map((s) => ({ slug: s, label: personLabel(s) }));

  return NextResponse.json({
    authenticated: Boolean(session),
    pages: pages.map((p) => ({ key: p.key, href: p.href, label: p.label, icon: p.icon })),
    capabilities,
    forecastSubjects,
    role: session?.role || null,
    person: session?.person || null,
    owner,
    impersonating: Boolean(session?.impersonating),
    // Drives the "set your own password" nudge in the shell.
    mustSetPassword: own ? !hasOwnPassword(own) : false,
    // Drives the onboarding banner and the redirect out of the app shell.
    setupComplete: setup ? setup.complete : true,
    setupRemaining: setup ? setup.remaining : [],
    forecastGoogle: forecastGoogleEnabled(),
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

  // A correct password with 2FA still pending is not a completed login, so the
  // rate limit counter stays as it is until the second factor clears.
  if (result.needsTotp) {
    return NextResponse.json({ ok: true, needsTotp: true });
  }

  loginSucceeded(key);
  return NextResponse.json({
    ok: true,
    needsTotp: false,
    role: result.role,
    person: result.person,
    mustSetPassword: result.mustSetPassword,
    setupComplete: setupStateFor(result.person || OWNER_SLUG)?.complete ?? true,
  });
}

export async function DELETE() {
  await clearSession();
  return NextResponse.json({ ok: true });
}
