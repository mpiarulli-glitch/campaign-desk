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
