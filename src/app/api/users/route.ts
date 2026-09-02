import { NextResponse } from "next/server";
import { can, getAppUrl } from "@/lib/auth";
import { OWNER_SLUG } from "@/lib/people";
import {
  clearPassword,
  createInvite,
  disableTotp,
  getUser,
  listUsers,
  revokeInvite,
  setUserActive,
  setUserEmail,
  totpEnabled,
} from "@/lib/users";
import { hasConnection } from "@/lib/basecamp-identity";

// Owner-only. Admins can use the app but cannot mint invite links or disable
// accounts, since that would let them grant themselves or others access.

async function requireOwner() {
  return (await can("tool.accounts"))
    ? null
    : NextResponse.json({ error: "Owner access required" }, { status: 403 });
}

export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;

  const now = Date.now();
  return NextResponse.json({
    users: listUsers().map((u) => ({
      slug: u.slug,
      label: u.label,
      email: u.email,
      role: u.role,
      active: Boolean(u.active),
      hasPassword: Boolean(u.password_hash),
      passwordSetAt: u.password_set_at,
      lastLoginAt: u.last_login_at,
      twoFactor: totpEnabled(u.slug),
      basecampConnected: hasConnection(u.slug),
      setupCompletedAt: u.setup_completed_at,
      invitePending: Boolean(
        u.invite_token &&
          u.invite_expires_at &&
          new Date(u.invite_expires_at).getTime() > now
      ),
      inviteExpiresAt: u.invite_expires_at,
    })),
  });
}

export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "";
  const slug = typeof body.slug === "string" ? body.slug : "";

  // Mint a link for everyone who still needs one, in a single pass, so the
  // owner can send them all out in one sitting. Skips anyone who already set
  // their own password so it never resets a working login by accident.
  if (action === "invite_all") {
    const links: Array<{ slug: string; label: string; url: string }> = [];
    const skipped: string[] = [];
    for (const u of listUsers()) {
      if (!u.active) continue;
      if (u.password_hash) {
        skipped.push(u.label);
        continue;
      }
      const token = createInvite(u.slug);
      if (token) {
        links.push({
          slug: u.slug,
          label: u.label,
          url: `${getAppUrl()}/invite/${token}`,
        });
      }
    }
    return NextResponse.json({ ok: true, links, skipped });
  }

  const user = getUser(slug);
  if (!user) {
    return NextResponse.json({ error: "Unknown account" }, { status: 404 });
  }

  switch (action) {
    case "invite": {
      const token = createInvite(slug);
      if (!token) {
        return NextResponse.json({ error: "Could not create invite" }, { status: 500 });
      }
      // Returned once, for the owner to copy and send. The token is stored but
      // the full URL is never persisted or logged.
      return NextResponse.json({
        ok: true,
        url: `${getAppUrl()}/invite/${token}`,
      });
    }

    case "revoke_invite":
      revokeInvite(slug);
      return NextResponse.json({ ok: true });

    case "clear_password": {
      // Force someone back through an invite. Blocked for the owner, whose
      // break-glass env password is the only remaining way in.
      if (slug === OWNER_SLUG) {
        return NextResponse.json(
          { error: "Use the password page to change the owner password." },
          { status: 400 }
        );
      }
      clearPassword(slug);
      revokeInvite(slug);
      return NextResponse.json({ ok: true });
    }

    case "reset_2fa": {
      // For the "I lost my phone and my backup codes" call. It clears their
      // second factor and their setup stamp, so the next time they sign in
      // they are walked through enrolling a new phone before anything opens up.
      disableTotp(slug);
      return NextResponse.json({ ok: true });
    }

    case "deactivate": {
      if (slug === OWNER_SLUG) {
        return NextResponse.json(
          { error: "The owner account cannot be disabled." },
          { status: 400 }
        );
      }
      setUserActive(slug, false);
      return NextResponse.json({ ok: true });
    }

    case "activate":
      setUserActive(slug, true);
      return NextResponse.json({ ok: true });

    case "set_email": {
      const email = typeof body.email === "string" ? body.email : "";
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
        return NextResponse.json({ error: "That is not a valid email." }, { status: 400 });
      }
      try {
        setUserEmail(slug, email);
      } catch {
        return NextResponse.json(
          { error: "That email is already on another account." },
          { status: 409 }
        );
      }
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
