// Login account data layer. Credentials and identity live here; the roster of
// who exists still comes from admin-people.ts / people.ts and is seeded into
// the users table on boot (see seedUsers in db.ts).

import { randomBytes } from "crypto";
import { getDb, nowIso, type User, type UserRole } from "./db";
import {
  burnPasswordCheck,
  hashPassword,
  passwordProblem,
  verifyPasswordHash,
} from "./password";
import { decryptSecret, encryptSecret } from "./secrets";
import {
  consumeBackupCodeHash,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCode,
  verifyTotp,
} from "./totp";

const INVITE_TTL_HOURS = 72;

export function getUser(slug: string): User | null {
  const row = getDb()
    .prepare(`SELECT * FROM users WHERE slug = ?`)
    .get(slug) as User | undefined;
  return row || null;
}

export function listUsers(): User[] {
  return getDb()
    .prepare(
      `SELECT * FROM users
       ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                label COLLATE NOCASE`
    )
    .all() as User[];
}

export function userRole(slug: string): UserRole | null {
  return getUser(slug)?.role || null;
}

// True once someone has set their own password, i.e. they no longer depend on
// the env-var fallback.
export function hasOwnPassword(slug: string): boolean {
  const user = getUser(slug);
  return Boolean(user?.password_hash);
}

export type AuthResult =
  | { ok: true; user: User }
  | { ok: false; reason: "unknown" | "inactive" | "no_password" | "bad_password" };

// Verify a slug + password pair against the users table. Always burns a KDF
// cycle on the miss paths so timing does not leak which accounts exist.
export function authenticate(slug: string, password: string): AuthResult {
  const user = getUser(slug);
  if (!user) {
    burnPasswordCheck(password);
    return { ok: false, reason: "unknown" };
  }
  if (!user.active) {
    burnPasswordCheck(password);
    return { ok: false, reason: "inactive" };
  }
  if (!user.password_hash) {
    burnPasswordCheck(password);
    return { ok: false, reason: "no_password" };
  }
  if (!verifyPasswordHash(password, user.password_hash)) {
    return { ok: false, reason: "bad_password" };
  }
  return { ok: true, user };
}

export function recordLogin(slug: string): void {
  const now = nowIso();
  getDb()
    .prepare(`UPDATE users SET last_login_at = ?, updated_at = ? WHERE slug = ?`)
    .run(now, now, slug);
}

export function setPassword(
  slug: string,
  password: string
): { ok: true } | { ok: false; error: string } {
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };

  const user = getUser(slug);
  if (!user) return { ok: false, error: "Unknown account." };

  const now = nowIso();
  getDb()
    .prepare(
      `UPDATE users
       SET password_hash = ?, password_set_at = ?, updated_at = ?,
           invite_token = NULL, invite_expires_at = NULL
       WHERE slug = ?`
    )
    .run(hashPassword(password), now, now, slug);
  return { ok: true };
}

export function changePassword(
  slug: string,
  currentPassword: string,
  newPassword: string
): { ok: true } | { ok: false; error: string } {
  const result = authenticate(slug, currentPassword);
  if (!result.ok) {
    return { ok: false, error: "Current password is incorrect." };
  }
  return setPassword(slug, newPassword);
}

// ---------------------------------------------------------------------------
// Two-factor
// ---------------------------------------------------------------------------

// True once someone has scanned the QR code and typed a code back, i.e. their
// authenticator app is proven to work. A half-finished enrollment does not
// count, so it can never leave anybody unable to sign in.
export function totpEnabled(slug: string | null): boolean {
  if (!slug) return false;
  const user = getUser(slug);
  return Boolean(user?.totp_secret && user.totp_confirmed_at);
}

function readBackupCodes(user: User): string[] {
  try {
    const parsed = JSON.parse(user.totp_backup_codes || "[]");
    return Array.isArray(parsed) ? parsed.filter((h) => typeof h === "string") : [];
  } catch {
    return [];
  }
}

export function backupCodesRemaining(slug: string): number {
  const user = getUser(slug);
  return user ? readBackupCodes(user).length : 0;
}

/**
 * Start enrolling an authenticator app.
 *
 * Returns the new secret in plaintext, once, for the QR code. It is stored
 * encrypted in totp_pending_secret and does nothing until a code confirms it.
 * Calling this again replaces any pending secret, which is what "start over
 * because I deleted it from my phone" needs to do.
 */
