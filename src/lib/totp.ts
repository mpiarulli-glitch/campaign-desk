// Time-based one-time passwords (RFC 6238) for Campaign Desk sign-in.
//
// Built on node's crypto for the same reason password.ts is: no dependency, and
// the algorithm is small enough to read in one sitting. HMAC-SHA1 with 6 digits
// and a 30 second step, which is what Google Authenticator, 1Password, Authy and
// every other app assume when a QR code carries no explicit parameters.
//
// Codes are checked against a one-step window either side of now, so a phone
// whose clock drifts by up to 30 seconds still works. Wider than that and a
// stolen code stays usable for too long.

import { createHmac, randomBytes, randomInt, timingSafeEqual, createHash } from "crypto";

export const TOTP_DIGITS = 6;
export const TOTP_STEP_SECONDS = 30;
// How many steps either side of the current one are accepted. 1 means a code is
// good for roughly 60 to 90 seconds depending on when in the step it was read.
const TOTP_WINDOW = 1;

const SECRET_BYTES = 20; // 160 bits, the RFC 4226 recommendation for HMAC-SHA1

/* --------------------------------------------------------------- base32 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  // No "=" padding: authenticator apps accept unpadded secrets and padding only
  // makes the manual-entry string longer.
  return out;
}

// Returns null for anything that is not valid base32, so a mistyped manual entry
// fails as "wrong secret" rather than throwing.
export function base32Decode(input: string): Buffer | null {
  const cleaned = input.toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
  if (!cleaned || /[^A-Z2-7]/.test(cleaned)) return null;
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/* ------------------------------------------------------------ generation */

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  // Counters stay well inside Number.MAX_SAFE_INTEGER for any realistic date, so
  // splitting into two 32-bit halves is exact.
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac("sha1", secret).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

// The code an app would be showing at `atMs`. Exported for tests and for the
// setup screen's "here is what your app should be showing" check.
export function totpCodeAt(secret: string, atMs: number): string | null {
  const key = base32Decode(secret);
  if (!key || !key.length) return null;
  const counter = Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
  return hotp(key, counter);
}

/* ---------------------------------------------------------- verification */

function constantTimeEquals(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  try {
    return timingSafeEqual(x, y);
  } catch {
    return false;
  }
}

export type TotpCheck =
  | { ok: true; counter: number }
  | { ok: false };

/**
 * Check a code against a secret.
 *
 * Returns the counter the code matched on success. Callers store it and refuse
 * any later code with a counter less than or equal to it, which is what stops a
 * code being replayed inside its own validity window.
 */
export function verifyTotp(
  secret: string,
  code: string,
  atMs: number = Date.now()
): TotpCheck {
  const digits = code.replace(/[\s-]/g, "");
  if (!/^\d{6}$/.test(digits)) return { ok: false };

  const key = base32Decode(secret);
  if (!key || !key.length) return { ok: false };

  const current = Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
  for (let drift = -TOTP_WINDOW; drift <= TOTP_WINDOW; drift += 1) {
    const counter = current + drift;
    if (counter < 0) continue;
    if (constantTimeEquals(hotp(key, counter), digits)) {
      return { ok: true, counter };
    }
  }
  return { ok: false };
}

/* -------------------------------------------------------------- otpauth */

// The URI an authenticator app reads out of the QR code. The label carries the
// account so somebody with several work logins can tell them apart in the app.
export function otpauthUrl(account: string, secret: string, issuer = "Campaign Desk"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// Groups of four for the "type it in by hand" fallback, which is what people use
// when the camera will not focus or they are setting up on the same device.
export function formatSecretForDisplay(secret: string): string {
  return (secret.match(/.{1,4}/g) || []).join(" ");
}

/* --------------------------------------------------------- backup codes */

export const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1

// Ten characters from a 32 character alphabet is 50 bits, which is far past what
// online guessing can reach and means these do not need a slow KDF the way a
// human-chosen password does. See hashBackupCode.
function oneBackupCode(): string {
  let out = "";
  for (let i = 0; i < 10; i += 1) {
    out += BACKUP_CODE_CHARS[randomInt(BACKUP_CODE_CHARS.length)];
  }
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

export function generateBackupCodes(): string[] {
  return Array.from({ length: BACKUP_CODE_COUNT }, oneBackupCode);
}

export function normalizeBackupCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// SHA-256 rather than scrypt, deliberately. Backup codes are 50 bits of machine
// generated randomness, so there is nothing to brute force offline, and every
// login attempt would otherwise run ten scrypt cycles.
export function hashBackupCode(code: string): string {
  return createHash("sha256").update(normalizeBackupCode(code)).digest("hex");
}

// Find and remove a matching code. Returns the remaining hashes, or null when
// nothing matched, so the caller can tell "used one up" from "wrong code".
export function consumeBackupCodeHash(
  hashes: string[],
  code: string
): string[] | null {
  const normalized = normalizeBackupCode(code);
  if (normalized.length !== 10) return null;
  const target = hashBackupCode(normalized);
  const index = hashes.findIndex((h) => constantTimeEquals(h, target));
  if (index === -1) return null;
  return hashes.filter((_, i) => i !== index);
}
