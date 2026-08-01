import { NextResponse } from "next/server";
import { sessionUserSlug } from "@/lib/auth";
import { changePassword, getUser, setPassword } from "@/lib/users";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";

// Change your own password. Never anyone else's: the target is always derived
// from the session, never from the request body. Impersonated sessions resolve
// to null and are rejected.

export async function GET() {
  const slug = await sessionUserSlug();
  if (!slug) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = getUser(slug);
  if (!user) {
    return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  }
  return NextResponse.json({
    slug: user.slug,
    label: user.label,
    hasPassword: Boolean(user.password_hash),
    minLength: MIN_PASSWORD_LENGTH,
  });
}

export async function POST(request: Request) {
  const slug = await sessionUserSlug();
  if (!slug) {
    return NextResponse.json(
      { error: "Sign in as yourself to change a password." },
      { status: 401 }
    );
  }

  const user = getUser(slug);
  if (!user) {
    return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const current = typeof body.current === "string" ? body.current : "";
  const next = typeof body.next === "string" ? body.next : "";
  const confirm = typeof body.confirm === "string" ? body.confirm : "";

  if (next !== confirm) {
    return NextResponse.json(
      { error: "Those passwords do not match." },
      { status: 400 }
    );
  }

  // Someone still on an env-var password has no current password to verify
  // against, so let them set one directly. Their session already proves who
  // they are.
  const result = user.password_hash
    ? changePassword(slug, current, next)
    : setPassword(slug, next);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
