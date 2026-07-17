import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";

const COOKIE_NAME = "cd_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // 14 days

function getSecret(): string {
  return process.env.SESSION_SECRET || "dev-insecure-secret";
}

function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD || "campaign-desk-dev";
}

function sign(value: string): string {
  return createHmac("sha256", getSecret()).update(value).digest("hex");
}

// Every valid admin password: the primary ADMIN_PASSWORD plus any additional
// ones in ADMIN_PASSWORDS (comma-separated). All grant the same admin access;
// separate passwords just let you give/revoke individual people access.
function validPasswords(): string[] {
  const list = [getAdminPassword()];
  const extra = process.env.ADMIN_PASSWORDS;
  if (extra) {
    for (const p of extra.split(",").map((s) => s.trim()).filter(Boolean)) {
      list.push(p);
    }
  }
  return list;
}

export function verifyPassword(password: string): boolean {
  const a = Buffer.from(password);
  return validPasswords().some((expected) => {
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
}

export async function createSession(): Promise<void> {
  const payload = `admin:${Date.now()}`;
  const token = `${payload}.${sign(payload)}`;
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function isAdminAuthenticated(): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return false;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const expected = sign(payload);
  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    if (!timingSafeEqual(a, b)) return false;
  } catch {
    return false;
  }

  const parts = payload.split(":");
  if (parts[0] !== "admin") return false;
  const issuedAt = Number(parts[1]);
  if (!Number.isFinite(issuedAt)) return false;
  if (Date.now() - issuedAt > MAX_AGE_SECONDS * 1000) return false;

  return true;
}

export function getAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

export function reviewUrl(magicToken: string): string {
  return `${getAppUrl()}/review/${magicToken}`;
}

export function scheduleUrl(scheduleToken: string): string {
  return `${getAppUrl()}/schedule/${scheduleToken}`;
}
