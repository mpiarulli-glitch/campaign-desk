// Password hashing for Campaign Desk logins.
//
// scrypt from node's crypto, so this adds no dependency. Stored format is
// "scrypt$N$r$p$<salt-hex>$<hash-hex>" — the parameters travel with the hash so
// they can be raised later without invalidating existing passwords.
//
// Verification is always constant-time, and always runs the full KDF even for
// an unknown user (see verifyDummy) so response timing does not reveal whether
// an account exists.

import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const N = 16384; // CPU/memory cost
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

// A pre-generated hash of a value nobody can supply, used to burn the same
// amount of CPU on a miss as on a hit.
const DUMMY_HASH = hashPassword(randomBytes(32).toString("hex"));

export const MIN_PASSWORD_LENGTH = 12;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(password.normalize("NFKC"), salt, KEYLEN, {
    N,
    r: R,
    p: P,
  });
  return [
    "scrypt",
    N,
    R,
    P,
    salt.toString("hex"),
    hash.toString("hex"),
  ].join("$");
}

export function verifyPasswordHash(
  password: string,
  stored: string | null
): boolean {
  if (!stored) {
    // No password set yet. Still burn the CPU so timing matches a real check.
    verifyPasswordHash(password, DUMMY_HASH);
    return false;
  }

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "hex");
    expected = Buffer.from(parts[5], "hex");
  } catch {
    return false;
  }
  if (!salt.length || !expected.length) return false;

  let actual: Buffer;
  try {
    actual = scryptSync(password.normalize("NFKC"), salt, expected.length, {
      N: n,
      r,
      p,
      // scrypt's default maxmem is 32MB; N=16384/r=8 needs ~16MB, but be
      // explicit so a stored hash with higher parameters still verifies.
      maxmem: 256 * 1024 * 1024,
    });
  } catch {
    return false;
  }

  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

// Burn a KDF cycle without comparing anything. Call this on the "user not
// found" path so an attacker cannot enumerate accounts by response time.
export function burnPasswordCheck(password: string): void {
  verifyPasswordHash(password, DUMMY_HASH);
}

// Reject the passwords that actually get people compromised, without turning
// this into a policy engine. Length is the lever that matters.
export function passwordProblem(password: string): string | null {
  const value = password.normalize("NFKC");
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (value.length > 200) {
    return "That password is too long.";
  }
  if (!value.trim()) {
    return "Password cannot be only spaces.";
  }
  const lowered = value.toLowerCase();
  const banned = [
    "password",
    "campaign-desk",
    "campaigndesk",
    "marketingempire",
    "letmein",
    "123456",
    "qwerty",
  ];
  if (banned.some((b) => lowered.includes(b))) {
    return "That password is too easy to guess. Pick something else.";
  }
  return null;
}
