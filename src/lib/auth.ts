import { cookies } from "next/headers";
import { createHmac, timingSafeEqual, randomBytes } from "crypto";
import { isValidAdminPerson } from "./admin-people";
import {
  campaignKindFor,
  doesCampaignWork,
  hasAdsDashboardAccess,
  hasProductionAccess,
  isValidPerson,
  OWNER_SLUG,
  personTeam,
  type Team,
} from "./people";
import {
  authenticate,
  getUser,
  recordLogin,
  totpEnabled,
  verifyTotpForLogin,
} from "./users";
import type { User } from "./db";

const COOKIE_NAME = "cd_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // 14 days

// The half-signed-in state between "password was right" and "second factor was
// right". Short-lived on purpose: it is not a session, it only names who is
// partway through signing in, and it dies if they wander off.
const PENDING_COOKIE_NAME = "cd_2fa";
const PENDING_MAX_AGE_SECONDS = 5 * 60;

export type Session =
  | {
      role: "admin";
      person: string | null;
      impersonating: boolean;
      issuedAt: number;
    }
  | { role: "forecast"; person: string; impersonating: boolean; issuedAt: number };

// If a required secret is missing in production, fall back to a random,
// per-boot value rather than a publicly known default. This "fails closed":
// an unset SESSION_SECRET/ADMIN_PASSWORD can never be exploited with a shipped
// default (sessions simply won't validate / the default password won't work).
const PROD_FALLBACK = randomBytes(32).toString("hex");

function getSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  return process.env.NODE_ENV === "production" ? PROD_FALLBACK : "dev-insecure-secret";
}

