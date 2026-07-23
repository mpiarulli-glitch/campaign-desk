import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";
import { isValidPerson } from "./people";

const COOKIE_NAME = "cd_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // 14 days

export type Session =
  | { role: "admin"; issuedAt: number }
  | { role: "forecast"; person: string; issuedAt: number };

function getSecret(): string {
  return process.env.SESSION_SECRET || "dev-insecure-secret";
}

function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD || "campaign-desk-dev";
}

function getSharedForecastPassword(): string {
  if (process.env.FORECAST_PASSWORD) return process.env.FORECAST_PASSWORD;
  return process.env.NODE_ENV === "production" ? "" : "forecast-desk-dev";
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

function forecastPasswords(): Map<string, string> {
  const map = new Map<string, string>();
  const raw = process.env.FORECAST_PASSWORDS || "";
  for (const item of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [person, ...passwordParts] = item.split(":");
    const password = passwordParts.join(":");
    if (person && password) map.set(person.trim().toLowerCase(), password);
  }
  return map;
}

export function verifyForecastPassword(
  person: string,
  password: string
): boolean {
  if (!isValidPerson(person)) return false;
  const candidates = [forecastPasswords().get(person)];
  const shared = getSharedForecastPassword();
  if (shared) candidates.push(shared);
  const a = Buffer.from(password);
  return candidates.filter(Boolean).some((expected) => {
    const b = Buffer.from(expected!);
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
}

async function setSessionCookie(payload: string): Promise<void> {
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

export async function createSession(): Promise<void> {
  await setSessionCookie(`admin:${Date.now()}`);
}

export async function createForecastSession(person: string): Promise<void> {
  await setSessionCookie(`forecast:${person}:${Date.now()}`);
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  const parts = payload.split(":");
  const role = parts[0];
  const issuedAt = Number(parts.at(-1));
  if (!Number.isFinite(issuedAt)) return null;
  if (Date.now() - issuedAt > MAX_AGE_SECONDS * 1000) return null;

  if (role === "admin") return { role, issuedAt };
  if (role === "forecast") {
    const person = parts[1];
    if (!isValidPerson(person)) return null;
    return { role, person, issuedAt };
  }

  return null;
}

export async function isAdminAuthenticated(): Promise<boolean> {
  return (await getSession())?.role === "admin";
}

export async function isForecastAuthenticated(
  person?: string
): Promise<boolean> {
  const session = await getSession();
  if (session?.role === "admin") return true;
  if (session?.role !== "forecast") return false;
  return person ? session.person === person : true;
}

export async function isWorkflowAuthenticated(): Promise<boolean> {
  const session = await getSession();
  return session?.role === "admin" || session?.role === "forecast";
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