export function beginTotpEnrollment(slug: string): string | null {
  const user = getUser(slug);
  if (!user) return null;
  const secret = generateTotpSecret();
  const now = nowIso();
  getDb()
    .prepare(
      `UPDATE users SET totp_pending_secret = ?, updated_at = ? WHERE slug = ?`
    )
    .run(encryptSecret(secret), now, slug);
  return secret;
}

// The pending secret again, for a page that was reloaded mid-enrollment. Null
// once there is nothing pending.
export function pendingTotpSecret(slug: string): string | null {
  const user = getUser(slug);
  if (!user?.totp_pending_secret) return null;
  return decryptSecret(user.totp_pending_secret);
}

export function cancelTotpEnrollment(slug: string): void {
  getDb()
    .prepare(
      `UPDATE users SET totp_pending_secret = NULL, updated_at = ? WHERE slug = ?`
    )
    .run(nowIso(), slug);
}

export type TotpConfirmResult =
  | { ok: true; backupCodes: string[] }
  | { ok: false; error: string };

// Turn a pending enrollment into a live one. The backup codes are returned in
// plaintext here and nowhere else: only their hashes are stored.
export function confirmTotpEnrollment(
  slug: string,
  code: string
): TotpConfirmResult {
  const user = getUser(slug);
  if (!user) return { ok: false, error: "Unknown account." };

  const secret = user.totp_pending_secret
    ? decryptSecret(user.totp_pending_secret)
    : null;
  if (!secret) {
    return {
      ok: false,
      error: "Start again: there is no setup in progress for this account.",
    };
  }

  const check = verifyTotp(secret, code);
  if (!check.ok) {
    return {
      ok: false,
      error: "That code did not match. Check your phone's clock and try the current code.",
    };
  }

  const backupCodes = generateBackupCodes();
  const now = nowIso();
  getDb()
    .prepare(
      `UPDATE users
       SET totp_secret = ?, totp_pending_secret = NULL, totp_confirmed_at = ?,
           totp_last_counter = ?, totp_backup_codes = ?, updated_at = ?
       WHERE slug = ?`
    )
    .run(
      user.totp_pending_secret,
      now,
      check.counter,
      JSON.stringify(backupCodes.map(hashBackupCode)),
      now,
      slug
    );
  return { ok: true, backupCodes };
}

export type TotpLoginResult =
  | { ok: true; usedBackupCode: boolean; backupCodesRemaining: number }
  | { ok: false; error: string };

/**
 * Check a code at sign-in. Accepts either a six digit app code or one of the
 * backup codes, which is consumed on use.
 *
 * A used app code is refused for the rest of its window (totp_last_counter), so
 * a code read over somebody's shoulder cannot be replayed seconds later.
 */
export function verifyTotpForLogin(slug: string, code: string): TotpLoginResult {
  const user = getUser(slug);
  if (!user || !user.totp_secret || !user.totp_confirmed_at) {
    return { ok: false, error: "Two-factor is not set up on this account." };
  }

  const trimmed = code.trim();
  const secret = decryptSecret(user.totp_secret);

  if (secret && /^\d{6}$/.test(trimmed.replace(/\s/g, ""))) {
    const check = verifyTotp(secret, trimmed);
    if (check.ok) {
      if (check.counter <= user.totp_last_counter) {
        return { ok: false, error: "That code has already been used. Wait for the next one." };
      }
      getDb()
        .prepare(
          `UPDATE users SET totp_last_counter = ?, updated_at = ? WHERE slug = ?`
        )
        .run(check.counter, nowIso(), slug);
      return {
        ok: true,
        usedBackupCode: false,
        backupCodesRemaining: readBackupCodes(user).length,
      };
    }
    return { ok: false, error: "That code is not right. Try the current one." };
  }

  const remaining = consumeBackupCodeHash(readBackupCodes(user), trimmed);
  if (remaining) {
    getDb()
      .prepare(
        `UPDATE users SET totp_backup_codes = ?, updated_at = ? WHERE slug = ?`
      )
      .run(JSON.stringify(remaining), nowIso(), slug);
    return { ok: true, usedBackupCode: true, backupCodesRemaining: remaining.length };
  }

  return { ok: false, error: "That code is not right. Try the current one." };
}

// Issue a fresh set and throw away the old ones, for someone who has used most
// of theirs or thinks the list was seen.
export function regenerateBackupCodes(slug: string): string[] | null {
  const user = getUser(slug);
  if (!user || !user.totp_secret) return null;
  const codes = generateBackupCodes();
  getDb()
    .prepare(
      `UPDATE users SET totp_backup_codes = ?, updated_at = ? WHERE slug = ?`
    )
    .run(JSON.stringify(codes.map(hashBackupCode)), nowIso(), slug);
  return codes;
}