function getAdminPassword(): string {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  return process.env.NODE_ENV === "production" ? PROD_FALLBACK : "campaign-desk-dev";
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

function timingSafePasswordMatch(password: string, expected: string): boolean {
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Owner break-glass. ADMIN_PASSWORD keeps working for the owner account even
// after they set their own password, because the alternative is being locked
// out of a Railway-deployed app whose user table lives in SQLite on the volume.
// It does NOT grant access to anyone else's account.
export function verifyPassword(password: string): boolean {
  return validPasswords().some((expected) => {
    return timingSafePasswordMatch(password, expected);
  });
}

function adminAccountPasswords(): Map<string, string> {
  const map = new Map<string, string>();
  const raw = process.env.ADMIN_ACCOUNTS || "";
  for (const item of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [person, ...passwordParts] = item.split(":");
    const password = passwordParts.join(":");
    if (person && password) map.set(person.trim().toLowerCase(), password);
  }
  return map;
}

export function verifyAdminAccount(
  person: string,
  password: string
): boolean {
  if (!isValidAdminPerson(person)) return false;
  const expected = adminAccountPasswords().get(person);
  return expected ? timingSafePasswordMatch(password, expected) : false;
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

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

// Legacy env-var credentials (ADMIN_ACCOUNTS / FORECAST_PASSWORDS / etc).
// These are a migration bridge only: they work for an account until that person
// sets their own password, after which the env var is dead for them. Delete the
// env vars once everyone has set a password.
function legacyEnvPasswordMatches(
  slug: string,
  role: string,
  password: string
): boolean {
  if (role === "owner") return verifyPassword(password);
  if (role === "admin") {
    return verifyAdminAccount(slug, password) || verifyPassword(password);
  }
  return verifyForecastPassword(slug, password);
}

export type LoginOutcome =
  // Password was right but the account has an authenticator app. No session is
  // issued yet; the caller collects a code and calls completeTotpLogin.
  | { ok: true; needsTotp: true }
  | {
      ok: true;
      needsTotp: false;
      role: "admin" | "forecast";
      person: string | null;
      usedLegacyPassword: boolean;
      mustSetPassword: boolean;
    }
  | { ok: false; error: string; status: number };

// Single entry point for signing in. Resolves the account, checks the password
// against the users table (falling back to env vars only while a password is
// unset), then issues the matching session cookie.
export async function login(
  slug: string,
  password: string
): Promise<LoginOutcome> {
  const user = getUser(slug);

  if (!user || !user.active) {
    // Burn a KDF cycle via authenticate() so an unknown or disabled slug costs
    // the same as a real one.
    authenticate(slug, password);
    return { ok: false, error: "Invalid credentials", status: 401 };
  }

  let usedLegacyPassword = false;

  if (user.password_hash) {
    const result = authenticate(slug, password);
    if (!result.ok) {
      // The owner can still get in with the break-glass env password.
      if (user.role === "owner" && verifyPassword(password)) {
        usedLegacyPassword = true;
      } else {
        return { ok: false, error: "Invalid credentials", status: 401 };
      }
    }
  } else if (legacyEnvPasswordMatches(slug, user.role, password)) {
    usedLegacyPassword = true;
  } else {
    return { ok: false, error: "Invalid credentials", status: 401 };
  }

  // The password checked out. If they have an authenticator app, stop here and
  // hand back a pending ticket instead of a session: the login is not finished
  // and nothing in the app should be reachable yet.
  if (totpEnabled(slug)) {
    await setPendingTotpCookie(slug);
    return { ok: true, needsTotp: true };
  }

  return finishLogin(user, usedLegacyPassword);
}

// Issue the session that matches an account's role. Split out of login() so the
// second factor step can reuse it without redoing the password check.
async function finishLogin(
  user: User,
  usedLegacyPassword: boolean
): Promise<LoginOutcome> {
  const slug = user.slug;
  recordLogin(slug);

  // The owner gets the null-person admin session that all existing owner
  // checks look for. Everyone else carries their slug.
  if (user.role === "owner") {
    await createSession();
    return {
      ok: true,
      needsTotp: false,
      role: "admin",
      person: null,
      usedLegacyPassword,
      mustSetPassword: !user.password_hash,
    };
  }

  if (user.role === "admin") {
    if (!isValidAdminPerson(slug)) {
      return { ok: false, error: "Account is not configured", status: 403 };
    }
    await createAdminAccountSession(slug);
    return {
      ok: true,
      needsTotp: false,
      role: "admin",
      person: slug,
      usedLegacyPassword,
      mustSetPassword: !user.password_hash,
    };
  }

  if (!isValidPerson(slug)) {
    return { ok: false, error: "Account is not configured", status: 403 };
  }
  await createForecastSession(slug);
  return {
    ok: true,
    needsTotp: false,
    role: "forecast",
    person: slug,
    usedLegacyPassword,
    mustSetPassword: !user.password_hash,
  };
}

// ---------------------------------------------------------------------------
// Second factor
// ---------------------------------------------------------------------------

async function setPendingTotpCookie(slug: string): Promise<void> {
  const payload = `pending:${slug}:${Date.now()}`;
  const jar = await cookies();
  jar.set(PENDING_COOKIE_NAME, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PENDING_MAX_AGE_SECONDS,
  });
}

async function clearPendingTotpCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(PENDING_COOKIE_NAME);
}

// Who is partway through signing in, or null. Signed with the same key as the
// session cookie, so it cannot be forged into "I already gave a password".
export async function pendingTotpSlug(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(PENDING_COOKIE_NAME)?.value;
  if (!token) return null;

  const index = token.lastIndexOf(".");
  if (index < 1) return null;
  const payload = token.slice(0, index);
  const signature = token.slice(index + 1);

  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(sign(payload));
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  const parts = payload.split(":");
  if (parts.length !== 3 || parts[0] !== "pending") return null;
  const issuedAt = Number(parts[2]);
  if (!Number.isFinite(issuedAt)) return null;
  if (Date.now() - issuedAt > PENDING_MAX_AGE_SECONDS * 1000) return null;
  return parts[1] || null;
}

/**
 * Finish a sign-in with a six digit code or a backup code.
 *
 * The account comes from the pending cookie, never from the request, so a code
 * can only complete the login it was asked for.
 */
export async function completeTotpLogin(code: string): Promise<LoginOutcome> {
  const slug = await pendingTotpSlug();
  if (!slug) {
    return {
      ok: false,
      error: "That took too long. Enter your password again.",
      status: 401,
    };
  }

  const user = getUser(slug);
  if (!user || !user.active) {
    await clearPendingTotpCookie();
    return { ok: false, error: "Invalid credentials", status: 401 };
  }

  const result = verifyTotpForLogin(slug, code);
  if (!result.ok) {
    return { ok: false, error: result.error, status: 401 };
  }

  await clearPendingTotpCookie();
  // usedLegacyPassword is false here: anyone with 2FA on has their own password
  // by definition, since enrollment requires being signed in as themselves.
  return finishLogin(user, false);
}

// The slug whose password the current session is allowed to change. The owner's
// session carries a null person, so map it back to the owner slug. Returns null
// while impersonating, since you must not change someone else's password.
export async function sessionUserSlug(): Promise<string | null> {
  const session = await getSession();
  if (!session) return null;
  if (session.impersonating) return null;
  if (session.role === "admin" && session.person === null) return OWNER_SLUG;
  return session.person;
}

export async function isOwner(): Promise<boolean> {
  const session = await getSession();
  return session?.role === "admin" && session.person === null;
}

/**
 * Who is acting, as a tag to store on a record for an audit trail.
 *
 * Distinct from sessionUserSlug, which answers "whose password may this session
 * change" and so refuses to answer at all while impersonating. For a "who logged
 * this" trail the opposite is wanted: never nothing. An impersonated session
 * records the person being impersonated with an `:impersonated` marker, because
 * the cookie does not carry the admin behind it and filing the work under that
 * person unmarked would credit it to someone who may not have done it.
 *
 * Empty string when there is no session, or for the legacy password-only admin
 * login that carries no person at all. Render with actorLabel in ./people.
 */
export async function sessionActor(): Promise<string> {
  const session = await getSession();
  if (!session) return "";
  const slug =
    session.role === "admin" && session.person === null ? OWNER_SLUG : session.person;
  if (!slug) return "";
  return session.impersonating ? `${slug}:impersonated` : slug;
}

// The slug whose team focus applies to this session, or null for no scoping.
// The owner's session carries a null person and is never scoped.
export async function sessionFocusSlug(): Promise<string | null> {
  const session = await getSession();
  if (!session) return null;
  if (session.role === "admin" && session.person === null) return null;
  return session.person;
}

/**
 * Team for API-side snapshot scoping, or null for the unscoped payload.
 *
 * Forecast specialists get their PERSON_TEAM slice from the API. Admins
 * (including the owner, Cassidy, Kyle Morris, Carlos, Luis) get every row so
 * the fill desk can client-scope: owner/Michael starts on email with See all
 * still available, AMs see everything, and other admins keep setup access.
 * Anyone with no team is also unscoped — too much rather than hiding work.
 */
export async function sessionTeam(): Promise<Team | null> {
  const session = await getSession();
  if (!session) return null;
  if (session.role === "admin") return null;
  return personTeam(session.person);
}

// True when the campaigns list and any campaign opened should be limited to blog
// assets, i.e. the person's whole focus is blog work.
export async function isBlogScopedSession(): Promise<boolean> {
  return campaignKindFor(await sessionFocusSlug()) === "blog";
}

// Who may READ the campaigns list and open a campaign: admins, plus anyone whose
// team focus includes campaign work. Abel is forecast-role, so without this he
// could not reach campaigns at all; Roy has an empty focus, so he is kept out
// even though he is otherwise an ordinary user.
// Creating and editing campaigns stays on isAdminAuthenticated.
export async function isCampaignsReadAuthenticated(): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  if (session.role === "admin" && session.person === null) return true;
  if (!doesCampaignWork(session.person)) return false;
  if (session.role === "admin") return true;
  return campaignKindFor(session.person) !== null;
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

export async function createAdminAccountSession(person: string): Promise<void> {
  await setSessionCookie(`admin:${person}:${Date.now()}`);
}

export async function createAdminImpersonationSession(
  person: string
): Promise<void> {
  if (!isValidAdminPerson(person)) {
    throw new Error("Unknown admin account");
  }
  await setSessionCookie(`admin:${person}:impersonated:${Date.now()}`);
}

export async function createForecastSession(person: string): Promise<void> {
  await setSessionCookie(`forecast:${person}:${Date.now()}`);
}

export async function createForecastImpersonationSession(
  person: string
): Promise<void> {
  if (!isValidPerson(person)) {
    throw new Error("Unknown person");
  }
  await setSessionCookie(`forecast:${person}:impersonated:${Date.now()}`);
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
  // Also drop any half-finished second factor, so signing out mid-login does
  // not leave a ticket behind that another tab could still redeem.
  jar.delete(PENDING_COOKIE_NAME);
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

  if (role === "admin") {
    const person = parts.length >= 3 ? parts[1] : null;
    if (person && !isValidAdminPerson(person)) return null;
    const impersonating = parts.length === 4 && parts[2] === "impersonated";
    if (parts.length === 4 && !impersonating) return null;
    return { role, person, impersonating, issuedAt };
  }
  if (role === "forecast") {
    const person = parts[1];
    if (!isValidPerson(person)) return null;
    const impersonating = parts.length === 4 && parts[2] === "impersonated";
    if (parts.length === 4 && !impersonating) return null;
    return { role, person, impersonating, issuedAt };
  }

  return null;
}

export async function isAdminAuthenticated(): Promise<boolean> {
  return (await getSession())?.role === "admin";
}

function syncTokenMatches(request: Request): boolean {
  const expected = process.env.CAMPAIGN_DESK_SYNC_TOKEN;
  if (!expected) return false;

  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;

  const actual = match[1];
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function isAdminOrSyncAuthenticated(request: Request): Promise<boolean> {
  if (syncTokenMatches(request)) return true;
  return isAdminAuthenticated();
}

/**
 * Owner-only tools, or a trusted machine carrying the sync token.
 *
 * Deliberately not isAdminOrSyncAuthenticated: the campaign calendar is
 * owner-only for people (see isOwnerToolsAuthenticated), and widening it to
 * every admin session would hand the SEO-side admins a calendar they have no
 * reason to see. The token is the only thing this adds.
 */
export async function isOwnerToolsOrSyncAuthenticated(
  request: Request
): Promise<boolean> {
  if (syncTokenMatches(request)) return true;
  return isOwnerToolsAuthenticated();
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

// Production scheduling is gated on an explicit person list (PRODUCTION_ACCESS
// in ./people), not on role. Being an admin is no longer enough: the SEO-side
// admins have no reason to see the shoot schedule. The owner always passes.
export async function isProductionAuthenticated(): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  // Owner session carries a null person.
  if (session.role === "admin" && session.person === null) return true;
  return Boolean(session.person) && hasProductionAccess(session.person!);
}

// Campaign calendar. Owner-only — see hasOwnerToolsAccess in ./people for
// the matching client-side nav check.
export async function isOwnerToolsAuthenticated(): Promise<boolean> {
  const session = await getSession();
  if (!session || session.impersonating) return false;
  if (session.role !== "admin") return false;
  return session.person === null || session.person === OWNER_SLUG;
}

// Weekly ads dashboard — owner plus ADS_DASHBOARD_PEOPLE. See
// hasAdsDashboardAccess in ./people for the matching nav check.
export async function isAdsDashboardAuthenticated(): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  return hasAdsDashboardAccess({
    role: session.role,
    person: session.person,
    owner: session.role === "admin" && session.person === null,
    impersonating: session.impersonating,
  });
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

export function adminCampaignUrl(id: string): string {
  return `${getAppUrl()}/admin/campaigns/${id}`;
}

export function scheduleUrl(scheduleToken: string): string {
  return `${getAppUrl()}/schedule/${scheduleToken}`;
}
