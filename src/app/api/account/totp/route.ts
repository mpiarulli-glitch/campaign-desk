import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { sessionUserSlug } from "@/lib/auth";
import {
  authenticate,
  backupCodesRemaining,
  beginTotpEnrollment,
  cancelTotpEnrollment,
  confirmTotpEnrollment,
  disableTotp,
  getUser,
  pendingTotpSecret,
  regenerateBackupCodes,
  totpEnabled,
} from "@/lib/users";
import { formatSecretForDisplay, otpauthUrl } from "@/lib/totp";

// Your own two-factor setup. Always scoped to the session: the account comes
// from sessionUserSlug, never from the body, and an impersonated session
// resolves to null so an admin cannot enroll or remove somebody else's phone.

type Self =
  | { ok: true; user: NonNullable<ReturnType<typeof getUser>> }
  | { ok: false; response: NextResponse };

async function requireSelf(): Promise<Self> {
  const slug = await sessionUserSlug();
  if (!slug) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Sign in as yourself to manage two-factor." },
        { status: 401 }
      ),
    };
  }
  const user = getUser(slug);
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unknown account" }, { status: 404 }),
    };
  }
  return { ok: true, user };
}

export async function GET() {
  const self = await requireSelf();
  if (!self.ok) return self.response;
  const { user } = self;
  const slug = user.slug;
  return NextResponse.json({
    label: user.label,
    enabled: totpEnabled(slug),
    enabledAt: user.totp_confirmed_at,
    pending: Boolean(user.totp_pending_secret),
    backupCodesRemaining: backupCodesRemaining(slug),
    // A password is what "disable" is checked against, so the page needs to
    // know whether there is one to check.
    hasPassword: Boolean(user.password_hash),
  });
}

// Start (or restart) enrollment. Returns the secret and a QR code as an inline
// data URI, so the image never leaves this response and is not fetched from
// anywhere. Resuming a reloaded page reuses the pending secret rather than
// generating a new one, which would leave a stale entry in their app.
export async function POST() {
  const self = await requireSelf();
  if (!self.ok) return self.response;
  const { user } = self;
  const slug = user.slug;

  if (totpEnabled(slug)) {
    return NextResponse.json(
      { error: "Two-factor is already on. Turn it off first to set up a new phone." },
      { status: 400 }
    );
  }

  const secret = pendingTotpSecret(slug) || beginTotpEnrollment(slug);
  if (!secret) {
    return NextResponse.json({ error: "Could not start setup." }, { status: 500 });
  }

  const uri = otpauthUrl(user.email || user.label || slug, secret);
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 240 });

  return NextResponse.json({
    secret,
    manualEntry: formatSecretForDisplay(secret),
    otpauthUrl: uri,
    qr,
  });
}

// Confirm a code and switch two-factor on. The backup codes come back once and
// are never retrievable again.
export async function PUT(request: Request) {
  const self = await requireSelf();
  if (!self.ok) return self.response;
  const slug = self.user.slug;

  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "confirm";

  if (action === "regenerate_backup_codes") {
    const codes = regenerateBackupCodes(slug);
    if (!codes) {
      return NextResponse.json(
        { error: "Two-factor is not on for this account." },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true, backupCodes: codes });
  }

  const code = typeof body.code === "string" ? body.code : "";
  const result = confirmTotpEnrollment(slug, code);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, backupCodes: result.backupCodes });
}

/**
 * Turn two-factor off, or abandon an unfinished setup.
 *
 * Removing a live second factor asks for the password again. A logged-in
 * browser left open is exactly the situation 2FA is meant to survive, so it
 * should not be enough on its own to take the protection away.
 */
export async function DELETE(request: Request) {
  const self = await requireSelf();
  if (!self.ok) return self.response;
  const { user } = self;
  const slug = user.slug;

  if (!totpEnabled(slug)) {
    cancelTotpEnrollment(slug);
    return NextResponse.json({ ok: true });
  }

  const body = await request.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";

  if (user.password_hash) {
    const check = authenticate(slug, password);
    if (!check.ok) {
      return NextResponse.json(
        { error: "That password is not right." },
        { status: 401 }
      );
    }
  }

  disableTotp(slug);
  return NextResponse.json({ ok: true });
}