/**
 * Turn 2FA off and wipe everything tied to it.
 *
 * Used two ways: someone turning it off for themselves, and the owner resetting
 * an account whose phone is gone. Either way setup_completed_at is cleared, so
 * they are walked back through enrollment the next time they sign in rather
 * than quietly ending up without a second factor.
 */
export function disableTotp(slug: string): void {
  const now = nowIso();
  getDb()
    .prepare(
      `UPDATE users
       SET totp_secret = NULL, totp_pending_secret = NULL, totp_confirmed_at = NULL,
           totp_last_counter = 0, totp_backup_codes = '[]',
           setup_completed_at = NULL, updated_at = ?
       WHERE slug = ?`
    )
    .run(now, slug);
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export function markSetupComplete(slug: string): void {
  const now = nowIso();
  getDb()
    .prepare(
      `UPDATE users SET setup_completed_at = COALESCE(setup_completed_at, ?),
              updated_at = ? WHERE slug = ?`
    )
    .run(now, now, slug);
}

export function setupCompletedAt(slug: string): string | null {
  return getUser(slug)?.setup_completed_at || null;
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

function inviteExpiry(): string {
  return new Date(Date.now() + INVITE_TTL_HOURS * 3600 * 1000).toISOString();
}

// Issue (or reissue) a set-your-password link for someone. Reissuing replaces
// any outstanding token, so an old link stops working immediately.
export function createInvite(slug: string): string | null {
  const user = getUser(slug);
  if (!user) return null;
  const token = randomBytes(32).toString("base64url");
  const now = nowIso();
  getDb()
    .prepare(
      `UPDATE users SET invite_token = ?, invite_expires_at = ?, updated_at = ?
       WHERE slug = ?`
    )
    .run(token, inviteExpiry(), now, slug);
  return token;
}

export function revokeInvite(slug: string): void {
  const now = nowIso();
  getDb()
    .prepare(
      `UPDATE users SET invite_token = NULL, invite_expires_at = NULL,
              updated_at = ? WHERE slug = ?`
    )
    .run(now, slug);
}

// Look up a pending invite. Returns null for unknown, expired, or inactive.
export function getUserByInvite(token: string): User | null {
  if (!token) return null;
  const row = getDb()
    .prepare(`SELECT * FROM users WHERE invite_token = ?`)
    .get(token) as User | undefined;
  if (!row) return null;
  if (!row.active) return null;
  if (!row.invite_expires_at) return null;
  if (new Date(row.invite_expires_at).getTime() < Date.now()) return null;
  return row;
}

// Consume an invite by setting the password. The token is cleared by
// setPassword, so a link works exactly once.
export function acceptInvite(
  token: string,
  password: string
): { ok: true; user: User } | { ok: false; error: string } {
  const user = getUserByInvite(token);
  if (!user) {
    return { ok: false, error: "This link has expired or already been used." };
  }
  const result = setPassword(user.slug, password);
  if (!result.ok) return result;
  return { ok: true, user };
}

// ---------------------------------------------------------------------------
// Admin management
// ---------------------------------------------------------------------------

export function setUserActive(slug: string, active: boolean): void {
  const now = nowIso();
  // Deactivating also clears any pending invite so a stale link cannot be used
  // to reactivate access.
  getDb()
    .prepare(
      `UPDATE users
       SET active = ?, updated_at = ?,
           invite_token = CASE WHEN ? = 0 THEN NULL ELSE invite_token END,
           invite_expires_at = CASE WHEN ? = 0 THEN NULL ELSE invite_expires_at END
       WHERE slug = ?`
    )
    .run(active ? 1 : 0, now, active ? 1 : 0, active ? 1 : 0, slug);
}

export function setUserEmail(slug: string, email: string): void {
  const now = nowIso();
  const value = email.trim().toLowerCase() || null;
  getDb()
    .prepare(`UPDATE users SET email = ?, updated_at = ? WHERE slug = ?`)
    .run(value, now, slug);
}

// Clear someone's password entirely, forcing them back through an invite.
export function clearPassword(slug: string): void {
  const now = nowIso();
  getDb()
    .prepare(
      `UPDATE users SET password_hash = NULL, password_set_at = NULL,
              updated_at = ? WHERE slug = ?`
    )
    .run(now, slug);
}
