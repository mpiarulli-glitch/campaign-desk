// Encryption for third-party tokens at rest.
//
// One plaintext OAuth token in the database is one compromise; a dozen is a much
// worse day. These are encrypted with AES-256-GCM, which is authenticated, so a
// tampered ciphertext fails to decrypt rather than yielding garbage.
//
// The key is derived from SESSION_SECRET rather than being a second secret to
// manage. That is a deliberate trade: rotating SESSION_SECRET invalidates every
// stored token and everyone reconnects, which is recoverable and visible. The
// alternative, a separate BASECAMP_TOKEN_KEY, is one more thing to lose.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const SALT = "campaign-desk/token-encryption/v1";

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    // In production auth.ts already falls back to a random per-boot secret, so
    // this only bites in local development, where a fixed dev key is fine.
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET is required to encrypt stored tokens");
    }
    cachedKey = scryptSync("dev-insecure-secret", SALT, 32);
    return cachedKey;
  }
  cachedKey = scryptSync(secret, SALT, 32);
  return cachedKey;
}

// Stored as "v1.<iv>.<tag>.<ciphertext>", all base64url. The version prefix means
// a future algorithm change can still read today's rows.
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const c = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    enc.toString("base64url"),
  ].join(".");
}

/**
 * Decrypt a stored secret.
 *
 * Returns null rather than throwing on anything malformed, tampered with, or
 * encrypted under a different key. Callers treat null as "not connected", which
 * is the safe reading: a token that cannot be decrypted is a token that cannot
 * be used, and the person simply reconnects.
 */
export function decryptSecret(stored: string | null): string | null {
  if (!stored) return null;
  const parts = stored.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const enc = Buffer.from(parts[3], "base64url");
    if (iv.length !== IV_BYTES || tag.length !== 16) return null;
    const d = createDecipheriv(ALGO, key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// Test seam: the key is cached, so a suite that changes SESSION_SECRET has to be
// able to clear it.
export function resetSecretKeyCache(): void {
  cachedKey = null;
}
